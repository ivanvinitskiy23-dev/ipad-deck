# HANDOFF — v94: новые фичи для ipad-deck

Документ для агента-исполнителя с доступом к push. Написан по состоянию кода на
коммите `6bbf95d` («Polish CASIO theme…»). Номера строк — ориентиры, при расхождении
ищи по якорям (имена функций / ID элементов).

---

## 0. Критичные правила проекта (не нарушать)

1. **Клиентский JS — строго ES5.** Файлы начинаются с `/* Textmode Deck app shell — ES5 */`.
   Никаких `let/const`, стрелочных функций, template literals, `fetch()` — только `XMLHttpRequest`
   (старый iPad Safari + ES5-шапка). Серверный Python — современный (3.10+, `X | None` ок).
2. **Кэш iOS липкий.** Любое изменение `static/*` требует бампа версии: `?v=93` → `?v=94` во всех местах:
   - `static/index.html:13` (link deck.css), `:292-293` (оба `<script>`)
   - `static/index.html:286` (`#tipUrl`)
   - `README.md` (два вхождения `?v=93`)
3. **Не ломать long-poll.** `/api/events` (server.py:2520) держит соединение до 20 c на
   `_state_cond` + `protocol_version = "HTTP/1.0"`. Новые эндпоинты делать по образцу
   существующих: `self._json(...)`, CORS `*`, `Connection: close`.
4. **Никакого build-шага.** Ни npm, ни бандлеров. Голые файлы в `static/`.
5. **Стиль коммитов** — как в истории: `Add clipboard bridge between iPad and PC.` /
   `Ship v94: boot anim, CRT FX, net vitals.` Один фича-коммит = одна фича из этого документа.
6. `tools/LibreHardwareMonitor/` — бинарники, gitignored (кроме README и .config.example). Не трогать.
7. Тест сервера на Windows: `python server.py` → порт 8787. Клиент: iPad в той же Wi-Fi,
   после правок — пересоздать иконку Home Screen, если обычный reload не подхватил новую версию.

---

## 1. F1 — CLIPBOARD: мост буферов обмена iPad ⇄ ПК

**Цель:** скопировал на планшете → кнопка → текст в буфере Windows (и обратно).
Самая полезная фича за минимальный код.

### 1.1. Сервер — `server.py`

Вставить рядом с `action_lock` (после server.py:166, до `_first_existing`):

```python
_CLIP_LENGTH_CAP = 20000  # powershell cmdline safety (~32k limit)


def get_clipboard_text() -> str:
    """Read Windows clipboard via PowerShell; base64 avoids codepage issues."""
    if platform.system() != "Windows":
        return ""
    try:
        out = subprocess.run(
            [
                "powershell", "-NoProfile", "-STA", "-Command",
                "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("
                "[string](Get-Clipboard -Raw)))",
            ],
            capture_output=True, text=True, timeout=4, check=False,
        )
        raw = (out.stdout or "").strip()
        if out.returncode != 0 or not raw:
            return ""
        return base64.b64decode(raw).decode("utf-8", "replace")
    except Exception:
        return ""


def set_clipboard_text(text: str) -> str:
    if platform.system() != "Windows":
        return "clipboard: windows only"
    text = (text or "")[:_CLIP_LENGTH_CAP]
    if not text.strip():
        return "empty"
    b64 = base64.b64encode(text.encode("utf-8")).decode("ascii")
    try:
        out = subprocess.run(
            [
                "powershell", "-NoProfile", "-STA", "-Command",
                "Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString("
                f"[Convert]::FromBase64String('{b64}')))",
            ],
            capture_output=True, text=True, timeout=4, check=False,
        )
        return "copied to PC" if out.returncode == 0 else "set failed"
    except Exception as exc:  # noqa: BLE001
        return f"set failed: {exc}"
```

Роут GET — в `do_GET` (server.py:2511), рядом с `/api/ping`:

```python
        if path == "/api/clipboard":
            self._json(200, {"ok": True, "text": get_clipboard_text()})
            return
```

POST — в `do_POST` (server.py:2607), по образцу `clutch_duck` (спец-кейс до `ACTIONS`):

```python
        if name == "clip_set":
            try:
                result = set_clipboard_text(str(data.get("value") or ""))
                self._json(200, {"ok": True, "action": name, "result": result})
            except Exception as exc:  # noqa: BLE001
                self._json(500, {"ok": False, "action": name, "error": str(exc)})
            return
```

### 1.2. Клиент — `static/index.html`

Внутрь `#hubFold` (index.html:257-264), после кнопки `#hubSave`:

```html
        <div class="clip-bar">
          <textarea id="clipField" rows="3" spellcheck="false"
            placeholder="CLIPBOARD — мост iPad ⇄ ПК"></textarea>
          <div class="clip-row">
            <button type="button" class="drawer-btn" id="clipPull">↑ Pull с ПК</button>
            <button type="button" class="drawer-btn" id="clipPush">↓ Send на ПК</button>
            <button type="button" class="drawer-btn" id="clipCopy">⧉ Копир. на iPad</button>
          </div>
        </div>
```

### 1.3. Клиент — `static/deck-app.js`

Функции — рядом с `goToHubDeck` (~deck-app.js:332). Гард через `GC.canUseHubApi()`
(gadget-core.js:176), тянуть текст через `GC.xhrGet(url, timeout, onOk, onFail)` (gadget-core.js:206).

```js
      function copyLocalFromClipField() {
        /* http://LAN — не secure context: navigator.clipboard на iOS заблокирован.
           execCommand('copy') работает только внутри жеста тапа — потому и вызов
           напрямую из onclick, не из колбэка XHR. */
        try {
          var ta = document.getElementById("clipField");
          ta.focus();
          ta.setSelectionRange(0, ta.value.length);
          return document.execCommand("copy");
        } catch (e) { return false; }
      }

      function clipPull() {
        if (!GC || !GC.canUseHubApi()) { toast("hub offline"); return; }
        toast("…");
        GC.xhrGet(GC.apiUrl("/api/clipboard"), 6000, function (txt) {
          try {
            var r = JSON.parse(txt);
            document.getElementById("clipField").value = r.text || "";
            toast("pulled " + (r.text || "").length + " chars");
          } catch (e) { toast("bad reply"); }
        }, function () { toast("hub offline"); });
      }

      function clipPush() {
        if (!GC || !GC.canUseHubApi()) { toast("hub offline"); return; }
        var text = document.getElementById("clipField").value || "";
        if (!text) { toast("empty"); return; }
        toast("…");
        var xhr = new XMLHttpRequest();
        xhr.open("POST", hubPath("/api/action"), true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.timeout = 8000;
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          try {
            var r = JSON.parse(xhr.responseText || "{}");
            toast(r.ok ? (r.result || "ok") : (r.error || "fail"));
          } catch (e) { toast("fail"); }
        };
        xhr.send(JSON.stringify({ name: "clip_set", value: text }));
      }
```

Обвязка кнопок — рядом с `document.getElementById("hubSave").onclick` (~deck-app.js:319):

```js
      document.getElementById("clipPull").onclick = function () { clipPull(); };
      document.getElementById("clipPush").onclick = function () { clipPush(); };
      document.getElementById("clipCopy").onclick = function () {
        toast(copyLocalFromClipField() ? "copied on iPad" : "copy failed");
      };
```

### 1.4. CSS — `static/deck.css`

В секцию drawer-стилей (рядом с `.hub-field`):

```css
.clip-bar { display: block; margin: 8px 0; }
.clip-bar textarea {
  width: 100%; box-sizing: border-box; background: var(--panel); color: var(--ink);
  border: 1px solid var(--line); font: inherit; font-size: 12px; padding: 8px;
  border-radius: 0; resize: vertical;
}
.clip-row { display: flex; gap: 6px; margin-top: 6px; }
.clip-row .drawer-btn { flex: 1; margin: 0; }
```

### 1.5. Проверка

```
curl http://127.0.0.1:8787/api/clipboard
curl -X POST -H "Content-Type: application/json" -d "{\"name\":\"clip_set\",\"value\":\"hello from curl\"}" http://127.0.0.1:8787/api/action
→ затем Ctrl+V в блокноте на ПК должно вставить «hello from curl»
```

---

## 2. F2 — BOOT sequence: BIOS-POST при загрузке

**Цель:** при холодном старте PWA — чёрный экран, «простукивание» RAM, `IPAD-DECK BIOS v9.4`,
затем CRT-анимация «включения луча». Идеально ложится на эстетику. Один раз за сессию
(`sessionStorage`), тумблер отключения в MENU.

### 2.1. `static/index.html`

Сразу после `<body>` (перед `#app`):

```html
  <div id="boot" aria-hidden="true"><pre id="bootLog"></pre></div>
```

### 2.2. `static/deck.css`

```css
/* ── BOOT sequence ─────────────────────────────── */
#boot { position: fixed; inset: 0; z-index: 300; background: #000;
  display: flex; align-items: center; justify-content: center; }
#boot.off { display: none; }
#boot pre { font-family: inherit; font-size: 13px; line-height: 1.7;
  color: var(--accent, #39ff14); text-shadow: 0 0 8px var(--glow, rgba(57,255,20,.5)); margin: 0; }
@-webkit-keyframes crtOn { 0% { -webkit-transform: scaleY(0.012); opacity: .4; }
  55% { -webkit-transform: scaleY(1.03); opacity: 1; } 100% { -webkit-transform: scaleY(1); } }
@keyframes crtOn { 0% { transform: scaleY(0.012); opacity: .4; }
  55% { transform: scaleY(1.03); opacity: 1; } 100% { transform: scaleY(1); } }
#app.boot-on { -webkit-animation: crtOn .4s ease-out; animation: crtOn .4s ease-out; }
```

### 2.3. `static/deck-app.js`

В начале IIFE (сразу после `var appEl = …`, deck-app.js:94):

```js
      /* ── BOOT sequence (раз за сессию; тумблер в MENU) ── */
      var bootSkip = false;
      try { bootSkip = sessionStorage.getItem("booted") === "1"; } catch (e) {}
      try { if (localStorage.getItem("deck.boot") === "off") bootSkip = true; } catch (e) {}
      var BOOT_LINES = [
        "IPAD-DECK BIOS  v9.4",
        "",
        "CPU ......... TEXTMODE-1 @ 33MHz ... OK",
        "RAM CHECK ... 4096K ................ OK",
        "PHOSPHOR .... GREEN P1 .............. OK",
        "SYNC ........ 50Hz .................. OK",
        "HUB LINK .... PROBING LAN ...........",
        "",
        "NIGHTWIRE SHELL READY",
        ""
      ];
      (function runBoot() {
        var bootEl = document.getElementById("boot");
        var log = document.getElementById("bootLog");
        function finish() {
          try { sessionStorage.setItem("booted", "1"); } catch (e) {}
          if (bootEl) bootEl.className = "off";
          if (!bootSkip) {
            appEl.className = (appEl.className || "") + " boot-on";
            setTimeout(function () {
              appEl.className = (appEl.className || "").replace(" boot-on", "");
            }, 600);
          }
        }
        if (bootSkip || !bootEl) { finish(); return; }
        var li = 0, ci = 0, buf = "";
        var iv = setInterval(function () {
          if (li >= BOOT_LINES.length) {
            clearInterval(iv);
            setTimeout(finish, 400);
            return;
          }
          var line = BOOT_LINES[li];
          if (ci < line.length) { buf += line.charAt(ci); ci++; }
          else { buf += "\n"; li++; ci = 0; }
          log.textContent = buf + "\u2588";
        }, 7);
      })();
```

Тумблер — см. §3.3 (общие кнопки `#bootBtn` / `#crtFxBtn`).

---

## 3. F3 — CRT FX pack: скан-линии + виньетка + фликер

**Цель:** опциональный «настоящий CRT» поверх любой темы. Отдельный overlay-`div`
(НЕ псевдоэлементы `#app` — на них могут быть заняты), `pointer-events: none`,
только градиенты и opacity — старый iPad тянет без просадок. **По умолчанию OFF**
(перф + вкус), включается тумблером в MENU.

### 3.1. `static/index.html`

Перед `#toast` (index.html:222):

```html
  <div id="crtfx" aria-hidden="true"></div>
```

### 3.2. `static/deck.css`

```css
/* ── CRT FX (toggle #crtfx.on) ─────────────────── */
#crtfx { position: fixed; inset: 0; z-index: 250; pointer-events: none; display: none; }
#crtfx.on { display: block; }
#crtfx.on::before { content: ""; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px); }
#crtfx.on::after { content: ""; position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.35) 100%); }
#crtfx.on.flicker { -webkit-animation: crtFlicker 7s steps(1) infinite;
  animation: crtFlicker 7s steps(1) infinite; }
@-webkit-keyframes crtFlicker {
  0%, 91% { opacity: 1; } 92% { opacity: .93; } 93% { opacity: 1; }
  96% { opacity: .97; } 97%, 100% { opacity: 1; } }
@keyframes crtFlicker {
  0%, 91% { opacity: 1; } 92% { opacity: .93; } 93% { opacity: 1; }
  96% { opacity: .97; } 97%, 100% { opacity: 1; } }
```

### 3.3. `static/deck-app.js`

Хранение состояния — рядом с `readTheme` (deck-app.js:160):

```js
      function readFlag(key, dflt) {
        try { var v = localStorage.getItem(key); return v === null ? dflt : v === "1"; }
        catch (e) { return dflt; }
      }
      function writeFlag(key, on) {
        try { localStorage.setItem(key, on ? "1" : "0"); } catch (e) {}
      }
      var crtFx = readFlag("deck.crtfx", false);
      var bootAnim = readFlag("deck.boot", true);
      function syncFx() {
        var el = document.getElementById("crtfx");
        if (el) el.className = crtFx ? "on" : "";
        var b = document.getElementById("crtFxBtn");
        if (b) b.textContent = "CRT FX: " + (crtFx ? "on" : "off");
        var ab = document.getElementById("bootBtn");
        if (ab) ab.textContent = "Boot anim: " + (bootAnim ? "on" : "off");
      }
```

Вызов `syncFx()` добавить в конец `syncBodyClass()` (deck-app.js:181-203).

### 3.4. `static/index.html` — тумблеры в drawer

После блока `#drawerThemes` (index.html:248-253), перед `.side-brand`:

```html
      <div class="fx-pills">
        <button type="button" class="drawer-btn" id="crtFxBtn">CRT FX: off</button>
        <button type="button" class="drawer-btn" id="bootBtn">Boot anim: on</button>
      </div>
```

### 3.5. `static/deck-app.js` — обвязка тумблеров

Рядом с `cinemaBtn` onclick (deck-app.js:298):

```js
      document.getElementById("crtFxBtn").onclick = function () {
        crtFx = !crtFx; writeFlag("deck.crtfx", crtFx); syncFx(); toast(crtFx ? "CRT FX on" : "CRT FX off");
      };
      document.getElementById("bootBtn").onclick = function () {
        bootAnim = !bootAnim; writeFlag("deck.boot", bootAnim); syncFx();
        try { if (!bootAnim) sessionStorage.setItem("booted", "1"); } catch (e) {}
        toast(bootAnim ? "boot anim on (next load)" : "boot anim off");
      };
```

---

## 4. F4 — NET & DISK виталы: ↓/↑ скорость + свободное место

**Цель:** в заголовке DECK — живая скорость сети и свободное место на дисках.
psutil уже в requirements; `disk_free_gb()` уже есть (server.py:55).

### 4.1. Сервер — `server.py`

Рядом с `disk_free_gb` (server.py:63):

```python
_net_last: tuple[float, tuple[int, int]] | None = None


def net_rates() -> dict:
    """LAN up/down rates from psutil counters (cheap, non-blocking)."""
    global _net_last
    try:
        import psutil

        now = time.time()
        io = psutil.net_io_counters()
        cur = (io.bytes_sent, io.bytes_recv)
        if _net_last is None:
            _net_last = (now, cur)
            return {"up_kbps": 0.0, "down_kbps": 0.0}
        t0, prev = _net_last
        dt = now - t0
        if dt <= 0:
            return {"up_kbps": 0.0, "down_kbps": 0.0}
        up = max(0.0, (cur[0] - prev[0]) / dt / 1024.0)
        down = max(0.0, (cur[1] - prev[1]) / dt / 1024.0)
        _net_last = (now, cur)
        return {"up_kbps": round(up, 1), "down_kbps": round(down, 1)}
    except Exception:
        return {"up_kbps": 0.0, "down_kbps": 0.0}


def disks_payload() -> list[dict]:
    out: list[dict] = []
    for letter in ("C:", "D:"):
        free = disk_free_gb(letter + "\\")
        if free is not None:
            out.append({"drive": letter, "free_gb": free})
    return out
```

В `_sys_worker()` (server.py:1492) — внутрь цикла обновления кэша, рядом с
существующим заполнением `_sys_meta` (под `_sys_lock`), добавить:

```python
            _sys_meta["net"] = net_rates()
            _sys_meta["disks"] = disks_payload()
```

(Если `_refresh_sys_cache()` тоже заполняет `_sys_meta` синхронно — туда же.)
В `status_payload()` (server.py:1519) добавить в возвращаемый dict:

```python
        "net": meta.get("net") or {"up_kbps": 0.0, "down_kbps": 0.0},
        "disks": meta.get("disks") or [],
```

### 4.2. Клиент

`static/index.html` — рядом с `#hubStats` (index.html:24):

```html
            <span class="hub-net" id="hubNet"></span>
```

`static/deck-app.js` — утилиты (рядом с `setHubStats`, deck-app.js:136):

```js
      function fmtKbps(v) {
        if (v >= 1024) return (v / 1024).toFixed(1) + " Mb";
        return Math.round(v) + " Kb";
      }
      function syncNetLine(st) {
        var el = document.getElementById("hubNet");
        if (!el || !st) return;
        var n = st.net;
        if (!n) { el.textContent = ""; return; }
        var s = "\u2193" + fmtKbps(n.down_kbps || 0) + " \u2191" + fmtKbps(n.up_kbps || 0);
        var disks = st.disks || [];
        for (var i = 0; i < disks.length; i++) {
          s += " · " + disks[i].drive + " " + disks[i].free_gb + "G";
        }
        el.textContent = s;
      }
```

Вызов `syncNetLine(st)` — там, где уже разбирается ответ `/api/status` / `/api/events`
(искать использование `setHubStats`, deck-app.js:136 — туда передаётся статус).

`static/deck.css`:

```css
.hub-net { color: var(--dim); font-size: 10px; letter-spacing: .5px; }
```

---

## 5. F5 — MACROS: вайтлист-кнопки (Sleep PC, Flush DNS, Recycle Bin)

**Цель:** одно-тапные системные действия. ⚠️ Только вайтлист на сервере —
сервер принимает `value` исключительно из словаря `MACROS`, никаких произвольных
команд с планшета (у POST нет auth на LAN — см. §7).

### 5.1. Сервер — `server.py`

Рядом с `ACTIONS` (server.py:778):

```python
def _macro_flush_dns() -> str:
    out = subprocess.run(["ipconfig", "/flushdns"], capture_output=True, text=True, check=False)
    return "dns flushed" if out.returncode == 0 else "flush failed"


def _macro_empty_recycle() -> str:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"],
        capture_output=True, text=True, check=False,
    )
    return "recycle bin emptied" if out.returncode == 0 else "clean failed"


def _macro_sleep_pc() -> str:
    if platform.system() != "Windows":
        return "windows only"
    subprocess.Popen(
        ["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return "sleep requested"


MACROS: dict = {
    "flush_dns": _macro_flush_dns,
    "recycle_empty": _macro_empty_recycle,
    "sleep_pc": _macro_sleep_pc,
}


def action_macro(name: str) -> str:
    fn = MACROS.get((name or "").strip())
    if not fn:
        return f"unknown macro: {name}"
    return fn()
```

В `do_POST` (server.py:2607), спец-кейсом рядом с `clip_set`:

```python
        if name == "macro":
            try:
                result = action_macro(str(data.get("value") or ""))
                self._json(200, {"ok": True, "action": name, "result": result})
            except Exception as exc:  # noqa: BLE001
                self._json(500, {"ok": False, "action": name, "error": str(exc)})
            return
```

### 5.2. Клиент

`static/index.html` — расширить ряд OPS (index.html:213-216):

```html
        <div class="row deck-only">
          <button class="pad leaf" data-macro="flush_dns"><span class="ico ico-cu"></span><span class="lbl">Flush DNS</span></button>
          <button class="pad leaf" data-macro="recycle_empty"><span class="ico ico-cu"></span><span class="lbl">Recycle</span></button>
          <button class="pad warn" data-macro="sleep_pc"><span class="ico ico-lk"></span><span class="lbl">Sleep PC</span></button>
        </div>
```

`static/deck-app.js` — найти делегирование кликов по `[data-action]` (по `.pad`,
искать `getAttribute("data-action")`) и добавить рядом аналогичный обработчик:

```js
      function doMacro(name) {
        if (!GC || !GC.canUseHubApi()) { toast("hub offline"); return; }
        toast("…");
        var xhr = new XMLHttpRequest();
        xhr.open("POST", hubPath("/api/action"), true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.timeout = 8000;
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          try {
            var r = JSON.parse(xhr.responseText || "{}");
            toast(r.ok ? (r.result || "ok") : (r.error || "fail"));
          } catch (e) { toast("fail"); }
        };
        xhr.send(JSON.stringify({ name: "macro", value: name }));
      }
```

(в самом делегаторе: `var m = t.getAttribute && t.getAttribute("data-macro"); if (m) { doMacro(m); return; }`)

---

## 6. F6 — Мультистраничный DECK (спека + скелет)

**Цель:** DECK-грид растёт (mixer, launch, OPS, macros) — разбить на страницы со свайпом.
Это самая инвазивная правка; делать **последней**, после F1-F5.

### 6.1. Разметка

`.grid` (index.html:162-217) — обернуть deck-only секции в страницы:

```html
<div class="grid deck-pages" id="deckPages">
  <div class="deck-page" data-page="0"> …vol-card (AUDIO BUS + scenes + mixer)… </div>
  <div class="deck-page" data-page="1"> …LAUNCH rows + macro row… </div>
  <div class="deck-page" data-page="2"> …OPS rows… </div>
  <div class="deck-dots" id="deckDots"></div>
</div>
```

Важно: **перемещать существующие ноды, не пересоздавать** — тогда навешанные onclick
не отвалятся.

### 6.2. CSS

```css
.deck-page { display: none; }
.deck-page.on { display: block; }
.deck-dots { display: flex; gap: 8px; justify-content: center; padding: 10px 0 4px; }
.deck-dot { width: 8px; height: 8px; border: 1px solid var(--dim); background: transparent; padding: 0; }
.deck-dot.on { background: var(--accent); border-color: var(--accent); }
```

### 6.3. JS (скелет)

```js
      var deckPage = 0;
      try { deckPage = parseInt(localStorage.getItem("deck.page") || "0", 10) || 0; } catch (e) {}
      function syncDeckPage() {
        var pages = document.querySelectorAll(".deck-page");
        var dots = document.getElementById("deckDots");
        var max = pages.length;
        if (deckPage >= max) deckPage = 0;
        for (var i = 0; i < pages.length; i++) {
          pages[i].className = "deck-page" + (i === deckPage ? " on" : "");
        }
        if (dots) {
          var html = "";
          for (var d = 0; d < max; d++) {
            html += '<button type="button" class="deck-dot' + (d === deckPage ? " on" : "") +
              '" data-pg="' + d + '"></button>';
          }
          dots.innerHTML = html;
        }
        try { localStorage.setItem("deck.page", String(deckPage)); } catch (e) {}
      }
      /* свайп по гридам — по образцу свайпа #header (deck-app.js:383-399) */
      var gridEl = document.getElementById("deckPages");
      if (gridEl) {
        gridEl.addEventListener("touchstart", function (e) {
          gridEl._x0 = e.touches[0].clientX;
        }, { passive: true });
        gridEl.addEventListener("touchend", function (e) {
          var dx = (e.changedTouches[0].clientX || 0) - (gridEl._x0 || 0);
          if (Math.abs(dx) > 44) {
            deckPage += dx < 0 ? 1 : -1;
            var max = document.querySelectorAll(".deck-page").length;
            if (deckPage < 0) deckPage = max - 1;
            if (deckPage >= max) deckPage = 0;
            syncDeckPage();
          }
        }, { passive: true });
      }
```

`syncDeckPage()` дергать в `setMode()` при входе в deck (deck-app.js:204).
Доты: делегированный клик по `#deckDots` → `deckPage = +btn.dataset.pg; syncDeckPage();`
(ES5: `getAttribute("data-pg")`).

---

## 7. F7 (опционально, но рекомендую) — PIN на /api/*

Сервер слушает `0.0.0.0` без auth: любой в Wi-Fi может лочить ПК и крутить громкость.
Минимальный фикс — ключ через env, проверка в одном месте.

### 7.1. Сервер

Рядом с `HOST/PORT` (server.py:30):

```python
PIN = os.environ.get("IPAD_DECK_PIN", "").strip()
```

Метод хендлера (в класс `DeckHandler`, server.py:2460):

```python
    def _key_ok(self) -> bool:
        if not PIN:
            return True
        import hmac

        auth = self.headers.get("X-Deck-Key", "")
        if auth and hmac.compare_digest(auth, PIN):
            return True
        got = (parse_qs(urlparse(self.path).query).get("key") or [""])[0]
        return bool(got) and hmac.compare_digest(got, PIN)
```

Первые строки `do_GET` (после `path = …`) и `do_POST` (после `path = …`):

```python
        if not self._key_ok():
            self._json(401, {"ok": False, "error": "bad key"})
            return
```

Статику (`/`, css, js) не закрывать — PWA должен открываться.

### 7.2. Клиент

- Поле «Key» в `#hubFold` рядом с hub URL, хранить в `localStorage("deck.key")`.
- В `gadget-core.js → apiUrl()` (gadget-core.js:160) и `deck-app.js → hubPath()`
  (deck-app.js:112) добавлять `key` к запросам, если сохранён.
- Трогать только эти две функции — все вызовы пойдут через них.

---

## 8. Порядок работы и коммиты

| Шаг | Фича | Коммит |
|---|---|---|
| 1 | F1 CLIPBOARD | `Add clipboard bridge between iPad and PC.` |
| 2 | F2 BOOT + F3 CRT FX | `Ship v94: BIOS boot sequence and CRT FX pack.` |
| 3 | F4 NET & DISK | `Show LAN up/down rates and disk space in titlebar.` |
| 4 | F5 MACROS | `Add whitelisted macros: sleep, flush dns, recycle bin.` |
| 5 | F6 multipage | `Split deck grid into swipeable pages.` |
| 6 | F7 PIN (если согласован) | `Optional PIN guard for /api/* endpoints.` |
| 7 | F8 тема GLASS | `Add GLASS theme: frosted glass, sunset storm (by refs).` |

Бамп `?v=94` — в коммите шага 2 (первом, меняющем static/). Если шаг идёт отдельным
коммитом позже предыдущего бампа — брать следующий свободный номер (v95, v96, …).
После КАЖДОГО шага: `python -m py_compile server.py` + вручную прогнать чеклист ниже.

## 9. Чеклист приёмки (для каждого шага)

- [ ] `python server.py` стартует без ошибок, порт 8787
- [ ] curl `/api/ping` → `{"ok": true, ...}`
- [ ] Изменил громкость на ПК → планшет отразил ≤ 1 c (long-poll жив, `/api/events` не подвис)
- [ ] iPad: reload PWA; если старьё — удалить/добавить иконку заново
- [ ] STANDALONE-режим (хаб выкл): часы/радио/POWER работают, новых ошибок в консоли нет
- [ ] GitHub Pages-режим: `canUseHubApi()` false → новые кнопки дают toast «hub offline», а не молчат
- [ ] В `deck-app.js`/`gadget-core.js` нет ES6 (`grep -n "=>\|const \|let \|fetch(" static/*.js` — только в комментариях, если были)

## 10. Известные грабли

- **iOS clipboard:** `navigator.clipboard` недоступен на `http://` LAN — только
  `execCommand("copy")` из жеста тапа (уже учтено в коде §1.3).
- **PowerShell + юникод:** всегда base64-обёртка (уже в коде §1.1), иначе кракозябры на кириллице.
- **Sleep/wake:** `sleep_pc` усыпит ПК, но разбудить с iPad нельзя (браузер не шлёт UDP,
  сервер спит). Пробуждение — только через роутер с WoL или ESP; не пытаться решить тут.
- **Старый iPad:** в CRT FX никаких `filter: blur()` — только градиенты/opacity.

---

## 11. F8 — Тема GLASS (F): glassmorphism по трём референсам

**Важно, как трактовать «в точности как картинки»:** структура экранов приложения НЕ
меняется (весь функционал обязан сохраниться). В точности повторяется **стиль**
референсов: палитра «штормовой закат», матовое стекло панелей, огромные тонкие цифры,
пилюли-кнопки, волосяные разделители 1px, сплошной белый CTA у активных кнопок,
system-sans типографика вместо monospace. Тема — аддитивная, пятая пилюля рядом с
B/C/D/E, дефолт не меняется.

### 11.0. Что взято с какой картинки

| Референс | Что переносим |
|---|---|
| Погодный дашборд «WeatherWise» (главный) | Фон: тёмные грозовые облака `#17191D→#26221E` + оранжевый закатный glow снизу-справа `#E0A060`; панели-сайдбары `rgba(255,255,255,0.08)` + blur; гигантская цифра «18°» → наши часы/громкость (weight 200, ~92px); заголовок 75% white; пилюли `rgba(20,20,25,0.45)`; акценты графика: cyan `#56C8DC` (активное) + orange `#E89A5A` (горячее); радиусы 20–28px |
| Бронирование «Onda Retreat» | Волосные разделители `1px rgba(255,255,255,.25)`; секционные заголовки 17px medium sentence-case; CTA «Book» — сплошная белая пилюля с тёмным текстом `#1E1B18` → стиль активных кнопок; стеклянная карточка с handle |
| Плавающий док | Stadium-кнопки (radius = высота/2); активная иконка — белая заливка в светлой капсуле → активные состояния; бирюзовая «полярная» подсветка сверху-слева фона `rgba(86,200,220,.13)` |

### 11.1. Дизайн-токены (CSS-переменные темы)

В `static/deck.css` рядом с блоками других тем (строки 25–61, где `.theme-B` … `.theme-E`).
Система переменных у проекта уже есть (`--bg --panel --ink --dim --line --accent --hot
--warn --glow`) — большинство правил перекрасится само. Ключевой трюк: `--bg` держит
**полный стек градиентов** (CSS-переменная может содержать gradient), а `--panel`
делается полупрозрачным белым — этого достаточно, чтобы все существующие панели
превратились в «светлое стекло» без правки их правил.

```css
/* ══ THEME F · GLASS — frosted glass / sunset storm (по референсам) ══ */
body.theme-F {
  --bg:
    radial-gradient(115% 85% at 86% 98%,
      rgba(224, 160, 96, 0.40) 0%, rgba(198, 128, 80, 0.16) 30%, rgba(0, 0, 0, 0) 60%),
    radial-gradient(95% 75% at 4% 2%,
      rgba(86, 200, 220, 0.13) 0%, rgba(0, 0, 0, 0) 55%),
    linear-gradient(158deg,
      #17191d 0%, #1c1e23 36%, #26221e 56%, #342820 78%, #221d18 100%);
  --panel: rgba(255, 255, 255, 0.07);
  --ink: #ffffff;
  --dim: rgba(255, 255, 255, 0.55);
  --line: rgba(255, 255, 255, 0.20);
  --accent: #56c8dc;
  --hot: #e89a5a;
  --warn: #e8755a;
  --glow: rgba(86, 200, 220, 0.30);
  font-family: -apple-system, "SF Pro Text", "Helvetica Neue", "Segoe UI", Arial, sans-serif;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--ink);
  background: #17191d; /* плоская база; градиент рисует #glassBg (ниже) */
}
```

### 11.2. Фон-градиент: fixed-слой (iOS-proof)

`background-attachment: fixed` на iOS Safari сломан. Вместо него — отдельный слой-див.
`static/index.html`, сразу после `<body>` (рядом с `#boot` из §2.1):

```html
  <div id="glassBg" aria-hidden="true"></div>
```

В конец `static/deck.css`:

```css
/* ── GLASS: фиксированный градиентный фон ───────── */
#glassBg { position: fixed; inset: 0; z-index: -1; display: none; }
body.theme-F #glassBg {
  display: block;
  background:
    radial-gradient(115% 85% at 86% 98%,
      rgba(224, 160, 96, 0.40) 0%, rgba(198, 128, 80, 0.16) 30%, rgba(0, 0, 0, 0) 60%),
    radial-gradient(95% 75% at 4% 2%,
      rgba(86, 200, 220, 0.13) 0%, rgba(0, 0, 0, 0) 55%),
    linear-gradient(158deg,
      #17191d 0%, #1c1e23 36%, #26221e 56%, #342820 78%, #221d18 100%);
}
/* Если у #app есть собственный фон — прозрачно в GLASS: */
body.theme-F #app { background: transparent; }
/* Необязательная медленная «дыхательная» анимация glow (референс-док).
   Удалить, если старый iPad будет подтормаживать: */
@-webkit-keyframes glassDrift {
  0%   { background-position: 0% 0%, 0% 0%, 0 0; }
  100% { background-position: -3% -2%, 3% 2%, 0 0; }
}
body.theme-F #glassBg {
  -webkit-animation: glassDrift 26s ease-in-out infinite alternate;
  animation: glassDrift 26s ease-in-out infinite alternate;
}
```

### 11.3. Блок переопределений (в конец `static/deck.css`)

Селекторы — по фактическим классам проекта (`.vol-card`, `.pad`, `.app-mix-btn`,
`.section`, `.media-btn`, `.vol-preset` и т.д. — см. index.html:162-216). После вставки
сделать визуальный проход по ВСЕМ экранам (deck / solo / drawer / idle / toast / tip) и
добавить пропущенные селекторы по тому же образцу.

```css
/* ── GLASS: формы и стекло ──────────────────────── */
/* Крупные панели — стекло с блюром (только 3-4 элемента: перф старого iPad). */
@supports ((-webkit-backdrop-filter: blur(2px)) or (backdrop-filter: blur(2px))) {
  body.theme-F .vol-card,
  body.theme-F #tip,
  body.theme-F #toast,
  body.theme-F #drawer > div { /* уточнить класс панели drawer-а, см. §11.5 */
    -webkit-backdrop-filter: blur(26px) saturate(140%);
    backdrop-filter: blur(26px) saturate(140%);
  }
}

/* Радиусы: карточки 22px (референсы 20–28), кнопки — stadium-пилюли. */
body.theme-F .vol-card,
body.theme-F .app-mix-btn,
body.theme-F .pad,
body.theme-F #tip { border-radius: 22px; }
body.theme-F .vol-preset,
body.theme-F .media-btn,
body.theme-F .drawer-btn,
body.theme-F .theme-pill,
body.theme-F .mode-pill,
body.theme-F .fs-btn,
body.theme-F .solo-toggle { border-radius: 999px; }

/* Кнопки: тёмное полупрозрачное стекло + hairline (пилюли «H 29°» из WeatherWise). */
body.theme-F .vol-preset,
body.theme-F .media-btn,
body.theme-F .drawer-btn,
body.theme-F .solo-toggle,
body.theme-F .pad,
body.theme-F .app-mix-btn {
  background: rgba(22, 24, 28, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #ffffff;
  text-shadow: none;
}

/* Активное состояние = сплошной белый CTA «Book» из референса брони. */
body.theme-F .vol-preset:active,
body.theme-F .media-btn:active,
body.theme-F .drawer-btn:active,
body.theme-F .pad:active,
body.theme-F .app-mix-btn:active {
  background: #ffffff;
  color: #1e1b18;
  border-color: #ffffff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
/* Включённые toggle-состояния — светлая капсула с ярким текстом (актив из дока). */
body.theme-F .theme-pill.on,
body.theme-F .mode-pill.on,
body.theme-F .solo-toggle.on {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.35);
  color: #ffffff;
}

/* Волосные разделители 1px white/25 + секции без textmode-скобок. */
body.theme-F .section {
  text-transform: none;
  letter-spacing: 0.4px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.65);
  border-bottom: 1px solid rgba(255, 255, 255, 0.25);
  padding-bottom: 6px;
}
body.theme-F .section:before { content: none; }

/* Лейблы: sentence case, 11px, white/60 (как в референсах). */
body.theme-F .vol-title,
body.theme-F .app-mix-btn .k,
body.theme-F .lv-k,
body.theme-F #idle .card .k {
  text-transform: none;
  letter-spacing: 0.3px;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
}

/* Гигантские тонкие цифры: «18°» из WeatherWise → часы и громкость. */
body.theme-F .solo-clock {
  font-weight: 200;
  font-size: 92px;
  letter-spacing: -0.03em;
  text-shadow: none;
}
body.theme-F .solo-title { font-weight: 500; text-transform: none; }
body.theme-F .vol-value { font-weight: 200; font-size: 34px; }
body.theme-F .solo-markets .mv { font-weight: 300; }

/* Toast — стеклянная пилюля с тенью (референс-карточка). */
body.theme-F #toast {
  border-radius: 999px;
  background: rgba(22, 24, 28, 0.70);
  border: 1px solid rgba(255, 255, 255, 0.20);
  color: #ffffff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.40);
}

/* Бегущая строка и header — приглушённые, на стекле. */
body.theme-F #ticker { color: rgba(255, 255, 255, 0.55); }
body.theme-F .hub-stats,
body.theme-F .hub-net { color: rgba(255, 255, 255, 0.45); }

/* Idle-скринсейвер: cinema-гифка в стеклянной карточке. */
body.theme-F #idleFrameBox {
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.20);
  overflow: hidden;
}
```

### 11.4. Интеграция темы (3 правки + README)

1. `static/deck-app.js`, `readTheme()` (~строка 160-166) — добавить `"F"` в allowlist:

```js
          if (t === "B" || t === "C" || t === "D" || t === "E" || t === "F") return t;
```

2. `static/deck-app.js` — словарь имён тем (ищать `names.C`, используется в
`syncBodyClass()` для `#mediaBrand`): добавить пару

```js
      F: "GLASS · FROST",
```

3. `static/index.html`, блок `#drawerThemes` (строки 248-253) — новая пилюля последней:

```html
        <button type="button" class="theme-pill" data-theme="F">GLASS</button>
```

4. `README.md`, таблица «Палитры» — строку в конец:

```
| **GLASS** (F) | frosted glass · штормовой закат (по референсам) |
```

5. Бамп версии `?v=` — следующий свободный номер (см. §8).

### 11.5. Совместимость и производительность

- **`backdrop-filter` на iOS требует префикса `-webkit-`** — во всех правилах он уже
  стоит. Если iPad совсем старый и blur не поддержан — `@supports`-фолбэк оставит
  плотный полупрозрачный фон без блюра (читаемость сохранена).
- **Блюр только на крупных панелях** (vol-card, drawer, tip, toast). Кнопки — без
  блюра, обычная rgba-заливка: иначе старый iPad будет ронять FPS при каждом тапе.
- **CRT FX (§3) + GLASS**: технически совместимы, но скан-линии поверх стекла спорны
  по вкусу. Опционально одна строка в `syncFx()` — глушить overlay только в GLASS:
  `if (el) el.style.display = (theme === "F") ? "none" : "";`
- Тема **не трогает** логику: те же пилюли B/C/D/E работают, `applyTheme`/`saveTheme`
  как раньше, STANDALONE/DECK, long-poll, радио — без изменений.
- Класс `#drawer > div` в §11.3 проверить по разметке: если панель drawer-а имеет
  свой класс (например `.drawer-panel`) — использовать его.

### 11.6. Чеклист соответствия референсам (приёмка темы)

- [ ] Фон: тёмный шторм-градиент + оранжевый glow снизу-справа + бирюзовая подсветка слева-сверху
- [ ] Панели: светлое стекло ~7% white, hairline white/20, радиус ~22px
- [ ] Кнопки: тёмные полупрозрачные пилюли `rgba(22,24,28,.45)`; активная — сплошной белый с текстом `#1E1B18`
- [ ] Часы/громкость: system sans, weight 200, крупные (~92px)
- [ ] Лейблы и секции: sentence case, 11–12px, white/60, разделители 1px white/25
- [ ] Акценты: cyan `#56C8DC` — активные элементы, orange `#E89A5A` — горячие значения
- [ ] Toast/drawer/tip: стеклянные, тени мягкие, углы — пилюли
- [ ] Переключение B↔C↔D↔E↔F из MENU работает, после перезагрузки тема F сохраняется
- [ ] Весь функционал прежний: vol-presets, mixer, CLUTCH, радио, pomo, POWER, Cinema
