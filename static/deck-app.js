/* Qwiqly Hardware Panel Deck app shell — ES5 (iPad 2 / iOS 9 Safari) */
(function () {
  var APP_VER = 102;
  var GC = window.GadgetCore;

  var lastVolume = 50;
  var isMuted = false;
  var failCount = 0;
  var hubQuietUntil = 0;
  var hubDownNoted = false;
  var HUB_HOLD_KEY = "kissaten_hub_hold";

  function readHubHold() {
    try { return localStorage.getItem(HUB_HOLD_KEY) === "1"; } catch (e) { return false; }
  }
  function writeHubHold(on) {
    try {
      if (on) localStorage.setItem(HUB_HOLD_KEY, "1");
      else localStorage.removeItem(HUB_HOLD_KEY);
    } catch (e) {}
  }

  var hubHeld = readHubHold();
  if (hubHeld) hubQuietUntil = 8640000000000000;
  var mode = hubHeld ? "solo" : ((GC && (GC.getHubBase() || GC.isLikelyHubOrigin())) ? "deck" : "solo"); // deck | solo
  var modeLock = null; // null=auto, "deck"|"solo"=manual from MENU
  var artRev = -1;
  var livingGen = 0;
  var alarmFiredKey = "";
  var alarmUnlocked = false;
  var alarmCtx = null;
  var alarmOsc = null;
  var alarmPulse = null;
  var radioAudio = null;
  var alarmAudio = null;
  var soloFace = (GC && GC.getSoloFace) ? GC.getSoloFace() : "radio";
  var soloFaceBusy = false;
  var soloFaceAnimTimer = null;
  var musicTvPlaying = false;
  var musicTvPlayGen = 0;
  var tvSource = "music"; /* music | cs */
  var csNowLabel = "";
  var csNowLogin = "";
  var csNowId = "";
  var csLiveList = [];
  var csStatusGen = 0;
  var powerGen = 0;
  var POWER_WARN_KEY = "kissaten_power_warn_key";
  var powerWarnKey = "";
  try { powerWarnKey = localStorage.getItem(POWER_WARN_KEY) || ""; } catch (ePW) { powerWarnKey = ""; }
  var powerWarnUntil = 0;
  var powerWarnActive = false;
  var powerWarnTimer = null;
  var POWER_WARN_MS = 18000;
  var lastPower = null;
  var powerFace = 0;

  var toastEl = document.getElementById("toast");
  var metaEl = document.getElementById("meta");
  var hubStatsEl = document.getElementById("hubStats");
  var tipEl = document.getElementById("tip");
  var drawerEl = document.getElementById("drawer");
  var nowArt = document.getElementById("nowArt");
  var nowApp = document.getElementById("nowApp");
  var modeBadge = document.getElementById("modeBadge");

  function localPath(path) {
    if (!path) path = "/";
    if (path.charAt(0) === "/") path = path.substring(1);
    return path;
  }

  function hubPath(path) {
    /* Only /api/* goes to LAN hub. Static files stay same-origin (Pages/LAN). */
    if (path.indexOf("/api/") === 0 || path.indexOf("api/") === 0) {
      return GC ? GC.apiUrl(path.charAt(0) === "/" ? path : "/" + path) : path;
    }
    return localPath(path);
  }

  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg || "";
    if (!msg) {
      toastEl.className = "";
      return;
    }
    toastEl.className = "on";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.className = "";
      toastEl.textContent = "";
    }, 2200);
  }

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

  function setHubStats(text, flags) {
    if (!hubStatsEl) return;
    var t = String(text || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    hubStatsEl.textContent = t || "—";
    var cls = "hub-stats";
    if (flags && flags.hot) cls += " hot";
    else if (flags && flags.warn) cls += " warn";
    hubStatsEl.className = cls;
  }

  function setMeta(html) {
    if (metaEl) metaEl.innerHTML = html || "";
    /* Offline / mode lines also land in titlebar until HW stats arrive */
    if (hubStatsEl && html) {
      var t = String(html || "")
        .replace(/<br\s*\/?>/gi, " · ")
        .replace(/<\/?b>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
      setHubStats(t, null);
    }
  }

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function syncBodyClass() {
    var cls = "";
    if (isStandalone()) cls += "standalone ";
    cls += mode === "solo" ? "mode-solo" : "mode-deck";
    if (mode === "solo" && soloFace === "tv") cls += " solo-face-tv";
    document.body.className = cls;

    var fsBtn = document.getElementById("fsBtn");
    if (fsBtn) {
      fsBtn.textContent = isStandalone() ? "Full ✓" : "Fullscreen tip";
    }
    if (modeBadge) {
      modeBadge.textContent = mode === "solo" ? "STANDALONE" : "DECK";
      if (modeLock) modeBadge.textContent += " · LOCK";
    }
    var modePills = document.querySelectorAll(".mode-pill");
    for (var mi = 0; mi < modePills.length; mi++) {
      var mp = modePills[mi];
      mp.className = mp.getAttribute("data-mode") === mode ? "mode-pill on" : "mode-pill";
    }
  }

  var deckPage = 0;
  try { deckPage = parseInt(localStorage.getItem("deck.page") || "0", 10) || 0; } catch (ePg) {}
  var DECK_DOCK = [
    { label: "AUDIO" },
    { label: "LAUNCH" },
    { label: "OPS" }
  ];

  function syncDeckPage() {
    var pages = document.querySelectorAll(".deck-page");
    var dots = document.getElementById("deckDots");
    var max = pages.length;
    if (!max) return;
    if (deckPage < 0) deckPage = max - 1;
    if (deckPage >= max) deckPage = 0;
    for (var i = 0; i < pages.length; i++) {
      pages[i].className = "deck-page" + (i === deckPage ? " on" : "");
    }
    if (dots) {
      var html = '<div class="deck-dock-inner"><span class="deck-dock-pill" aria-hidden="true"></span>';
      for (var d = 0; d < max; d++) {
        var meta = DECK_DOCK[d] || { label: "PAGE " + (d + 1) };
        html += '<button type="button" class="deck-dot' + (d === deckPage ? " on" : "") +
          '" data-pg="' + d + '" aria-label="' + meta.label + '">' + meta.label + "</button>";
      }
      html += "</div>";
      dots.innerHTML = html;
      dots.setAttribute("data-active", String(deckPage));
      dots.setAttribute("data-count", String(max));
    }
    try { localStorage.setItem("deck.page", String(deckPage)); } catch (e) {}
  }

  function setMode(next, opts) {
    opts = opts || {};
    if (opts.auto && modeLock === "solo" && next === "deck") {
      return;
    }
    if (next === mode) {
      syncBodyClass();
      return;
    }
    mode = next;
    syncBodyClass();
    if (mode === "solo") {
      var hn = document.getElementById("hubNet");
      if (hn) hn.textContent = "";
      syncSoloFaceUI();
      syncActiveNowPlaying();
      if (hubHeld || hubIsQuiet()) {
        setMeta("<b>standalone</b><br>к ПК не подключаюсь");
      } else {
        setMeta("<b>standalone</b><br>ожидание хаба");
      }
    } else {
      try { if (radioPlaying) stopRadio({ quiet: true }); } catch (eStop) {}
      try { if (musicTvPlaying) stopMusicTv({ quiet: true }); } catch (eTv) {}
      toast("deck online");
      syncDeckPage();
    }
  }

  var drawerArm = 0;
  function openDrawer() {
    drawerArm = (new Date()).getTime() + 500;
    if (drawerEl) drawerEl.className = "on";
    syncBodyClass();
    var hubInput = document.getElementById("hubInput");
    if (hubInput) hubInput.value = GC ? (GC.getHubBase() || location.origin) : location.origin;
    var bm = document.getElementById("buildMeta");
    if (bm) bm.textContent = "build v" + APP_VER + " · hardware panel";
  }

  function closeDrawer() {
    if (drawerEl) drawerEl.className = "";
  }

  function drawerTapOk() {
    return (new Date()).getTime() >= drawerArm;
  }

  function hideChrome() {
    window.scrollTo(0, 1);
    setTimeout(function () { window.scrollTo(0, 1); }, 50);
  }

  function appBaseUrl() {
    var path = location.pathname || "/";
    if (path.charAt(path.length - 1) !== "/") {
      path = path.replace(/\/[^\/]*$/, "/");
      if (!path) path = "/";
    }
    return location.protocol + "//" + location.host + path;
  }

  function goFullscreenTip() {
    hideChrome();
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen;
    if (req) {
      try { req.call(el); toast("fullscreen"); return; } catch (e) {}
    }
    if (isStandalone()) { toast("уже полный экран"); return; }
    var tipUrl = document.getElementById("tipUrl");
    if (tipUrl) tipUrl.textContent = appBaseUrl() + "?v=" + APP_VER;
    if (tipEl) tipEl.className = "on";
  }

  var fsBtnEl = document.getElementById("fsBtn");
  if (fsBtnEl) fsBtnEl.onclick = goFullscreenTip;

  var infoChipEl = document.getElementById("infoChip");
  if (infoChipEl) {
    infoChipEl.ontouchend = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      openDrawer();
    };
    infoChipEl.onclick = function () { openDrawer(); };
  }

  var drawerBackEl = document.getElementById("drawerBack");
  if (drawerBackEl) drawerBackEl.onclick = closeDrawer;

  var tipOkEl = document.getElementById("tipOk");
  if (tipOkEl) tipOkEl.onclick = function () { if (tipEl) tipEl.className = ""; };

  var hubSaveEl = document.getElementById("hubSave");
  if (hubSaveEl) {
    hubSaveEl.onclick = function () {
      var inp = document.getElementById("hubInput");
      var v = inp ? inp.value.replace(/^\s+|\s+$/g, "") : "";
      if (GC) GC.setHubBase(v);
      toast("hub saved");
      failCount = 0;
      if (GC && GC.isMixedContentHub()) {
        setMeta("<b>hub saved</b><br>для DECK нажми DECK → откроется LAN");
        return;
      }
      heartbeat();
      refreshStatus();
    };
  }

  function goToHubDeck() {
    var base = GC ? GC.getHubBase() : "";
    if (!base) {
      toast("укажи hub URL");
      setMeta("<b>нет hub URL</b><br>SYS → Save Hub URL");
      return false;
    }
    var url = base + "/?v=" + APP_VER;
    toast("открываю DECK…");
    setTimeout(function () { location.href = url; }, 120);
    return true;
  }

  function pickMode(next) {
    modeLock = next;
    failCount = 0;
    hubDownNoted = false;
    if (next === "deck") {
      /* HTTPS Pages cannot XHR to HTTP LAN hub (mixed content) — jump to hub UI */
      if (GC && GC.isMixedContentHub()) {
        goToHubDeck();
        return;
      }
      writeHubHold(false);
      hubQuietUntil = 0;
      hubHeld = false;
      setMode("deck");
      toast("DECK");
      heartbeat();
      refreshStatus();
    } else {
      writeHubHold(true);
      hubQuietUntil = 8640000000000000;
      hubHeld = true;
      stopEventLoop();
      setMode("solo");
      toast("STANDALONE");
      setMeta("<b>standalone</b><br>к ПК не подключаюсь");
    }
  }

  var modeDeckBtn = document.getElementById("modeDeckBtn");
  if (modeDeckBtn) {
    modeDeckBtn.onclick = function (e) {
      if (!drawerTapOk()) { if (e && e.preventDefault) e.preventDefault(); return; }
      pickMode("deck");
    };
  }
  var modeSoloBtn = document.getElementById("modeSoloBtn");
  if (modeSoloBtn) {
    modeSoloBtn.onclick = function (e) {
      if (!drawerTapOk()) { if (e && e.preventDefault) e.preventDefault(); return; }
      pickMode("solo");
    };
  }

  /* Swipe from left edge on header → drawer */
  var touchX0 = 0, touchY0 = 0, tracking = false;
  var headerEl = document.getElementById("header");
  if (headerEl) {
    headerEl.addEventListener("touchstart", function (e) {
      if (!e.touches || !e.touches.length) return;
      touchX0 = e.touches[0].pageX;
      touchY0 = e.touches[0].pageY;
      tracking = true;
    }, false);
    headerEl.addEventListener("touchend", function (e) {
      if (!tracking) return;
      tracking = false;
      if (!e.changedTouches || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].pageX - touchX0;
      var dy = e.changedTouches[0].pageY - touchY0;
      if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx > 0) openDrawer();
      if (dx < 0) closeDrawer();
    }, false);
  }

  /* Static level meter — no interval (old iPad cannot afford 16 style writes @140ms) */
  var nowPlaying = false;
  var nowBars = document.getElementById("nowBars");
  if (nowBars) {
    nowBars.innerHTML = "";
    for (var bi = 0; bi < 8; bi++) {
      var sp = document.createElement("span");
      sp.style.height = (3 + (bi % 4) * 2) + "px";
      nowBars.appendChild(sp);
    }
  }

  function updateNowPlaying(np) {
    if (!np) np = {};
    var title = np.title || "";
    var artist = np.artist || "";
    nowPlaying = !!np.playing && !!title;
    var nt = document.getElementById("nowTitle");
    var na = document.getElementById("nowArtist");
    if (nt) nt.textContent = title || "-- NO SIGNAL --";
    if (na) na.textContent = artist || "";
    var label = np.app_label || np.app || "";
    if (nowApp) {
      if (label) {
        nowApp.textContent = label;
        nowApp.className = "media-app on";
      } else {
        nowApp.textContent = "";
        nowApp.className = "media-app";
      }
    }
    if (nowArt) {
      if (np.has_art && np.art_rev && !hubIsQuiet()) {
        if (artRev !== np.art_rev) {
          artRev = np.art_rev;
          nowArt.src = hubPath("/api/cover?r=" + artRev);
        }
        nowArt.className = "now-art on";
      } else {
        artRev = -1;
        nowArt.removeAttribute("src");
        nowArt.className = "now-art";
      }
    }
    if (musicTvPlaying || (soloFace === "tv" && mode === "solo")) {
      try { syncMusicTvNowPlaying(); } catch (eT) {}
    } else if (radioPlaying) {
      try { syncRadioNowPlaying(); } catch (eR) {}
    }
  }

  function syncAudioUI(audio) {
    if (!audio || !audio.scenes) return;
    var hp = audio.scenes.headphones || {};
    var bt = audio.scenes.bluetooth || audio.scenes.speakers || {};
    var hpBtn = document.getElementById("sceneHp");
    var spBtn = document.getElementById("sceneSp");
    var hpSub = document.getElementById("sceneHpSub");
    var spSub = document.getElementById("sceneSpSub");
    if (hpSub) hpSub.textContent = hp.available ? (hp.name || "Headphones") : "—";
    if (spSub) spSub.textContent = bt.available ? (bt.name || "Bluetooth") : "offline";
    var kind = audio.default_kind || "";
    if (kind === "speakers") kind = "bluetooth";
    if (hpBtn) {
      hpBtn.className = "scene-btn" + (hp.available ? "" : " off") +
        (kind === "headphones" ? " on" : "");
    }
    if (spBtn) {
      spBtn.className = "scene-btn" + (bt.available ? "" : " off") +
        (kind === "bluetooth" ? " on" : "");
    }
  }

  var tickerSig = "";

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* CSS animation ticker — no JS setInterval (was 33 style writes/sec) */
  function renderTicker(ticker) {
    if (!ticker || !ticker.items || !ticker.items.length) return;
    var parts = [];
    var maxItems = 8;
    for (var i = 0; i < ticker.items.length && parts.length < maxItems; i++) {
      var it = ticker.items[i];
      var t = escHtml(it.text || "");
      if (!t) continue;
      if (it.kind === "weather") {
        parts.push('<span class="wx">' + t + "</span>");
      } else {
        parts.push("<span>" + t + "</span>");
      }
    }
    if (!parts.length) return;
    var sig = parts.join("|");
    if (sig === tickerSig) return;
    tickerSig = sig;
    var html = parts.join('<span class="sep"> · </span>');
    var doubled = html + '<span class="sep"> · </span>' + html;
    var track = document.getElementById("tickerTrack");
    if (!track) return;
    track.className = "ticker-track";
    track.innerHTML = doubled;
    track.style.webkitTransform = "";
    track.style.transform = "";
    /* restart CSS animation */
    try { void track.offsetWidth; } catch (eTw) {}
    track.className = "ticker-track run";
  }

  function renderLiving(living) {
    if (!living) return;
    var w = living.weather;
    var a = living.alert;
    var wEl = document.getElementById("lvWeatherVal");
    var aEl = document.getElementById("lvAlert");
    var aVal = document.getElementById("lvAlertVal");
    var aSub = document.getElementById("lvAlertSub");
    if (wEl) {
      if (w && w.temp_c != null) {
        wEl.textContent = w.temp_c + "° · " + (w.label || "");
      } else if (w && w.text) {
        wEl.textContent = w.text;
      } else {
        wEl.textContent = "нет данных";
      }
    }
    if (aEl && aVal) {
      if (a && a.ok) {
        aVal.textContent = a.label || "…";
        if (aSub) aSub.textContent = a.place || "Kyiv";
        aEl.className = a.alert ? "lv-alert on" : "lv-alert";
      } else {
        aVal.textContent = (a && a.label) ? a.label : "НЕТ ДАННЫХ";
        if (aSub) aSub.textContent = (a && a.place) ? a.place : "Kyiv";
        aEl.className = "lv-alert";
      }
    }
  }

  function compactSlotLabel(label) {
    var s = String(label || "");
    s = s.replace(/[–—]/g, "-");
    s = s.replace(/\b0(\d:)/g, "$1");
    return s;
  }

  function daySourceMark(day) {
    if (!day) return "";
    if (day.source === "DTEK") return "DTEK";
    if (day.probable) return "ймовірний";
    if (day.cached) return "кеш";
    return "Yasno";
  }

  function fillPowerSlots(el, day) {
    if (!el) return;
    el.innerHTML = "";
    var labels = (day && day.labels) ? day.labels : [];
    var i, row, text;
    if (labels.length) {
      for (i = 0; i < labels.length && i < 3; i++) {
        row = document.createElement("span");
        row.className = "pw-slot";
        row.textContent = compactSlotLabel(labels[i]);
        el.appendChild(row);
      }
      return;
    }
    row = document.createElement("span");
    row.className = "pw-slot empty";
    if (day && day.text === "без відключень") text = "без відключень";
    else if (day && day.emergency) text = "немає слотів";
    else text = (day && day.text) ? day.text : "ще немає";
    row.textContent = text;
    el.appendChild(row);
  }

  function parsePowerLabelRange(label) {
    var s = String(label || "").replace(/[–—]/g, "-");
    var m = s.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var a = (parseInt(m[1], 10) * 60) + parseInt(m[2], 10);
    var b = (parseInt(m[3], 10) * 60) + parseInt(m[4], 10);
    if (b <= a) b += 24 * 60;
    return [a, b];
  }

  function renderPowerAsciiBar(el, day, isToday) {
    if (!el) return;
    el.innerHTML = "";
    var ranges = [];
    var labels = (day && day.labels) ? day.labels : [];
    var i, r, h, start, end, offMins, overlap, ch, cls, span, sep;
    for (i = 0; i < labels.length; i++) {
      r = parsePowerLabelRange(labels[i]);
      if (r) ranges.push(r);
    }
    var nowH = (new Date()).getHours();
    for (h = 0; h < 24; h++) {
      if (h > 0 && (h % 6) === 0) {
        sep = document.createElement("span");
        sep.className = "h-sep";
        sep.textContent = "·";
        el.appendChild(sep);
      }
      start = h * 60;
      end = start + 60;
      offMins = 0;
      for (i = 0; i < ranges.length; i++) {
        overlap = Math.min(end, ranges[i][1]) - Math.max(start, ranges[i][0]);
        if (overlap > 0) offMins += overlap;
      }
      if (offMins >= 45) { ch = "░"; cls = "h-off"; }
      else if (offMins >= 15) { ch = "▒"; cls = "h-half"; }
      else { ch = "█"; cls = "h-on"; }
      span = document.createElement("span");
      span.className = cls;
      if (isToday && h === nowH) span.className = cls + " h-now";
      span.textContent = ch;
      el.appendChild(span);
    }
  }

  function powerStatusSub(p) {
    if (!p) return "Kyiv · POWER";
    var today = p.todaySched;
    if (today && today.labels && today.labels.length) {
      return "далі " + compactSlotLabel(today.labels[0]) + (p.group ? (" · " + p.group) : "");
    }
    return p.sub || ("група " + (p.group || "45.1"));
  }

  function setPowerCardClass(p) {
    var el = document.getElementById("lvPower");
    if (!el) return;
    var level = (p && p.level) ? p.level : "unknown";
    var face = powerFace | 0;
    if (face < 0 || face > 2) face = 0;
    var cls = "lv-power face-" + face;
    if (level === "on" || level === "soon" || level === "off" || level === "emergency") {
      cls += " " + level;
    }
    if (powerWarnActive) cls += " blink";
    el.className = cls;
  }

  function dismissPowerWarn(silent) {
    powerWarnActive = false;
    powerWarnUntil = 0;
    if (powerWarnTimer) {
      clearTimeout(powerWarnTimer);
      powerWarnTimer = null;
    }
    stopAlarmTone();
    setPowerCardClass(lastPower);
    if (!silent) toast("POWER · ок");
  }

  function renderPower(p) {
    lastPower = p || null;
    var el = document.getElementById("lvPower");
    var val = document.getElementById("lvPowerVal");
    var sub = document.getElementById("lvPowerSub");
    var d1k = document.getElementById("lvPowerDay1K");
    var d1m = document.getElementById("lvPowerDay1Meta");
    var d2k = document.getElementById("lvPowerDay2K");
    var d2m = document.getElementById("lvPowerDay2Meta");
    if (!el || !val) return;
    if (powerWarnActive && (new Date()).getTime() >= powerWarnUntil) {
      dismissPowerWarn(true);
    }
    setPowerCardClass(p);
    val.textContent = (p && p.label) ? p.label : "НЕМАЄ ДАНИХ";
    if (sub) sub.textContent = powerStatusSub(p);
    var today = p && p.todaySched;
    var tom = p && p.tomorrowSched;
    if (d1k) d1k.textContent = "СЬОГОДНІ";
    fillPowerSlots(document.getElementById("lvPowerDay1Slots"), today);
    renderPowerAsciiBar(document.getElementById("lvPowerDay1Bar"), today, true);
    if (d1m) {
      d1m.textContent = daySourceMark(today) +
        (p && p.group ? (" · " + p.group) : "") +
        " · tap завтра";
    }
    if (d2k) d2k.textContent = "ЗАВТРА";
    fillPowerSlots(document.getElementById("lvPowerDay2Slots"), tom);
    renderPowerAsciiBar(document.getElementById("lvPowerDay2Bar"), tom, false);
    if (d2m) {
      d2m.textContent = daySourceMark(tom) +
        (p && p.group ? (" · " + p.group) : "") +
        " · tap статус";
    }
    maybePowerWarn(p);
  }

  function maybePowerWarn(p) {
    if (!p) return;
    var now = (new Date()).getTime();
    if (powerWarnActive) {
      if (now >= powerWarnUntil) dismissPowerWarn(true);
      return;
    }
    var d = new Date();
    var key = "";
    if (p.soon && p.nextOff) {
      key = "soon-" + d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate() + "-" + p.nextOff;
    } else if (p.emergency) {
      key = "emg-" + d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
    } else {
      return;
    }
    if (powerWarnKey === key) return;
    powerWarnKey = key;
    try { localStorage.setItem(POWER_WARN_KEY, key); } catch (eW) {}
    powerWarnActive = true;
    powerWarnUntil = now + POWER_WARN_MS;
    unlockAlarmAudio();
    playAlarmTone();
    setPowerCardClass(p);
    toast(p.emergency ? "POWER · екстрені · тап = стоп" : ("POWER · скоро " + (p.nextOff || "") + " · тап = стоп"));
    if (powerWarnTimer) clearTimeout(powerWarnTimer);
    powerWarnTimer = setTimeout(function () {
      dismissPowerWarn(true);
    }, POWER_WARN_MS + 200);
  }

  function refreshPowerClient() {
    if (!GC || !GC.fetchPowerBundle) return;
    var gen = ++powerGen;
    var cached = GC.readPowerCache ? GC.readPowerCache() : null;
    if (cached) renderPower(cached);
    else {
      var v0 = document.getElementById("lvPowerVal");
      if (v0 && (v0.textContent === "…" || !v0.textContent)) v0.textContent = "…";
    }
    GC.fetchPowerBundle(function (bundle) {
      if (gen !== powerGen) return;
      renderPower(bundle);
    });
    setTimeout(function () {
      if (gen !== powerGen) return;
      var v = document.getElementById("lvPowerVal");
      if (v && (v.textContent === "…" || v.textContent === "загрузка…")) {
        renderPower(cached || { ok: false, label: "НЕМАЄ ДАНИХ", sub: "Kyiv · POWER", level: "unknown" });
      }
    }, 13000);
  }

  function hubIsQuiet() {
    return (new Date()).getTime() < hubQuietUntil;
  }

  var statusRev = 0;
  var eventLoopArmed = false;
  var eventLoopTimer = null;
  var eventXhr = null;

  function markHubDown() {
    failCount++;
    stopEventLoop();
    setMode("solo", { auto: true });
    writeHubHold(true);
    hubHeld = true;
    hubQuietUntil = 8640000000000000;
    if (!hubDownNoted) {
      hubDownNoted = true;
      setMeta("<b>ПК выключен</b><br>standalone · к хабу больше не стучусь");
    }
  }

  function markHubUp() {
    var wasQuiet = hubIsQuiet() || failCount > 0 || mode === "solo";
    failCount = 0;
    writeHubHold(false);
    hubHeld = false;
    hubQuietUntil = 0;
    hubDownNoted = false;
    setMode("deck", { auto: true });
    startEventLoop();
    return wasQuiet;
  }

  function applyStatusPayload(s) {
    if (!s) return;
    if (typeof s.rev === "number" && s.rev > 0) statusRev = s.rev;
    var disk = s.disk_free_gb != null ? s.disk_free_gb + " GB free" : "?";
    var ip = (s.ips && s.ips[0]) ? s.ips[0] : "—";
    var shortHost = (s.hostname || "").replace(/^DESKTOP-/, "");
    setMeta(shortHost + " · " + disk + " · " + ip);
    if (s.hw && s.hw.line) {
      setHubStats(s.hw.line, { hot: !!s.hw.hot, warn: !!s.hw.warn });
    } else {
      setHubStats(shortHost + " · " + disk, null);
    }
    syncNetLine(s);
    if (typeof s.volume === "number") syncVolumeUI(s.volume, s.muted);
    if (typeof s.muted === "boolean") isMuted = s.muted;
    if (s.now_playing) updateNowPlaying(s.now_playing);
    if (s.audio) syncAudioUI(s.audio);
  }

  function stopEventLoop() {
    eventLoopArmed = false;
    if (eventLoopTimer) {
      clearTimeout(eventLoopTimer);
      eventLoopTimer = null;
    }
    if (eventXhr) {
      try { eventXhr.abort(); } catch (eAb) {}
      eventXhr = null;
    }
  }

  function scheduleEventLoop(ms) {
    if (eventLoopTimer) clearTimeout(eventLoopTimer);
    eventLoopTimer = setTimeout(function () {
      eventLoopTimer = null;
      pollEvents();
    }, ms || 80);
  }

  function startEventLoop() {
    if (eventLoopArmed) return;
    if (mode !== "deck" || hubIsQuiet() || modeLock === "solo") return;
    eventLoopArmed = true;
    scheduleEventLoop(40);
  }

  function pollEvents() {
    if (!eventLoopArmed) return;
    if (mode !== "deck" || hubIsQuiet() || modeLock === "solo") {
      stopEventLoop();
      return;
    }
    if (GC && GC.isMixedContentHub()) return;
    if (GC && GC.canUseHubApi && !GC.canUseHubApi()) return;
    var xhr = new XMLHttpRequest();
    eventXhr = xhr;
    xhr.open("GET", hubPath("/api/events?rev=" + encodeURIComponent(String(statusRev)) + "&wait=15"), true);
    xhr.timeout = 20000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (eventXhr === xhr) eventXhr = null;
      if (!eventLoopArmed) return;
      if (xhr.status !== 200) {
        markHubDown();
        return;
      }
      markHubUp();
      try {
        applyStatusPayload(JSON.parse(xhr.responseText));
      } catch (eParse) {
        setMeta("ошибка статуса");
        setHubStats("ошибка статуса", null);
      }
      scheduleEventLoop(80);
    };
    xhr.onerror = function () {
      if (eventXhr === xhr) eventXhr = null;
      if (!eventLoopArmed) return;
      markHubDown();
    };
    xhr.ontimeout = function () {
      if (eventXhr === xhr) eventXhr = null;
      if (!eventLoopArmed) return;
      scheduleEventLoop(300);
    };
    try {
      xhr.send(null);
    } catch (eSend) {
      markHubDown();
    }
  }

  function refreshStatus() {
    if (mode === "solo" && (hubHeld || modeLock === "solo")) return;
    if (GC && GC.isMixedContentHub()) {
      setMeta("<b>Pages · Solo</b><br>DECK = открыть LAN hub");
      return;
    }
    if (GC && GC.canUseHubApi && !GC.canUseHubApi()) {
      setMeta("<b>standalone</b><br>Pages · без LAN hub");
      return;
    }
    if (modeLock === "solo") return;
    if (hubIsQuiet()) return;
    if (mode !== "deck" && failCount >= 2) return;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", hubPath("/api/status"), true);
    xhr.timeout = 6000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status !== 200) {
        markHubDown();
        return;
      }
      markHubUp();
      try {
        applyStatusPayload(JSON.parse(xhr.responseText));
      } catch (e) {
        setMeta("ошибка статуса");
        setHubStats("ошибка статуса", null);
      }
    };
    xhr.onerror = function () { markHubDown(); };
    xhr.ontimeout = function () { markHubDown(); };
    try { xhr.send(null); } catch (e) { markHubDown(); }
  }

  function heartbeat() {
    if (mode === "solo" && (hubHeld || modeLock === "solo")) return;
    if (GC && GC.isMixedContentHub()) {
      if (mode !== "solo" && modeLock !== "deck") setMode("solo", { auto: true });
      return;
    }
    if (GC && GC.canUseHubApi && !GC.canUseHubApi()) {
      if (mode !== "solo" && modeLock !== "deck") setMode("solo", { auto: true });
      return;
    }
    if (modeLock === "solo") return;
    if (hubIsQuiet()) return;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", hubPath("/api/ping"), true);
    xhr.timeout = 2500;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        var woke = markHubUp();
        if (woke) refreshStatus();
      } else {
        markHubDown();
      }
    };
    xhr.onerror = function () { markHubDown(); };
    xhr.ontimeout = function () { markHubDown(); };
    try { xhr.send(null); } catch (e) { markHubDown(); }
  }

  function refreshLivingClient() {
    if (!GC) {
      var w0 = document.getElementById("lvWeatherVal");
      if (w0) w0.textContent = "нет core";
      return;
    }
    var gen = ++livingGen;
    var cached = GC.readLivingCache ? GC.readLivingCache() : null;
    if (cached) {
      renderLiving(cached);
    } else {
      var wEl = document.getElementById("lvWeatherVal");
      var aVal0 = document.getElementById("lvAlertVal");
      if (wEl && (wEl.textContent === "Kyiv · …" || wEl.textContent === "…")) {
        wEl.textContent = "загрузка…";
      }
      if (aVal0 && (aVal0.textContent === "…" || !aVal0.textContent)) {
        aVal0.textContent = "…";
      }
    }
    GC.fetchLivingBundle(function (living) {
      if (gen !== livingGen) return;
      renderLiving(living);
    });
    setTimeout(function () {
      if (gen !== livingGen) return;
      var wEl2 = document.getElementById("lvWeatherVal");
      if (wEl2 && wEl2.textContent === "загрузка…") {
        wEl2.textContent = "нет данных";
      }
      var aVal2 = document.getElementById("lvAlertVal");
      var aEl2 = document.getElementById("lvAlert");
      if (aVal2 && (aVal2.textContent === "…" || aVal2.textContent === "загрузка…")) {
        aVal2.textContent = "НЕТ ДАННЫХ";
        if (aEl2) aEl2.className = "lv-alert";
      }
    }, 12000);
    GC.fetchNews(function (ticker) {
      if (gen !== livingGen) return;
      renderTicker(ticker);
    });
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function tickClock() {
    var d = new Date();
    var days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
    var clockEl = document.getElementById("soloClock");
    var dateEl = document.getElementById("soloDate");
    if (clockEl) clockEl.textContent = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    if (dateEl) dateEl.textContent = days[d.getDay()] + " · " + pad2(d.getDate()) + "." + pad2(d.getMonth() + 1);
    checkAlarm(d);
  }

  function alarmDayKey(d, hh, mm) {
    return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate() + "-" + hh + "-" + mm;
  }

  function syncAlarmUI() {
    if (!GC) return;
    var a = GC.getAlarm();
    var inp = document.getElementById("alarmTime");
    var btn = document.getElementById("alarmToggle");
    var st = document.getElementById("alarmStatus");
    if (inp) inp.value = pad2(a.hh || 0) + ":" + pad2(a.mm || 0);
    if (btn) {
      btn.textContent = a.enabled ? "On" : "Off";
      btn.className = a.enabled ? "solo-toggle on" : "solo-toggle";
    }
    if (st) {
      st.textContent = a.enabled
        ? ("звонок в " + pad2(a.hh || 0) + ":" + pad2(a.mm || 0) + " · экран открыт")
        : "будильник выкл";
    }
  }

  function ensureAlarmAudio() {
    if (!alarmAudio) {
      alarmAudio = new Audio("alarm-beep.wav?v=" + APP_VER);
      alarmAudio.loop = true;
      try { alarmAudio.setAttribute("playsinline", "true"); } catch (e0) {}
      try { alarmAudio.preload = "auto"; } catch (e1) {}
    }
    return alarmAudio;
  }

  /* Must run inside a tap — iOS blocks timer-started Audio.play() */
  function unlockAlarmAudio() {
    ensureAlarmAudio();
    try {
      var p = alarmAudio.play();
      if (p && typeof p.then === "function") {
        p.then(function () {
          try {
            alarmAudio.pause();
            alarmAudio.currentTime = 0;
          } catch (eP) {}
          alarmUnlocked = true;
        }).catch(function () {
          alarmUnlocked = false;
        });
      } else {
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
        alarmUnlocked = true;
      }
    } catch (e) {
      alarmUnlocked = false;
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!alarmCtx) alarmCtx = new AC();
        if (alarmCtx.state === "suspended" && alarmCtx.resume) alarmCtx.resume();
        alarmUnlocked = true;
      }
    } catch (e2) {}
  }

  function startAlarmOscPulse() {
    if (!alarmCtx) return false;
    try {
      if (alarmCtx.state === "suspended" && alarmCtx.resume) alarmCtx.resume();
      stopAlarmOscPulse();
      function beepOnce() {
        try {
          var o = alarmCtx.createOscillator();
          var g = alarmCtx.createGain();
          o.type = "square";
          o.frequency.value = 880;
          g.gain.value = 0.7;
          o.connect(g);
          g.connect(alarmCtx.destination);
          o.start(0);
          if (g.gain.exponentialRampToValueAtTime) {
            g.gain.setValueAtTime(0.7, alarmCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.01, alarmCtx.currentTime + 0.35);
          }
          o.stop(alarmCtx.currentTime + 0.4);
          alarmOsc = o;
        } catch (eB) {}
      }
      beepOnce();
      alarmPulse = setInterval(beepOnce, 500);
      return true;
    } catch (e) {
      return false;
    }
  }

  function stopAlarmOscPulse() {
    if (alarmPulse) {
      clearInterval(alarmPulse);
      alarmPulse = null;
    }
    try {
      if (alarmOsc) {
        alarmOsc.stop(0);
        alarmOsc.disconnect();
      }
    } catch (e) {}
    alarmOsc = null;
  }

  function playAlarmTone() {
    try { startAlarmOscPulse(); } catch (e0) {}
    try {
      ensureAlarmAudio();
      alarmAudio.volume = 1;
      alarmAudio.muted = false;
      var p = alarmAudio.play();
      if (p && typeof p.then === "function") {
        p.catch(function () {});
      }
    } catch (e) {}
    toast("ALARM");
  }

  function stopAlarmTone() {
    try {
      if (alarmAudio) {
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
      }
    } catch (e) {}
    stopAlarmOscPulse();
  }

  function checkAlarm(d) {
    if (!GC) return;
    var a = GC.getAlarm();
    if (!a || !a.enabled) return;
    var hh = a.hh | 0;
    var mm = a.mm | 0;
    var nowT = d.getHours() * 60 + d.getMinutes();
    var alarmT = hh * 60 + mm;
    var key = alarmDayKey(d, hh, mm);
    if (alarmFiredKey === key) return;
    if (nowT === alarmT || (nowT > alarmT && nowT <= alarmT + 2)) {
      alarmFiredKey = key;
      playAlarmTone();
    }
  }

  function armAlarmForToday() {
    if (!GC) return;
    var a = GC.getAlarm();
    if (!a || !a.enabled) return;
    var d = new Date();
    var nowT = d.getHours() * 60 + d.getMinutes();
    var alarmT = (a.hh | 0) * 60 + (a.mm | 0);
    if (nowT >= alarmT) {
      alarmFiredKey = alarmDayKey(d, a.hh | 0, a.mm | 0);
    } else {
      alarmFiredKey = "";
    }
  }

  var radioPlaying = false;
  var radioAudioEl = null;

  function ensureRadioAudio() {
    var el = document.getElementById("radioNative");
    if (!el) {
      el = document.createElement("audio");
      el.id = "radioNative";
      document.body.appendChild(el);
    }
    el.setAttribute("playsinline", "true");
    el.setAttribute("webkit-playsinline", "true");
    el.setAttribute("controls", "controls");
    try { el.preload = "auto"; } catch (eP) {}
    try { el.removeAttribute("crossorigin"); } catch (eC) {}
    try { el.style.setProperty("display", "block", "important"); } catch (eD) { el.style.display = "block"; }
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.top = "0";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.opacity = "0.02";
    el.style.margin = "0";
    el.style.zIndex = "0";
    el.style.pointerEvents = "none";
    try { el.volume = 1; el.muted = false; } catch (eV) {}
    radioAudioEl = el;
    radioAudio = el;
    return el;
  }

  function unlockRadioAudio() {
    ensureRadioAudio();
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!window._radioCtx) window._radioCtx = new AC();
        if (window._radioCtx.state === "suspended" && window._radioCtx.resume) {
          window._radioCtx.resume();
        }
      }
    } catch (e1) {}
  }

  function syncRadioNowPlaying() {
    if (!GC) return;
    var st = GC.stationById(GC.getRadioId());
    if (soloFace !== "tv") {
      var nt = document.getElementById("nowTitle");
      var na = document.getElementById("nowArtist");
      if (nt) nt.textContent = st.name;
      if (na) na.textContent = radioPlaying ? "Radio · live" : "Radio · ready";
      if (nowApp) {
        nowApp.className = "media-app on";
        nowApp.textContent = "RADIO";
      }
      if (nowArt) {
        nowArt.className = "now-art";
        nowArt.removeAttribute("src");
      }
    }
    var playLabel = radioPlaying ? "Stop" : "Play";
    var playBtn = document.getElementById("radioPlayBtn");
    if (playBtn) playBtn.textContent = playLabel;
    var soloPlay = document.getElementById("soloRadioPlayBtn");
    if (soloPlay && soloFace !== "tv") soloPlay.textContent = playLabel;
    if (GC.publishRadioNow) {
      GC.publishRadioNow({
        playing: radioPlaying,
        id: st.id,
        name: st.name,
        t: new Date().getTime()
      });
    }
  }

  function syncMusicTvNowPlaying() {
    if (!GC) return;
    var nt = document.getElementById("nowTitle");
    var na = document.getElementById("nowArtist");
    if (tvSource === "cs") {
      if (nt) nt.textContent = csNowLabel || (GC.getCsGroup() || "CS").toUpperCase();
      if (na) {
        na.textContent = musicTvPlaying
          ? ("CS · " + (csNowLogin || "live"))
          : "CS · ready";
      }
      if (nowApp) {
        nowApp.className = "media-app on";
        nowApp.textContent = "CS";
      }
    } else {
      var ch = GC.musicChannelById(GC.getMusicTvId());
      if (nt) nt.textContent = ch.name;
      if (na) na.textContent = musicTvPlaying ? "Music TV · live" : "Music TV · ready";
      if (nowApp) {
        nowApp.className = "media-app on";
        nowApp.textContent = "TV";
      }
    }
    if (nowArt) {
      nowArt.className = "now-art";
      nowArt.removeAttribute("src");
    }
    var soloPlay = document.getElementById("soloRadioPlayBtn");
    if (soloPlay) soloPlay.textContent = musicTvPlaying ? "Stop" : "Play";
  }

  function syncActiveNowPlaying() {
    if (soloFace === "tv") syncMusicTvNowPlaying();
    else syncRadioNowPlaying();
  }

  function syncSoloFaceButtons() {
    var btnR = document.getElementById("soloFaceRadioBtn");
    var btnTv = document.getElementById("soloFaceTvBtn");
    if (btnR) btnR.className = soloFace === "radio" ? "solo-face-btn on" : "solo-face-btn";
    if (btnTv) btnTv.className = soloFace === "tv" ? "solo-face-btn on" : "solo-face-btn";
  }

  function syncSoloFaceUI() {
    if (!GC) return;
    if (soloFaceBusy) {
      syncSoloFaceButtons();
      syncActiveNowPlaying();
      return;
    }
    var faceRadio = document.getElementById("soloFaceRadio");
    var faceTv = document.getElementById("soloFaceTv");
    var wrap = document.getElementById("soloFaces");
    if (faceRadio) faceRadio.className = soloFace === "radio" ? "solo-face on" : "solo-face";
    if (faceTv) faceTv.className = soloFace === "tv" ? "solo-face on" : "solo-face";
    if (wrap) wrap.className = "solo-faces";
    syncSoloFaceButtons();
    syncActiveNowPlaying();
  }

  function setSoloFaceMode(face) {
    if (!GC) return;
    var next = face === "tv" ? "tv" : "radio";
    if (next === soloFace) {
      syncSoloFaceUI();
      syncBodyClass();
      return;
    }
    /* Instant switch — face slide/reflow was janky on iPad 2 */
    if (soloFaceAnimTimer) {
      clearTimeout(soloFaceAnimTimer);
      soloFaceAnimTimer = null;
    }
    soloFaceBusy = false;
    soloFace = next;
    GC.setSoloFace(soloFace);
    if (soloFace === "tv") {
      try { if (radioPlaying) stopRadio({ quiet: true }); } catch (e1) {}
    } else {
      try { if (musicTvPlaying) stopMusicTv({ quiet: true }); } catch (e2) {}
      try { clearCsLiveBar(); } catch (e3) {}
    }
    syncBodyClass();
    syncSoloFaceUI();
    toast(soloFace === "tv" ? "TV" : "Radio");
  }

  function syncRadioUI() {
    if (!GC) return;
    var cur = GC.getRadioId();
    syncRadioNowPlaying();
    var wrap = document.getElementById("radioChipBar");
    if (!wrap) return;
    var buttons = wrap.getElementsByTagName("button");
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      b.className = b.getAttribute("data-id") === cur ? "radio-chip on" : "radio-chip";
    }
  }

  function initRadioUI() {
    if (!GC) return;
    var wrap = document.getElementById("radioChipBar");
    if (!wrap) return;
    wrap.innerHTML = "";
    var cur = GC.getRadioId();
    for (var i = 0; i < GC.RADIO_STATIONS.length; i++) {
      (function (st) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = st.id === cur ? "radio-chip on" : "radio-chip";
        btn.setAttribute("data-id", st.id);
        btn.textContent = st.name;
        btn.onclick = function () {
          GC.setRadioId(st.id);
          syncRadioUI();
          if (radioPlaying) {
            unlockRadioAudio();
            playRadio();
          } else {
            syncRadioNowPlaying();
          }
        };
        wrap.appendChild(btn);
      })(GC.RADIO_STATIONS[i]);
    }
    syncRadioUI();
  }

  var radioTryList = [];
  var radioTryIdx = 0;
  var radioPlayGen = 0;

  function playRadioUrl(url) {
    var old = document.getElementById("radioNative");
    if (old && old.parentNode) {
      try { old.pause(); } catch (eP) {}
      try { old.removeAttribute("src"); } catch (eS) {}
      try { old.onerror = null; old.onplaying = null; } catch (eH) {}
      try { old.parentNode.removeChild(old); } catch (eR) {}
    }
    radioAudioEl = null;
    radioAudio = null;
    var el = ensureRadioAudio();
    var gen = ++radioPlayGen;
    var stName = "";
    try {
      var st0 = GC && GC.stationById(GC.getRadioId());
      stName = st0 && st0.name ? st0.name : "";
    } catch (eN) {}
    el.onerror = null;
    el.onplaying = null;
    el.src = url;
    try { el.load(); } catch (eL) {}
    el.onerror = function () {
      if (gen !== radioPlayGen) return;
      radioTryIdx++;
      if (radioTryIdx < radioTryList.length) {
        toast("radio retry…");
        playRadioUrl(radioTryList[radioTryIdx]);
      } else {
        radioPlaying = false;
        syncRadioUI();
        toast("radio fail" + (stName ? (" · " + stName) : ""));
      }
    };
    el.onplaying = function () {
      if (gen !== radioPlayGen) return;
      radioPlaying = true;
      syncRadioUI();
      toast("radio · " + (stName || "on"));
    };
    var p = null;
    try {
      el.muted = false;
      el.volume = 1;
      p = el.play();
    } catch (e2) { p = null; }
    if (p && typeof p.then === "function") {
      p.then(function () {
        if (gen !== radioPlayGen) return;
        radioPlaying = true;
        syncRadioUI();
        toast("radio · " + (stName || "on"));
      }).catch(function () {
        if (gen !== radioPlayGen) return;
        radioTryIdx++;
        if (radioTryIdx < radioTryList.length) playRadioUrl(radioTryList[radioTryIdx]);
        else {
          radioPlaying = false;
          syncRadioUI();
          toast("radio fail · tap Play");
        }
      });
    } else {
      radioPlaying = true;
      syncRadioUI();
      toast("radio · " + (stName || "on"));
    }
  }

  function playRadio() {
    if (!GC) return;
    if (mode !== "solo") {
      toast("radio · только STANDALONE");
      return;
    }
    try { if (musicTvPlaying) stopMusicTv({ quiet: true }); } catch (eTv) {}
    unlockRadioAudio();
    var st = GC.stationById(GC.getRadioId());
    radioTryList = [];
    if (st.url) radioTryList.push(st.url);
    if (st.url2 && st.url2 !== st.url) radioTryList.push(st.url2);
    if (st.url3 && st.url3 !== st.url && st.url3 !== st.url2) radioTryList.push(st.url3);
    if (!radioTryList.length) {
      radioPlaying = false;
      syncRadioUI();
      toast("radio fail");
      return;
    }
    radioTryIdx = 0;
    playRadioUrl(radioTryList[0]);
  }

  function stopRadio(opts) {
    opts = opts || {};
    try {
      var el = ensureRadioAudio();
      el.pause();
      el.removeAttribute("src");
      while (el.firstChild) el.removeChild(el.firstChild);
      try { el.load(); } catch (e2) {}
    } catch (e) {}
    radioPlaying = false;
    syncRadioUI();
    if (!opts.quiet) toast("radio stop");
  }

  function toggleRadio() {
    if (radioPlaying) stopRadio();
    else playRadio();
  }

  function stepRadio(delta) {
    if (!GC) return;
    var next = GC.nextStationId(GC.getRadioId(), delta);
    GC.setRadioId(next);
    syncRadioUI();
    if (radioPlaying) playRadio();
  }

  function musicTvVideo() {
    return document.getElementById("musicTvVideo");
  }

  function syncMusicTvStage() {
    var stage = document.getElementById("musicTvStage");
    if (!stage) return;
    stage.className = musicTvPlaying ? "tv-stage playing" : "tv-stage";
  }

  function syncCsLiveBar() {
    var bar = document.getElementById("csLiveBar");
    if (!bar) return;
    var buttons = bar.getElementsByTagName("button");
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var id = b.getAttribute("data-cs-id");
      b.className = (tvSource === "cs" && id && id === csNowId) ? "radio-chip on" : "radio-chip";
    }
  }

  function clearCsLiveBar() {
    var bar = document.getElementById("csLiveBar");
    if (bar) bar.innerHTML = "";
    csLiveList = [];
  }

  function syncMusicTvChips() {
    if (!GC) return;
    var wrap = document.getElementById("musicTvChipBar");
    if (!wrap) return;
    var curMusic = GC.getMusicTvId();
    var curCs = GC.getCsGroup();
    var buttons = wrap.getElementsByTagName("button");
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var kind = b.getAttribute("data-kind") || "music";
      if (kind === "cs") {
        var gid = b.getAttribute("data-group");
        b.className = (tvSource === "cs" && gid === curCs) ? "radio-chip on" : "radio-chip";
      } else {
        var mid = b.getAttribute("data-id");
        b.className = (tvSource === "music" && mid === curMusic) ? "radio-chip on" : "radio-chip";
      }
    }
    syncCsLiveBar();
    syncMusicTvStage();
    if (soloFace === "tv") syncMusicTvNowPlaying();
  }

  function renderCsLiveRow(group, channels) {
    var bar = document.getElementById("csLiveBar");
    if (!bar) return;
    bar.innerHTML = "";
    csLiveList = channels || [];
    if (!csLiveList.length) {
      var empty = document.createElement("span");
      empty.className = "cs-live-empty";
      empty.textContent = "no live · " + String(group || "").toUpperCase();
      bar.appendChild(empty);
      return;
    }
    for (var i = 0; i < csLiveList.length; i++) {
      (function (ch) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = (ch.id === csNowId) ? "radio-chip on" : "radio-chip";
        btn.setAttribute("data-cs-id", ch.id);
        btn.textContent = ch.label || ch.login || ch.id;
        btn.onclick = function () {
          playCsTv(group, ch.id);
        };
        bar.appendChild(btn);
      })(csLiveList[i]);
    }
  }

  function loadCsLiveRow(group) {
    if (!GC) return;
    var g = group || GC.getCsGroup() || "live";
    GC.setCsGroup(g);
    tvSource = "cs";
    syncMusicTvChips();
    if (!GC.canUseHubApi || !GC.canUseHubApi()) {
      clearCsLiveBar();
      toast("CS · нужен хаб");
      return;
    }
    var bar = document.getElementById("csLiveBar");
    if (bar) {
      bar.innerHTML = "";
      var wait = document.createElement("span");
      wait.className = "cs-live-empty";
      wait.textContent = "ищем…";
      bar.appendChild(wait);
    }
    toast("CS · кто в эфире…");
    var gen = ++csStatusGen;
    var url = GC.apiUrl("/api/cs/status?group=" + encodeURIComponent(g) + "&refresh=1");
    GC.xhrGet(url, 20000, function (txt) {
      if (gen !== csStatusGen) return;
      var data = null;
      try { data = JSON.parse(txt); } catch (eJ) { data = null; }
      var live = [];
      var list = (data && data.channels) ? data.channels : [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].live) live.push(list[i]);
      }
      renderCsLiveRow(g, live);
      if (!live.length) toast("нет эфира · " + g.toUpperCase());
      else toast("CS · " + live.length + " live");
    }, function () {
      if (gen !== csStatusGen) return;
      clearCsLiveBar();
      toast("CS · хаб offline");
    });
  }

  function initMusicTvUI() {
    if (!GC) return;
    var wrap = document.getElementById("musicTvChipBar");
    if (!wrap) return;
    wrap.innerHTML = "";
    var cur = GC.getMusicTvId();
    for (var i = 0; i < GC.MUSIC_TV_CHANNELS.length; i++) {
      (function (ch) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = (tvSource === "music" && ch.id === cur) ? "radio-chip on" : "radio-chip";
        btn.setAttribute("data-kind", "music");
        btn.setAttribute("data-id", ch.id);
        btn.textContent = ch.name;
        btn.onclick = function () {
          tvSource = "music";
          csNowLabel = "";
          csNowLogin = "";
          csNowId = "";
          clearCsLiveBar();
          GC.setMusicTvId(ch.id);
          syncMusicTvChips();
          playMusicTv();
        };
        wrap.appendChild(btn);
      })(GC.MUSIC_TV_CHANNELS[i]);
    }
    var groups = GC.CS_GROUPS || [];
    for (var g = 0; g < groups.length; g++) {
      (function (grp) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "radio-chip";
        btn.setAttribute("data-kind", "cs");
        btn.setAttribute("data-group", grp.id);
        btn.textContent = grp.name;
        btn.onclick = function () {
          loadCsLiveRow(grp.id);
        };
        wrap.appendChild(btn);
      })(groups[g]);
    }
    syncMusicTvChips();
  }

  function playVideoUrl(url, label, opts) {
    opts = opts || {};
    var el = musicTvVideo();
    if (!el || !url) {
      toast((opts.failToast) || "TV fail");
      return;
    }
    var gen = ++musicTvPlayGen;
    try { el.pause(); } catch (eP) {}
    try { el.removeAttribute("src"); } catch (eS) {}
    try { el.load(); } catch (eL0) {}
    el.onerror = null;
    el.onplaying = null;
    try { el.onstalled = null; } catch (eSt) {}
    el.setAttribute("playsinline", "true");
    el.setAttribute("webkit-playsinline", "true");
    el.setAttribute("controls", "controls");
    try { el.removeAttribute("crossorigin"); } catch (eC) {}
    el.src = url;
    try { el.load(); } catch (eL) {}
    el.onerror = function () {
      if (gen !== musicTvPlayGen) return;
      musicTvPlaying = false;
      syncMusicTvChips();
      toast(opts.failToast || ("TV fail · " + (label || "")));
    };
    el.onplaying = function () {
      if (gen !== musicTvPlayGen) return;
      musicTvPlaying = true;
      syncMusicTvChips();
      toast(opts.okToast || ("TV · " + (label || "on")));
    };
    var p = null;
    try {
      el.muted = false;
      el.volume = 1;
      p = el.play();
    } catch (e2) { p = null; }
    if (p && typeof p.then === "function") {
      p.then(function () {
        if (gen !== musicTvPlayGen) return;
        musicTvPlaying = true;
        syncMusicTvChips();
        toast(opts.okToast || ("TV · " + (label || "on")));
      }).catch(function () {
        if (gen !== musicTvPlayGen) return;
        musicTvPlaying = false;
        syncMusicTvChips();
        toast(opts.failToast || "TV fail · tap channel");
      });
    } else {
      musicTvPlaying = true;
      syncMusicTvChips();
      toast(opts.okToast || ("TV · " + (label || "on")));
    }
  }

  function playMusicTv() {
    if (!GC) return;
    if (mode !== "solo") {
      toast("TV · только STANDALONE");
      return;
    }
    if (soloFace !== "tv") setSoloFaceMode("tv");
    try { if (radioPlaying) stopRadio({ quiet: true }); } catch (eR) {}
    tvSource = "music";
    csNowId = "";
    clearCsLiveBar();
    var ch = GC.musicChannelById(GC.getMusicTvId());
    if (!ch || !ch.url) {
      toast("TV fail");
      return;
    }
    var urls = [];
    if (ch.url) urls.push(ch.url);
    if (ch.url2 && ch.url2 !== ch.url) urls.push(ch.url2);
    var tryIdx = 0;
    var gen = ++musicTvPlayGen;
    function tryOne() {
      if (gen !== musicTvPlayGen) return;
      if (tryIdx >= urls.length) {
        musicTvPlaying = false;
        syncMusicTvChips();
        toast("TV fail · " + ch.name);
        return;
      }
      var url = urls[tryIdx];
      var el = musicTvVideo();
      if (!el) return;
      try { el.pause(); } catch (eP) {}
      try { el.removeAttribute("src"); } catch (eS) {}
      try { el.load(); } catch (eL0) {}
      el.onerror = null;
      el.onplaying = null;
      el.setAttribute("playsinline", "true");
      el.setAttribute("webkit-playsinline", "true");
      el.setAttribute("controls", "controls");
      try { el.removeAttribute("crossorigin"); } catch (eC) {}
      el.src = url;
      try { el.load(); } catch (eL) {}
      el.onerror = function () {
        if (gen !== musicTvPlayGen) return;
        tryIdx++;
        if (tryIdx < urls.length) toast("TV retry…");
        tryOne();
      };
      el.onplaying = function () {
        if (gen !== musicTvPlayGen) return;
        musicTvPlaying = true;
        syncMusicTvChips();
        toast("TV · " + ch.name);
      };
      var p = null;
      try {
        el.muted = false;
        el.volume = 1;
        p = el.play();
      } catch (e2) { p = null; }
      if (p && typeof p.then === "function") {
        p.then(function () {
          if (gen !== musicTvPlayGen) return;
          musicTvPlaying = true;
          syncMusicTvChips();
          toast("TV · " + ch.name);
        }).catch(function () {
          if (gen !== musicTvPlayGen) return;
          tryIdx++;
          tryOne();
        });
      } else {
        musicTvPlaying = true;
        syncMusicTvChips();
        toast("TV · " + ch.name);
      }
    }
    tryOne();
  }

  function playCsTv(group, presetId) {
    if (!GC) return;
    if (mode !== "solo") {
      toast("CS · только STANDALONE");
      return;
    }
    if (soloFace !== "tv") setSoloFaceMode("tv");
    try { if (radioPlaying) stopRadio({ quiet: true }); } catch (eR) {}
    if (!GC.canUseHubApi || !GC.canUseHubApi()) {
      toast("CS · нужен хаб");
      musicTvPlaying = false;
      syncMusicTvChips();
      return;
    }
    var g = group || GC.getCsGroup() || "live";
    var pid = presetId || csNowId || "";
    if (!pid) {
      loadCsLiveRow(g);
      return;
    }
    GC.setCsGroup(g);
    tvSource = "cs";
    csNowId = pid;
    csNowLabel = g.toUpperCase();
    csNowLogin = "…";
    syncMusicTvChips();
    toast("CS · подключаем…");
    var gen = ++musicTvPlayGen;
    var url = GC.apiUrl(
      "/api/cs/play?group=" + encodeURIComponent(g) +
      "&id=" + encodeURIComponent(pid)
    );
    GC.xhrGet(url, 45000, function (txt) {
      if (gen !== musicTvPlayGen) return;
      var data = null;
      try { data = JSON.parse(txt); } catch (eJ) { data = null; }
      if (!data || !data.ok || !data.url) {
        musicTvPlaying = false;
        csNowLogin = "";
        syncMusicTvChips();
        var err = data && data.error ? data.error : "нет эфира";
        toast("CS · " + err);
        return;
      }
      csNowId = data.id || pid;
      csNowLabel = data.label || data.login || g.toUpperCase();
      csNowLogin = data.login || "";
      var playUrl = data.url || "";
      if (playUrl.charAt(0) === "/") playUrl = GC.apiUrl(playUrl);
      syncCsLiveBar();
      playVideoUrl(playUrl, csNowLabel, {
        okToast: "CS · " + csNowLabel,
        failToast: "CS fail · " + csNowLabel
      });
    }, function () {
      if (gen !== musicTvPlayGen) return;
      musicTvPlaying = false;
      csNowLogin = "";
      syncMusicTvChips();
      toast("CS · хаб offline");
    });
  }

  function stopMusicTv(opts) {
    opts = opts || {};
    musicTvPlayGen++;
    var el = musicTvVideo();
    if (el) {
      try { el.pause(); } catch (eP) {}
      try { el.removeAttribute("src"); } catch (eS) {}
      try { el.load(); } catch (eL) {}
      el.onerror = null;
      el.onplaying = null;
    }
    musicTvPlaying = false;
    if (tvSource !== "cs") {
      csNowLabel = "";
      csNowLogin = "";
      csNowId = "";
    }
    syncMusicTvChips();
    if (!opts.quiet) toast(tvSource === "cs" ? "CS stop" : "TV stop");
  }

  function toggleMusicTv() {
    if (musicTvPlaying) stopMusicTv();
    else if (tvSource === "cs") {
      if (csNowId) playCsTv(GC.getCsGroup(), csNowId);
      else loadCsLiveRow(GC.getCsGroup());
    } else playMusicTv();
  }

  function stepMusicTv(delta) {
    if (!GC) return;
    if (tvSource === "cs") {
      if (csLiveList.length) {
        var idx = 0;
        for (var i = 0; i < csLiveList.length; i++) {
          if (csLiveList[i].id === csNowId) { idx = i; break; }
        }
        var n = csLiveList.length;
        idx = ((idx + (delta || 1)) % n + n) % n;
        playCsTv("live", csLiveList[idx].id);
        return;
      }
      loadCsLiveRow("live");
      return;
    }
    var next = GC.nextMusicChannelId(GC.getMusicTvId(), delta);
    GC.setMusicTvId(next);
    syncMusicTvChips();
    if (musicTvPlaying || soloFace === "tv") playMusicTv();
  }

  function toggleSoloMedia() {
    if (soloFace === "tv") toggleMusicTv();
    else toggleRadio();
  }

  function stepSoloMedia(delta) {
    if (soloFace === "tv") stepMusicTv(delta);
    else stepRadio(delta);
  }

  function doAction(name) {
    if (mode !== "deck") { toast("hub offline"); return; }
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
        if (typeof r.volume === "number") syncVolumeUI(r.volume, r.muted);
        if (typeof r.muted === "boolean") isMuted = r.muted;
        setTimeout(refreshStatus, 400);
      } catch (e) {
        toast("fail");
      }
    };
    xhr.send(JSON.stringify({ name: name }));
  }

  function sendAudioScene(scene) {
    if (mode !== "deck") { toast("hub offline"); return; }
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
        if (r.audio) syncAudioUI(r.audio);
        setTimeout(refreshStatus, 350);
      } catch (e) { toast("fail"); }
    };
    xhr.send(JSON.stringify({ name: "audio_scene", value: scene }));
  }

  var volValueEl = document.getElementById("volValue");

  function nearestPreset(v) {
    var presets = [15, 30, 50, 75, 100];
    var best = -1, bestD = 999;
    for (var i = 0; i < presets.length; i++) {
      var d = Math.abs(presets[i] - v);
      if (d < bestD) { bestD = d; best = presets[i]; }
    }
    return bestD <= 2 ? best : -1;
  }

  function syncVolumeUI(v, mutedFlag) {
    v = Math.max(0, Math.min(100, v | 0));
    lastVolume = v;
    if (typeof mutedFlag === "boolean") isMuted = mutedFlag;
    else if (v === 0) isMuted = true;
    if (volValueEl) volValueEl.textContent = (isMuted ? "MUTE · " : "") + v + "%";
    var presets = document.querySelectorAll(".vol-preset");
    var muteOn = isMuted || v === 0;
    var hit = muteOn ? -1 : nearestPreset(v);
    for (var i = 0; i < presets.length; i++) {
      var btn = presets[i];
      var isMuteBtn = btn.getAttribute("data-action") === "mute";
      var on = false;
      if (isMuteBtn) {
        on = muteOn;
      } else {
        var pv = parseInt(btn.getAttribute("data-vol"), 10);
        on = !muteOn && pv === hit;
      }
      btn.className = on ? "vol-preset on" : "vol-preset";
    }
  }

  function sendVolume(v) {
    if (mode !== "deck") { toast("hub offline"); return; }
    isMuted = (v === 0);
    syncVolumeUI(v, isMuted);
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
        if (typeof r.volume === "number") syncVolumeUI(r.volume, r.muted);
        if (typeof r.muted === "boolean") isMuted = r.muted;
      } catch (e) { toast("fail"); }
    };
    xhr.send(JSON.stringify({ name: "vol_set", value: v }));
  }

  var presetBtns = document.querySelectorAll(".vol-preset");
  for (var pi = 0; pi < presetBtns.length; pi++) {
    (function (btn) {
      btn.onclick = function () {
        if (btn.getAttribute("data-action") === "mute") {
          doAction("mute");
          return;
        }
        sendVolume(parseInt(btn.getAttribute("data-vol"), 10));
      };
    })(presetBtns[pi]);
  }

  var sceneHpEl = document.getElementById("sceneHp");
  if (sceneHpEl) sceneHpEl.onclick = function () { sendAudioScene("headphones"); };
  var sceneSpEl = document.getElementById("sceneSp");
  if (sceneSpEl) sceneSpEl.onclick = function () { sendAudioScene("bluetooth"); };

  var alarmToggleEl = document.getElementById("alarmToggle");
  if (alarmToggleEl) {
    alarmToggleEl.onclick = function () {
      if (!GC) return;
      var a = GC.getAlarm();
      var inp = document.getElementById("alarmTime");
      var parts = ((inp && inp.value) || "07:00").split(":");
      a.hh = parseInt(parts[0], 10) || 0;
      a.mm = parseInt(parts[1], 10) || 0;
      a.enabled = !a.enabled;
      GC.setAlarm(a);
      if (a.enabled) {
        unlockAlarmAudio();
        armAlarmForToday();
        toast("alarm on");
      } else {
        stopAlarmTone();
        toast("alarm off");
      }
      syncAlarmUI();
    };
  }

  var alarmStopEl = document.getElementById("alarmStop");
  if (alarmStopEl) {
    alarmStopEl.onclick = function () {
      stopAlarmTone();
      toast("alarm stop");
    };
  }

  var alarmTimeEl = document.getElementById("alarmTime");
  if (alarmTimeEl) {
    alarmTimeEl.onchange = function () {
      if (!GC) return;
      var a = GC.getAlarm();
      var parts = (alarmTimeEl.value || "07:00").split(":");
      a.hh = parseInt(parts[0], 10) || 0;
      a.mm = parseInt(parts[1], 10) || 0;
      GC.setAlarm(a);
      if (a.enabled) armAlarmForToday();
      syncAlarmUI();
    };
  }

  function doMacro(name) {
    if (mode !== "deck" || !GC || !GC.canUseHubApi()) { toast("hub offline"); return; }
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

  var actionBtns = document.querySelectorAll("button.pad, #mediaControlsDeck button.media-btn");
  for (var i = 0; i < actionBtns.length; i++) {
    (function (btn) {
      btn.onclick = function () {
        var m = btn.getAttribute("data-macro");
        if (m) { doMacro(m); return; }
        doAction(btn.getAttribute("data-action"));
      };
    })(actionBtns[i]);
  }

  function bindRadioBtn(id, fn) {
    var el = document.getElementById(id);
    if (!el) return;
    el.onclick = function () {
      unlockRadioAudio();
      fn();
    };
  }
  bindRadioBtn("radioPlayBtn", toggleRadio);
  bindRadioBtn("radioPrevBtn", function () { stepRadio(-1); });
  bindRadioBtn("radioNextBtn", function () { stepRadio(1); });
  bindRadioBtn("soloRadioPlayBtn", toggleSoloMedia);
  bindRadioBtn("soloRadioPrevBtn", function () { stepSoloMedia(-1); });
  bindRadioBtn("soloRadioNextBtn", function () { stepSoloMedia(1); });

  (function () {
    var btnR = document.getElementById("soloFaceRadioBtn");
    var btnTv = document.getElementById("soloFaceTvBtn");
    if (btnR) {
      btnR.onclick = function () { setSoloFaceMode("radio"); };
    }
    if (btnTv) {
      btnTv.onclick = function () { setSoloFaceMode("tv"); };
    }
  })();

  (function bindDeckPages() {
    var gridEl = document.getElementById("deckPages");
    var dots = document.getElementById("deckDots");
    if (gridEl) {
      gridEl.addEventListener("touchstart", function (e) {
        if (e.touches && e.touches[0]) gridEl._x0 = e.touches[0].clientX;
      }, false);
      gridEl.addEventListener("touchend", function (e) {
        if (!(e.changedTouches && e.changedTouches[0])) return;
        var dx = (e.changedTouches[0].clientX || 0) - (gridEl._x0 || 0);
        if (Math.abs(dx) > 44) {
          deckPage += dx < 0 ? 1 : -1;
          syncDeckPage();
        }
      }, false);
    }
    if (dots) {
      dots.onclick = function (e) {
        var t = e.target || e.srcElement;
        while (t && t !== dots) {
          var pg = t.getAttribute && t.getAttribute("data-pg");
          if (pg != null) {
            deckPage = parseInt(pg, 10) || 0;
            syncDeckPage();
            return;
          }
          t = t.parentNode;
        }
      };
    }
    syncDeckPage();
  })();

  hideChrome();
  initRadioUI();
  initMusicTvUI();
  syncBodyClass();
  syncSoloFaceUI();
  syncAlarmUI();
  armAlarmForToday();
  tickClock();
  setInterval(tickClock, 1000);

  (function () {
    var pw = document.getElementById("lvPower");
    if (!pw) return;
    pw.onclick = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      unlockAlarmAudio();
      if (powerWarnActive) {
        dismissPowerWarn(false);
        return;
      }
      powerFace = ((powerFace | 0) + 1) % 3;
      setPowerCardClass(lastPower);
    };
  })();

  refreshLivingClient();
  setInterval(refreshLivingClient, 60000);
  setTimeout(refreshLivingClient, 4000);
  refreshPowerClient();
  setInterval(refreshPowerClient, 60000);
  setTimeout(refreshPowerClient, 3500);

  if (!hubHeld) {
    heartbeat();
    refreshStatus();
    startEventLoop();
  } else {
    setMode("solo", { auto: true });
    setMeta("<b>standalone</b><br>ПК был выключен · DECK когда включишь");
  }
  setInterval(heartbeat, 8000);
  /* Status push via /api/events long-poll; slow fallback if loop stopped */
  setInterval(function () {
    if (!eventLoopArmed && mode === "deck" && !hubIsQuiet()) {
      refreshStatus();
      startEventLoop();
    }
  }, 20000);
})();
