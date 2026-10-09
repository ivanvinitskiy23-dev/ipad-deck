#!/usr/bin/env python3
"""iPad Deck hub — local Stream Deck–style panel for Windows (and later Linux)."""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, build_opener, HTTPCookieProcessor
from http.cookiejar import CookieJar

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
# 8787 avoids a stuck zombie listener that sometimes owns 8080 without admin rights.
PORT = int(os.environ.get("IPAD_DECK_PORT", "8787"))
HOST = os.environ.get("IPAD_DECK_HOST", "0.0.0.0")
STARTED_AT = time.time()


def lan_ips() -> list[str]:
    ips: list[str] = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
            s.close()
        except OSError:
            pass
    return ips


def disk_free_gb(path: str = "C:\\") -> float | None:
    try:
        usage = shutil.disk_usage(path if platform.system() == "Windows" else "/")
        return round(usage.free / (1024**3), 1)
    except OSError:
        return None


def key_tap(vk: int) -> None:
    if platform.system() != "Windows":
        return
    import ctypes

    user32 = ctypes.windll.user32
    KEYEVENTF_KEYUP = 0x0002
    user32.keybd_event(vk, 0, 0, 0)
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


# Remember last set level for the tablet UI.
_last_volume = 50
_muted = False


def _set_volume_windows(percent: int) -> bool:
    """Absolute master volume via pycaw."""
    try:
        from pycaw.pycaw import AudioUtilities

        spk = AudioUtilities.GetSpeakers()
        ev = spk.EndpointVolume
        ev.SetMute(0, None)
        ev.SetMasterVolumeLevelScalar(max(0.0, min(1.0, percent / 100.0)), None)
        return True
    except Exception:
        return False


def _get_volume_windows() -> int | None:
    try:
        from pycaw.pycaw import AudioUtilities

        spk = AudioUtilities.GetSpeakers()
        ev = spk.EndpointVolume
        return int(round(ev.GetMasterVolumeLevelScalar() * 100))
    except Exception:
        return None


def action_vol_set(percent: int | float | str) -> str:
    global _last_volume, _muted
    try:
        p = int(round(float(percent)))
    except (TypeError, ValueError):
        return "bad volume"
    p = max(0, min(100, p))

    if platform.system() == "Windows":
        ok = _set_volume_windows(p)
        if not ok:
            for _ in range(50):
                key_tap(0xAE)
            steps = int(round(p / 2.0))
            for _ in range(steps):
                key_tap(0xAF)
        real = _get_volume_windows()
        _last_volume = real if real is not None else p
        _muted = _last_volume == 0
        return f"volume {_last_volume}%"

    for cmd in (
        ["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", f"{p}%"],
        ["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{p}%"],
    ):
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            _last_volume = p
            _muted = p == 0
            return f"volume {p}%"
        except OSError:
            continue
    return "volume control unavailable"


def action_mute() -> str:
    global _muted, _last_volume
    if platform.system() == "Windows":
        key_tap(0xAD)
        _muted = not _muted
        return "muted" if _muted else f"unmuted ({_last_volume}%)"
    key_tap(0xAD)
    return "mute toggled"


def action_vol_up() -> str:
    global _last_volume
    return action_vol_set(min(100, _last_volume + 5))


def action_vol_down() -> str:
    global _last_volume
    return action_vol_set(max(0, _last_volume - 5))


def action_lock() -> str:
    if platform.system() == "Windows":
        import ctypes

        ctypes.windll.user32.LockWorkStation()
        return "locked"
    subprocess.Popen(["loginctl", "lock-session"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return "lock requested"


def _first_existing(candidates: list[Path]) -> Path | None:
    for p in candidates:
        if p and p.exists():
            return p
    return None


def find_cursor() -> Path | None:
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        Path(local) / "Programs" / "cursor" / "Cursor.exe" if local else None,
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Cursor" / "Cursor.exe",
        Path(shutil.which("cursor") or ""),
    ]
    return _first_existing([p for p in candidates if p])


def find_chrome() -> Path | None:
    local = os.environ.get("LOCALAPPDATA", "")
    pf = os.environ.get("PROGRAMFILES", r"C:\Program Files")
    pf86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")
    return _first_existing(
        [
            Path(pf) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(pf86) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(local) / "Google" / "Chrome" / "Application" / "chrome.exe" if local else None,
            Path(shutil.which("chrome") or ""),
        ]
    )


def find_telegram() -> Path | None:
    local = os.environ.get("LOCALAPPDATA", "")
    roaming = os.environ.get("APPDATA", "")
    return _first_existing(
        [
            Path(roaming) / "Telegram Desktop" / "Telegram.exe" if roaming else None,
            Path(local) / "Telegram Desktop" / "Telegram.exe" if local else None,
        ]
    )


def find_discord() -> Path | None:
    local = os.environ.get("LOCALAPPDATA", "")
    if not local:
        return None
    direct = Path(local) / "Discord" / "Discord.exe"
    if direct.exists():
        return direct
    root = Path(local) / "Discord"
    if root.exists():
        apps = sorted(root.glob("app-*/Discord.exe"), reverse=True)
        if apps:
            return apps[0]
    return None


def find_steam() -> Path | None:
    pf = os.environ.get("PROGRAMFILES", r"C:\Program Files")
    pf86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")
    return _first_existing(
        [
            Path(pf86) / "Steam" / "steam.exe",
            Path(pf) / "Steam" / "steam.exe",
            Path(shutil.which("steam") or ""),
        ]
    )


def find_faceit() -> Path | None:
    local = os.environ.get("LOCALAPPDATA", "")
    pf = os.environ.get("PROGRAMFILES", r"C:\Program Files")
    pf86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")
    return _first_existing(
        [
            Path(local) / "FaceIt" / "FACEIT.exe" if local else None,
            Path(local) / "FACEIT" / "FACEIT.exe" if local else None,
            Path(local) / "Programs" / "FACEIT" / "FACEIT.exe" if local else None,
            Path(local) / "Programs" / "faceit" / "FACEIT.exe" if local else None,
            Path(pf) / "FACEIT" / "FACEIT.exe",
            Path(pf86) / "FACEIT" / "FACEIT.exe",
        ]
    )


def find_faceit_ac() -> Path | None:
    pf = os.environ.get("PROGRAMFILES", r"C:\Program Files")
    pf86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")
    local = os.environ.get("LOCALAPPDATA", "")
    return _first_existing(
        [
            Path(pf) / "FACEIT AC" / "faceitclient.exe",
            Path(pf86) / "FACEIT AC" / "faceitclient.exe",
            Path(pf) / "FACEIT Anti-Cheat" / "faceitclient.exe",
            Path(pf86) / "FACEIT Anti-Cheat" / "faceitclient.exe",
            Path(local) / "Programs" / "FACEIT Anti-Cheat" / "faceitclient.exe" if local else None,
            Path(local) / "Programs" / "FACEIT AC" / "faceitclient.exe" if local else None,
        ]
    )


def action_open_exe(exe: Path | None, label: str) -> str:
    if not exe:
        return f"{label} not found"
    subprocess.Popen(
        [str(exe)],
        cwd=str(exe.parent),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return f"started {label}"


def action_steam_applaunch(app_id: int, label: str) -> str:
    steam = find_steam()
    if steam:
        subprocess.Popen(
            [str(steam), "-applaunch", str(app_id)],
            cwd=str(steam.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return f"started {label}"
    try:
        os.startfile(f"steam://rungameid/{app_id}")  # type: ignore[attr-defined]
        return f"started {label}"
    except Exception:
        return f"{label} not found (Steam)"


def action_open_cursor() -> str:
    return action_open_exe(find_cursor(), "Cursor")


def action_open_chrome() -> str:
    return action_open_exe(find_chrome(), "Chrome")


def action_open_telegram() -> str:
    return action_open_exe(find_telegram(), "Telegram")


def action_open_discord() -> str:
    return action_open_exe(find_discord(), "Discord")


def action_open_steam() -> str:
    return action_open_exe(find_steam(), "Steam")


def action_open_faceit() -> str:
    return action_open_exe(find_faceit(), "FACEIT")


def action_open_faceit_ac() -> str:
    return action_open_exe(find_faceit_ac(), "FACEIT AC")


def action_open_faceit_stack() -> str:
    """One tap: FACEIT Anti-Cheat + FACEIT client."""
    parts = []
    ac = find_faceit_ac()
    client = find_faceit()
    if ac:
        action_open_exe(ac, "FACEIT AC")
        parts.append("AC")
        time.sleep(0.6)
    if client:
        action_open_exe(client, "FACEIT")
        parts.append("FACEIT")
    if not parts:
        return "FACEIT / AC not found"
    return "started " + " + ".join(parts)


def action_open_cs2() -> str:
    return action_steam_applaunch(730, "CS2")


def action_open_pubg() -> str:
    return action_steam_applaunch(578080, "PUBG")


# ---- audio output scenes (headphones / bluetooth) ----

def _is_motherboard_audio(name: str) -> bool:
    n = (name or "").lower()
    return (
        "high definition audio device" in n
        or "realtek" in n
    )


def _is_bluetooth_name(name: str) -> bool:
    """BT speakers often show as Headphones/Headset (Brand) with no 'Bluetooth' word."""
    n = (name or "").lower()
    keys = (
        "bluetooth", "a2dp", "hands-free", "headset (wireless)",
        "bt stereo", "airpods", "galaxy buds",
    )
    if any(k in n for k in keys):
        return True
    # e.g. Headphones (3- REAL-EL X-711) — Windows BT stereo render
    if (n.startswith("headphones") or n.startswith("headset")) and not _is_motherboard_audio(n):
        if not _is_monitor_name(n) and not _is_junk_render(n):
            return True
    return False


def _is_monitor_name(name: str) -> bool:
    n = (name or "").lower()
    keys = ("nvidia", "hdmi", "display audio", "monitor", "amd hdmi", "intel(r) display")
    return any(k in n for k in keys)


def _is_junk_render(name: str) -> bool:
    """Skip odd endpoints like 'Speakers (fifine Microphone)'."""
    n = (name or "").lower()
    if "fifine" in n and "microphone" in n:
        return True
    if "stereo mix" in n or "what u hear" in n:
        return True
    return False


def _is_wired_home_name(name: str) -> bool:
    """Wired headphones = Speakers/Headphones (High Definition Audio Device)."""
    n = (name or "").lower()
    if _is_bluetooth_name(n) or _is_monitor_name(n) or _is_junk_render(n):
        return False
    if not _is_motherboard_audio(n):
        return False
    return n.startswith("speakers") or n.startswith("headphones")


def _device_kind(name: str) -> str:
    """Map Windows endpoint → UI scene: headphones | bluetooth | other."""
    if _is_junk_render(name) or _is_monitor_name(name):
        return "other"
    if _is_bluetooth_name(name):
        return "bluetooth"
    if _is_wired_home_name(name):
        return "headphones"
    return "other"


def _set_default_endpoint(device_id: str) -> bool:
    if platform.system() != "Windows":
        return False
    try:
        from ctypes import c_void_p
        from ctypes.wintypes import BOOL, DWORD, LPCWSTR

        from comtypes import CLSCTX_ALL, COMMETHOD, GUID, HRESULT, IUnknown, POINTER, CoCreateInstance

        class IPolicyConfig(IUnknown):
            _iid_ = GUID("{f8679f50-850a-41cf-9c72-430f290290c8}")
            _methods_ = (
                COMMETHOD([], HRESULT, "GetMixFormat", (["in"], LPCWSTR, "deviceId"), (["out"], POINTER(c_void_p), "format")),
                COMMETHOD([], HRESULT, "GetDeviceFormat", (["in"], LPCWSTR, "deviceId"), (["in"], BOOL, "default"), (["out"], POINTER(c_void_p), "format")),
                COMMETHOD([], HRESULT, "ResetDeviceFormat", (["in"], LPCWSTR, "deviceId")),
                COMMETHOD([], HRESULT, "SetDeviceFormat", (["in"], LPCWSTR, "deviceId"), (["in"], c_void_p, "format"), (["in"], c_void_p, "format2")),
                COMMETHOD([], HRESULT, "GetProcessingPeriod", (["in"], LPCWSTR, "deviceId"), (["in"], BOOL, "default"), (["out"], POINTER(c_void_p), "period"), (["out"], POINTER(c_void_p), "period2")),
                COMMETHOD([], HRESULT, "SetProcessingPeriod", (["in"], LPCWSTR, "deviceId"), (["in"], c_void_p, "period")),
                COMMETHOD([], HRESULT, "GetShareMode", (["in"], LPCWSTR, "deviceId"), (["out"], POINTER(c_void_p), "mode")),
                COMMETHOD([], HRESULT, "SetShareMode", (["in"], LPCWSTR, "deviceId"), (["in"], c_void_p, "mode")),
                COMMETHOD([], HRESULT, "GetPropertyValue", (["in"], LPCWSTR, "deviceId"), (["in"], c_void_p, "key"), (["out"], POINTER(c_void_p), "value")),
                COMMETHOD([], HRESULT, "SetPropertyValue", (["in"], LPCWSTR, "deviceId"), (["in"], c_void_p, "key"), (["in"], c_void_p, "value")),
                COMMETHOD([], HRESULT, "SetDefaultEndpoint", (["in"], LPCWSTR, "deviceId"), (["in"], DWORD, "role")),
                COMMETHOD([], HRESULT, "SetEndpointVisibility", (["in"], LPCWSTR, "deviceId"), (["in"], BOOL, "visible")),
            )

        clsid = GUID("{870af99c-171d-4f9e-af0d-e63df40c2bc9}")
        cfg = CoCreateInstance(clsid, IPolicyConfig, CLSCTX_ALL)
        for role in (0, 1, 2):  # console / multimedia / communications
            cfg.SetDefaultEndpoint(device_id, role)
        return True
    except Exception:
        return False


def _short_device_name(name: str) -> str:
    n = (name or "").strip()
    if "(" in n and ")" in n:
        inner = n.split("(", 1)[1].rsplit(")", 1)[0].strip()
        # Windows duplicate prefixes: "2- Brand", "3- Brand"
        inner = re.sub(r"^\d+\s*[-–—]\s*", "", inner).strip()
        low = inner.lower()
        if inner and "high definition audio" not in low and "nvidia" not in low:
            if low.endswith(" hands-free"):
                inner = inner[: -len(" hands-free")].strip()
            return inner[:28]
        n = n.split("(", 1)[0].strip() or n
    return n[:28]


def get_audio_payload() -> dict:
    empty = {
        "default_id": "",
        "default_name": "",
        "default_kind": "headphones",
        "scenes": {
            "headphones": {"id": "", "name": "Headphones", "available": False},
            "bluetooth": {"id": "", "name": "Bluetooth", "available": False},
        },
    }
    if platform.system() != "Windows":
        return empty
    try:
        from pycaw.pycaw import AudioUtilities

        default = AudioUtilities.GetSpeakers()
        default_id = getattr(default, "id", "") or ""
        default_name = getattr(default, "FriendlyName", "") or ""
        default_kind = _device_kind(default_name)

        hp_active = None
        hp_pref = None
        bt_best = None

        for d in AudioUtilities.GetAllDevices():
            if not d or not getattr(d, "id", None):
                continue
            did = d.id
            if not str(did).startswith("{0.0.0"):
                continue
            name = getattr(d, "FriendlyName", "") or ""
            state = str(getattr(d, "state", "") or "")
            kind = _device_kind(name)
            if kind == "other":
                continue
            active = "Active" in state
            entry = {"id": did, "name": name, "state": state}

            if kind == "headphones":
                if hp_pref is None:
                    hp_pref = entry
                score = 0
                nl = name.lower()
                if nl.startswith("speakers"):
                    score += 4  # user's wired default
                if "high definition audio" in nl:
                    score += 3
                if "realtek" in nl:
                    score += 2
                if active:
                    score += 5
                if hp_active is None or score > hp_active.get("_score", -1):
                    e2 = dict(entry)
                    e2["_score"] = score
                    hp_active = e2
            elif kind == "bluetooth":
                # Prefer Active stereo Headphones over Hands-Free / NotPresent clones
                score = 0
                nl = name.lower()
                if active:
                    score += 20
                if nl.startswith("headphones"):
                    score += 8
                elif "hands-free" in nl:
                    score -= 5
                if default_id and did == default_id:
                    score += 15
                if bt_best is None or score > bt_best.get("_score", -1):
                    e2 = dict(entry)
                    e2["_score"] = score
                    bt_best = e2

        if default_id and default_kind == "headphones":
            hp_active = {"id": default_id, "name": default_name, "state": "Active", "_score": 99}
        if default_id and default_kind == "bluetooth":
            bt_best = {"id": default_id, "name": default_name, "state": "Active", "_score": 99}

        hp = hp_active or hp_pref
        bt = bt_best if (bt_best and "Active" in (bt_best.get("state") or "")) else None

        ui_kind = "headphones"
        if bt and default_id and default_id == bt.get("id"):
            ui_kind = "bluetooth"
        elif hp and default_id and default_id == hp.get("id"):
            ui_kind = "headphones"
        elif default_kind == "bluetooth" and bt:
            ui_kind = "bluetooth"

        return {
            "default_id": default_id,
            "default_name": _short_device_name(default_name) or default_name,
            "default_kind": ui_kind,
            "scenes": {
                "headphones": {
                    "id": (hp or {}).get("id", ""),
                    "name": _short_device_name((hp or {}).get("name", "")) or "Headphones",
                    "available": bool(hp and hp.get("id")),
                },
                "bluetooth": {
                    "id": (bt or {}).get("id", ""),
                    "name": _short_device_name((bt or {}).get("name", "")) or "Bluetooth",
                    "available": bool(bt),
                },
            },
        }
    except Exception:
        return empty


def action_audio_scene(scene: str) -> str:
    scene = (scene or "").strip().lower()
    if scene == "speakers":
        scene = "bluetooth"
    if scene not in ("headphones", "bluetooth"):
        return "bad scene"
    info = get_audio_payload()
    sc = info["scenes"].get(scene) or {}
    if not sc.get("available") or not sc.get("id"):
        if scene == "bluetooth":
            return "bluetooth offline"
        return f"{scene} unavailable"
    if not _set_default_endpoint(sc["id"]):
        return "switch failed"
    time.sleep(0.15)
    return f"{scene}: {sc.get('name') or scene}"


ACTIONS = {
    "mute": action_mute,
    "vol_up": action_vol_up,
    "vol_down": action_vol_down,
    "lock": action_lock,
    "cursor": action_open_cursor,
    "chrome": action_open_chrome,
    "telegram": action_open_telegram,
    "discord": action_open_discord,
    "steam": action_open_steam,
    "faceit": action_open_faceit,
    "faceit_ac": action_open_faceit_ac,
    "faceit_stack": action_open_faceit_stack,
    "cs2": action_open_cs2,
    "pubg": action_open_pubg,
    "media_play": lambda: action_media("play"),
    "media_pause": lambda: action_media("pause"),
}


def friendly_app(app: str) -> str:
    a = (app or "").lower()
    if not a:
        return ""
    if "chrome" in a or "google.chrome" in a:
        return "Chrome"
    if "spotify" in a:
        return "Spotify"
    if "telegram" in a:
        return "Telegram"
    if "discord" in a:
        return "Discord"
    if "msedge" in a or a.endswith("edge") or "microsoft.edge" in a:
        return "Edge"
    if "firefox" in a:
        return "Firefox"
    if "vlc" in a:
        return "VLC"
    if "itunes" in a or "applemusic" in a or "mediaplayer" in a:
        return "Music"
    if "yandex" in a:
        return "Yandex"
    if "firefox" in a:
        return "Firefox"
    # strip .exe leftovers
    if "\\" in app:
        app = app.split("\\")[-1]
    if app.lower().endswith(".exe"):
        app = app[:-4]
    return app[:18]


_EMPTY_NP = {
    "playing": False,
    "title": "",
    "artist": "",
    "app": "",
    "app_label": "",
    "status": "stopped",
    "has_art": False,
    "art_rev": 0,
}
_now_playing_cache: dict = dict(_EMPTY_NP)
_np_lock = threading.Lock()
_np_thread_started = False

_cover_lock = threading.Lock()
_cover_bytes: bytes | None = None
_cover_ctype = "image/jpeg"
_cover_key = ""
_cover_rev = 0


async def _thumb_from_props(props) -> tuple[bytes | None, str]:
    try:
        thumb = props.thumbnail
        if not thumb:
            return None, ""
        stream = await thumb.open_read_async()
        if not stream:
            return None, ""
        size = int(getattr(stream, "size", 0) or 0)
        if size <= 0 or size > 2_500_000:
            return None, ""
        ctype = str(getattr(stream, "content_type", "") or "image/jpeg")
        from winrt.windows.storage.streams import DataReader

        reader = DataReader(stream)
        await reader.load_async(size)
        buf = reader.read_buffer(size)
        data = bytes(buf)
        if data[:8].startswith(b"\x89PNG"):
            ctype = "image/png"
        elif data[:2] == b"\xff\xd8":
            ctype = "image/jpeg"
        return data, ctype
    except Exception:
        return None, ""


def _fetch_now_playing_async() -> dict:
    """Blocking read of Windows SMTC (call only from background thread)."""
    empty = dict(_EMPTY_NP)
    if platform.system() != "Windows":
        return empty
    try:
        import asyncio

        async def _read():
            from winrt.windows.media.control import (
                GlobalSystemMediaTransportControlsSessionManager as MediaManager,
                GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlayStatus,
            )

            mgr = await MediaManager.request_async()
            session = mgr.get_current_session()
            if not session:
                return empty, None, ""
            props = await session.try_get_media_properties_async()
            info = session.get_playback_info()
            status_name = "stopped"
            playing = False
            try:
                st = info.playback_status
                if st == PlayStatus.PLAYING:
                    status_name = "playing"
                    playing = True
                elif st == PlayStatus.PAUSED:
                    status_name = "paused"
                elif st == PlayStatus.STOPPED:
                    status_name = "stopped"
                else:
                    status_name = "other"
            except Exception:
                pass
            app = ""
            try:
                app = session.source_app_user_model_id or ""
                if "\\" in app:
                    app = app.split("\\")[-1]
                if app.lower().endswith(".exe"):
                    app = app[:-4]
            except Exception:
                pass
            title = (props.title or "").strip()
            artist = (props.artist or "").strip()
            if not title and not artist:
                return empty, None, ""
            art_bytes, art_ctype = await _thumb_from_props(props)
            payload = {
                "playing": playing,
                "title": title,
                "artist": artist,
                "app": app,
                "app_label": friendly_app(app),
                "status": status_name,
                "has_art": False,
                "art_rev": 0,
            }
            return payload, art_bytes, art_ctype

        payload, art_bytes, art_ctype = asyncio.run(_read())
        if not payload.get("title") and not payload.get("artist"):
            return empty

        key = f"{payload.get('title')}|{payload.get('artist')}|{payload.get('app')}"
        global _cover_bytes, _cover_ctype, _cover_key, _cover_rev
        with _cover_lock:
            if art_bytes:
                if key != _cover_key or art_bytes != _cover_bytes:
                    _cover_rev += 1
                _cover_bytes = art_bytes
                _cover_ctype = art_ctype or "image/jpeg"
                _cover_key = key
                payload["has_art"] = True
                payload["art_rev"] = _cover_rev
            else:
                if key != _cover_key:
                    _cover_bytes = None
                    _cover_key = key
                    _cover_rev += 1
                payload["has_art"] = bool(_cover_bytes) and _cover_key == key
                payload["art_rev"] = _cover_rev if payload["has_art"] else 0
        return payload
    except Exception:
        return empty


def _media_command_async(cmd: str) -> str:
    if platform.system() != "Windows":
        return "media unsupported"
    try:
        import asyncio

        async def _run():
            from winrt.windows.media.control import (
                GlobalSystemMediaTransportControlsSessionManager as MediaManager,
            )

            mgr = await MediaManager.request_async()
            session = mgr.get_current_session()
            if not session:
                return "no media session"
            if cmd == "play":
                await session.try_play_async()
                return "play"
            if cmd == "pause":
                await session.try_pause_async()
                return "pause"
            if cmd == "toggle":
                info = session.get_playback_info()
                try:
                    from winrt.windows.media.control import (
                        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlayStatus,
                    )

                    if info.playback_status == PlayStatus.PLAYING:
                        await session.try_pause_async()
                        return "pause"
                except Exception:
                    pass
                await session.try_play_async()
                return "play"
            return "unknown media cmd"

        return asyncio.run(_run())
    except Exception as exc:
        return f"media error: {exc}"


def action_media(cmd: str) -> str:
    result = _media_command_async(cmd)
    try:
        data = _fetch_now_playing_async()
        with _np_lock:
            _now_playing_cache.clear()
            _now_playing_cache.update(data)
    except Exception:
        pass
    return result


def get_now_playing() -> dict:
    with _np_lock:
        return dict(_now_playing_cache)


def get_cover() -> tuple[bytes | None, str]:
    with _cover_lock:
        return _cover_bytes, _cover_ctype


def _now_playing_worker() -> None:
    while True:
        try:
            data = _fetch_now_playing_async()
            with _np_lock:
                _now_playing_cache.clear()
                _now_playing_cache.update(data)
        except Exception:
            pass
        time.sleep(1.5)


def start_now_playing_worker() -> None:
    global _np_thread_started
    if _np_thread_started:
        return
    _np_thread_started = True
    th = threading.Thread(target=_now_playing_worker, name="now-playing", daemon=True)
    th.start()


# Living data (weather / alert / news) moved to static/gadget-core.js (client-side).


# Cached system bits — NEVER call pycaw/COM inside HTTP handlers (hangs old Safari).
_sys_lock = threading.Lock()
_audio_cache: dict = {
    "default_id": "",
    "default_name": "",
    "default_kind": "headphones",
    "scenes": {
        "headphones": {"id": "", "name": "Headphones", "available": False},
        "bluetooth": {"id": "", "name": "Bluetooth", "available": False},
    },
}
_sys_meta = {
    "hostname": socket.gethostname(),
    "os": f"{platform.system()} {platform.release()}",
    "python": platform.python_version(),
    "ips": [],
    "disk_free_gb": None,
}
_sys_thread_started = False


def get_audio_cached() -> dict:
    with _sys_lock:
        return dict(_audio_cache)


def _refresh_sys_cache() -> None:
    global _last_volume, _audio_cache
    try:
        if platform.system() == "Windows":
            real = _get_volume_windows()
            if real is not None:
                _last_volume = real
    except Exception:
        pass
    try:
        audio = get_audio_payload()
    except Exception:
        audio = None
    ips = lan_ips()
    disk = disk_free_gb()
    with _sys_lock:
        if audio:
            _audio_cache = audio
        _sys_meta["ips"] = ips
        _sys_meta["disk_free_gb"] = disk
        _sys_meta["hostname"] = socket.gethostname()


def _sys_worker() -> None:
    time.sleep(0.3)
    while True:
        try:
            _refresh_sys_cache()
        except Exception:
            pass
        time.sleep(2.0)


def start_sys_worker() -> None:
    global _sys_thread_started
    if _sys_thread_started:
        return
    _sys_thread_started = True
    th = threading.Thread(target=_sys_worker, name="sys-cache", daemon=True)
    th.start()


def status_payload() -> dict:
    """Fast path: only memory caches. Safe for concurrent tablet polls."""
    try:
        np = get_now_playing()
    except Exception:
        np = dict(_EMPTY_NP)
    with _sys_lock:
        audio = dict(_audio_cache)
        meta = dict(_sys_meta)
    return {
        "ok": True,
        "hostname": meta.get("hostname") or socket.gethostname(),
        "os": meta.get("os") or "",
        "python": meta.get("python") or "",
        "ips": meta.get("ips") or [],
        "disk_free_gb": meta.get("disk_free_gb"),
        "uptime_sec": int(time.time() - STARTED_AT),
        "platform": platform.system().lower(),
        "volume": _last_volume,
        "muted": _muted,
        "now_playing": np,
        "audio": audio,
    }


# Fixed home address for POWER card (Kyiv).
POWER_STREET = os.environ.get("IPAD_DECK_POWER_STREET", "вул. Здолбунівська")
POWER_HOUSE = os.environ.get("IPAD_DECK_POWER_HOUSE", "11/Б")
POWER_CITY = os.environ.get("IPAD_DECK_POWER_CITY", "м. Київ")
POWER_GROUP = os.environ.get("IPAD_DECK_POWER_GROUP", "45.1")
_dtek_cache: dict = {"t": 0.0, "data": None}
_dtek_lock = threading.Lock()

try:
    from curl_cffi import requests as cffi_requests  # type: ignore
except ImportError:  # pragma: no cover
    cffi_requests = None


def _http_text(url: str, data: bytes | None = None, headers: dict | None = None, timeout: float = 12.0) -> tuple[int, str, dict]:
    hdrs = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json,text/javascript,*/*;q=0.1",
    }
    if headers:
        hdrs.update(headers)
    jar = CookieJar()
    opener = build_opener(HTTPCookieProcessor(jar))
    req = Request(url, data=data, headers=hdrs, method="POST" if data is not None else "GET")
    try:
        with opener.open(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return int(getattr(resp, "status", 200) or 200), body, {k.lower(): v for k, v in resp.headers.items()}
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return int(e.code), body, {}
    except (URLError, TimeoutError, OSError) as e:
        return 0, str(e), {}


def _mins_hhmm(mins: int) -> str:
    mins = max(0, min(24 * 60, int(mins)))
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _dtek_hour_map_to_labels(hour_map: dict | None) -> list[str]:
    """Convert DTEK hour map (1..24 → yes/no/first/second) into HH:MM–HH:MM labels."""
    if not isinstance(hour_map, dict):
        return []
    segs: list[tuple[int, int]] = []
    for h in range(1, 25):
        v = str(hour_map.get(str(h), hour_map.get(h, "yes")) or "yes").lower()
        start = (h - 1) * 60
        if v == "no":
            segs.append((start, start + 60))
        elif v == "first":
            segs.append((start, start + 30))
        elif v in ("second", "last"):
            segs.append((start + 30, start + 60))
    if not segs:
        return []
    merged = [segs[0]]
    for a, b in segs[1:]:
        if a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return [f"{_mins_hhmm(a)}–{_mins_hhmm(b)}" for a, b in merged]


def _dtek_pick_house(data: dict) -> tuple[str | None, dict | None]:
    if not isinstance(data, dict):
        return None, None
    for key in (POWER_HOUSE, "11/Б", "11Б", "11б", "11b", "11B", "11"):
        if key in data and isinstance(data[key], dict):
            return key, data[key]
    for k, v in data.items():
        if "11" in str(k).replace(" ", "") and isinstance(v, dict):
            return str(k), v
    return None, None


def _dtek_day_sched(fact: dict, group: str, which: str) -> dict:
    out = {
        "which": which,
        "date": "",
        "labels": [],
        "text": "немає слотів у DTEK",
        "source": "DTEK",
        "group": group,
    }
    data = (fact or {}).get("data") if isinstance(fact, dict) else None
    if not isinstance(data, dict) or not data:
        return out
    gkey = "GPV" + str(group).replace("GPV", "")
    today_ts = str((fact or {}).get("today") or "")
    items = sorted(((str(ts), groups) for ts, groups in data.items()), key=lambda x: int(x[0]) if str(x[0]).isdigit() else 0)
    chosen = None
    if which == "today" and today_ts and today_ts in data:
        chosen = (today_ts, data[today_ts])
    elif which == "tomorrow" and today_ts and today_ts.isdigit():
        tom_ts = str(int(today_ts) + 86400)
        if tom_ts in data:
            chosen = (tom_ts, data[tom_ts])
    if chosen is None:
        # fallback: first / second chronologically
        if which == "today" and items:
            chosen = items[0]
        elif which == "tomorrow" and len(items) > 1:
            chosen = items[1]
    if not chosen:
        return out
    ts, groups = chosen
    if ts.isdigit():
        try:
            out["date"] = time.strftime("%Y-%m-%d", time.gmtime(int(ts) + 3 * 3600))
        except (OverflowError, OSError, ValueError):
            out["date"] = ""
    hour_map = None
    if isinstance(groups, dict):
        hour_map = groups.get(gkey) or groups.get(group) or groups.get("GPV" + group)
    labels = _dtek_hour_map_to_labels(hour_map if isinstance(hour_map, dict) else None)
    out["labels"] = labels
    out["text"] = " · ".join(labels[:3]) if labels else ("без відключень" if hour_map else "немає слотів у DTEK")
    return out


def fetch_dtek_power() -> dict:
    """DTEK Kyiv address status + fact schedule (today/tomorrow) via AJAX.

    Uses curl_cffi Chrome impersonation to clear Incapsula/WAF.
    """
    now = time.time()
    with _dtek_lock:
        if _dtek_cache["data"] is not None and (now - float(_dtek_cache["t"])) < 90:
            return dict(_dtek_cache["data"])

    out: dict = {
        "ok": False,
        "error": "dtek_unavailable",
        "group": POWER_GROUP,
        "street": POWER_STREET,
        "house": POWER_HOUSE,
    }
    if cffi_requests is None:
        out["error"] = "dtek_missing_curl_cffi"
        with _dtek_lock:
            _dtek_cache["t"] = now
            _dtek_cache["data"] = out
        return out

    base = "https://www.dtek-kem.com.ua"
    try:
        sess = cffi_requests.Session(impersonate="chrome124")
        page = sess.get(base + "/ua/shutdowns", timeout=25)
        html = page.text or ""
        if page.status_code != 200 or len(html) < 2000 or "csrf-token" not in html.lower():
            out["error"] = "dtek_blocked"
            with _dtek_lock:
                _dtek_cache["t"] = now
                _dtek_cache["data"] = out
            return out
        m = re.search(r'name="csrf-token"\s+content="([^"]+)"', html, re.I)
        if not m:
            m = re.search(r'content="([^"]+)"\s+name="csrf-token"', html, re.I)
        csrf = m.group(1) if m else ""
        form = urlencode(
            {
                "method": "getHomeNum",
                "data[0][name]": "city",
                "data[0][value]": POWER_CITY,
                "data[1][name]": "street",
                "data[1][value]": POWER_STREET,
                "data[2][name]": "updateFact",
                "data[2][value]": str(int(now)),
            }
        )
        headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": base + "/ua/shutdowns",
            "Origin": base,
            "Accept": "application/json, text/javascript, */*; q=0.01",
        }
        if csrf:
            headers["X-CSRF-Token"] = csrf
        resp = sess.post(base + "/ua/ajax", data=form, headers=headers, timeout=25)
        payload = resp.json() if resp.status_code == 200 else {}
    except Exception as e:
        out["error"] = f"dtek_http:{type(e).__name__}"
        with _dtek_lock:
            _dtek_cache["t"] = now
            _dtek_cache["data"] = out
        return out

    data = payload.get("data") if isinstance(payload, dict) else None
    fact = payload.get("fact") if isinstance(payload, dict) else {}
    house_key, house = _dtek_pick_house(data if isinstance(data, dict) else {})
    group = POWER_GROUP
    reason = ""
    restore = ""
    current_off = False
    emergency = False
    if isinstance(house, dict):
        groups = house.get("sub_type_reason") or []
        if isinstance(groups, str):
            groups = [groups]
        if groups:
            group = str(groups[0]).replace("GPV", "") or POWER_GROUP
        reason = str(house.get("sub_type") or house.get("reason") or "")
        restore = str(house.get("end_date") or "")
        msg = json.dumps(house, ensure_ascii=False).lower()
        if "аварій" in msg or str(house.get("type") or "") in ("2", "3"):
            emergency = True
            current_off = True
        if "відсутня електроенергія" in msg:
            current_off = True

    today_sched = _dtek_day_sched(fact if isinstance(fact, dict) else {}, group, "today")
    tomorrow_sched = _dtek_day_sched(fact if isinstance(fact, dict) else {}, group, "tomorrow")
    # Persist labels also as slots for older clients
    slots = [{"label": x} for x in (today_sched.get("labels") or [])]

    out = {
        "ok": True,
        "group": group,
        "current_off": current_off,
        "emergency": emergency,
        "reason": reason,
        "restore": restore,
        "street": POWER_STREET,
        "house": house_key or POWER_HOUSE,
        "fact_update": (fact or {}).get("update") if isinstance(fact, dict) else "",
        "today_sched": today_sched,
        "tomorrow_sched": tomorrow_sched,
        "slots": slots,
        "source": "DTEK",
    }
    with _dtek_lock:
        _dtek_cache["t"] = now
        _dtek_cache["data"] = out
    return out


def fetch_yasno_power() -> dict:
    url = "https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/25/dsos/902/planned-outages"
    code, body, _ = _http_text(url, timeout=12.0)
    if code != 200:
        return {"ok": False, "error": "yasno_http", "group": POWER_GROUP}
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return {"ok": False, "error": "yasno_json", "group": POWER_GROUP}
    g = data.get(POWER_GROUP) or {}
    today = g.get("today") or {}
    return {
        "ok": True,
        "group": POWER_GROUP,
        "status": today.get("status"),
        "emergency": str(today.get("status") or "") == "EmergencyShutdowns",
        "slots": today.get("slots") or [],
        "updatedOn": g.get("updatedOn") or today.get("date"),
    }


class DeckHandler(SimpleHTTPRequestHandler):
    # Old iOS Safari often hangs on HTTP/1.1 keep-alive.
    protocol_version = "HTTP/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        if os.environ.get("IPAD_DECK_DEBUG") == "1":
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, code: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, code: int, data: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self) -> None:
        # Kill caching — iOS "Add to Home Screen" keeps a separate sticky cache.
        try:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Connection", "close")
        except Exception:
            pass
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Connection", "close")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/ping":
            self._json(200, {"ok": True, "t": int(time.time())})
            return
        if path == "/api/status":
            self._json(200, status_payload())
            return
        if path == "/api/nowplaying":
            self._json(200, {"ok": True, **get_now_playing()})
            return
        if path == "/api/cover":
            data, ctype = get_cover()
            if not data:
                self._json(404, {"ok": False, "error": "no cover"})
                return
            self._bytes(200, data, ctype or "image/jpeg")
            return
        if path == "/api/power/dtek":
            self._json(200, fetch_dtek_power())
            return
        if path == "/api/power/yasno":
            self._json(200, fetch_yasno_power())
            return
        if path in ("/", "/index.html"):
            # Always serve fresh index bytes (bypass SimpleHTTP file cache quirks).
            index_path = STATIC / "index.html"
            try:
                raw = index_path.read_bytes()
            except OSError:
                self._json(500, {"ok": False, "error": "missing index"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(raw)
            return
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/api/action":
            self._json(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "bad json"})
            return
        name = str(data.get("name", "")).strip()
        if name == "vol_set":
            try:
                result = action_vol_set(data.get("value", 50))
                try:
                    _refresh_sys_cache()
                except Exception:
                    pass
                self._json(200, {"ok": True, "action": name, "result": result, "volume": _last_volume})
            except Exception as exc:  # noqa: BLE001
                self._json(500, {"ok": False, "action": name, "error": str(exc)})
            return
        if name == "audio_scene":
            try:
                result = action_audio_scene(str(data.get("value") or data.get("scene") or ""))
                try:
                    _refresh_sys_cache()
                except Exception:
                    pass
                self._json(200, {"ok": True, "action": name, "result": result, "audio": get_audio_cached()})
            except Exception as exc:  # noqa: BLE001
                self._json(500, {"ok": False, "action": name, "error": str(exc)})
            return
        fn = ACTIONS.get(name)
        if not fn:
            self._json(400, {"ok": False, "error": f"unknown action: {name}"})
            return
        try:
            result = fn()
            payload = {"ok": True, "action": name, "result": result}
            if name in ("mute", "vol_up", "vol_down", "vol_set"):
                payload["volume"] = _last_volume
                payload["muted"] = _muted
                try:
                    _refresh_sys_cache()
                except Exception:
                    pass
            self._json(200, payload)
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"ok": False, "action": name, "error": str(exc)})


def open_firewall_hint(port: int) -> None:
    if platform.system() != "Windows":
        return
    try:
        subprocess.run(
            [
                "netsh",
                "advfirewall",
                "firewall",
                "add",
                "rule",
                "name=Textmode Deck Hub",
                "dir=in",
                "action=allow",
                "protocol=TCP",
                f"localport={port}",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        pass


def main() -> None:
    if not STATIC.exists():
        print(f"Missing static folder: {STATIC}", file=sys.stderr)
        sys.exit(1)

    start_sys_worker()
    start_now_playing_worker()
    open_firewall_hint(PORT)
    httpd = ThreadingHTTPServer((HOST, PORT), DeckHandler)
    # Avoid hanging forever on a dead half-open tablet connection.
    try:
        httpd.timeout = 2
    except Exception:
        pass
    ips = lan_ips() or ["127.0.0.1"]

    print("=" * 48)
    print("  Textmode Deck Hub")
    print("=" * 48)
    print(f"  Local:   http://127.0.0.1:{PORT}/")
    for ip in ips:
        print(f"  iPad:    http://{ip}:{PORT}/")
    print("  Ctrl+C to stop")
    print("=" * 48)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.server_close()


if __name__ == "__main__":
    main()
