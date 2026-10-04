/* Textmode Deck app shell — ES5 */
(function () {
      var IDLE_MS = 45000;
      var DRIVE_VER = 60;
      var APP_VER = 60;
      var THEME_KEY = "kissaten_deck_theme";
      var SCENE_KEY = "kissaten_idle_scene";
      var SCENES = [
        { id: "drive", name: "Ночная дорога" },
        { id: "rain", name: "Окно в дождь" },
        { id: "ramen", name: "Рамэн" },
        { id: "vinyl", name: "Пластинка" }
      ];
      var GC = window.GadgetCore;
      // Drop obsolete night-mode flag from older builds
      try { localStorage.removeItem("kissaten_deck_night"); } catch (e0) {}
      var theme = "C";
      var idleTimer = null;
      var idleLoadedTheme = null;
      var idleFailTimer = null;
      var lastActivity = (new Date()).getTime();
      var lastTouchAt = 0;
      var ignoreBumpUntil = 0;
      var idleWatch = null;
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
      var livingTimer = null;
      var newsTimer = null;
      var livingGen = 0;
      var alarmFiredKey = "";
      var alarmUnlocked = false;
      var alarmCtx = null;
      var alarmOsc = null;
      var alarmPulse = null;
      var radioAudio = null;
      var alarmAudio = null;
      var toastEl = document.getElementById("toast");
      var metaEl = document.getElementById("meta");
      var idleEl = document.getElementById("idle");
      var tipEl = document.getElementById("tip");
      var idleFrame = document.getElementById("idleFrame");
      var drawerEl = document.getElementById("drawer");
      var appEl = document.getElementById("app");
      var nowArt = document.getElementById("nowArt");
      var nowApp = document.getElementById("nowApp");
      var modeBadge = document.getElementById("modeBadge");

      var names = {
        B: "PHOSPHOR · GREEN",
        C: "CRT · CYAN",
        D: "AMBER · TERMINAL"
      };

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

      function toast(msg) {
        toastEl.textContent = msg || "";
      }

      function setMeta(html) {
        metaEl.innerHTML = html;
      }

      function readTheme() {
        try {
          var t = localStorage.getItem(THEME_KEY);
          if (t === "B" || t === "C" || t === "D") return t;
        } catch (e) {}
        return "C";
      }

      function saveTheme(t) {
        try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
      }

      function isStandalone() {
        return window.navigator.standalone === true ||
          (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
      }

      function syncBodyClass() {
        var cls = "theme-" + theme;
        if (isStandalone()) cls += " standalone";
        cls += mode === "solo" ? " mode-solo" : " mode-deck";
        document.body.className = cls;
        document.getElementById("mediaBrand").textContent = names[theme] || names.C;
        var pills = document.querySelectorAll(".theme-pill");
        for (var i = 0; i < pills.length; i++) {
          var p = pills[i];
          p.className = p.getAttribute("data-theme") === theme ? "theme-pill on" : "theme-pill";
        }
        document.getElementById("fsBtn").textContent =
          isStandalone() ? "Full ✓" : "Fullscreen tip";
        modeBadge.textContent = mode === "solo" ? "STANDALONE" : "DECK";
        if (modeLock) modeBadge.textContent += " · lock";
        var modePills = document.querySelectorAll(".mode-pill");
        for (var mi = 0; mi < modePills.length; mi++) {
          var mp = modePills[mi];
          mp.className = mp.getAttribute("data-mode") === mode ? "mode-pill on" : "mode-pill";
        }
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
          syncRadioNowPlaying();
          setMeta("<b>standalone</b><br>ожидание хаба");
        } else {
          /* Keep radio available in DECK — do not kill stream on mode switch */
          if (radioPlaying) syncRadioNowPlaying();
          toast("deck online");
        }
      }

      function applyTheme(t, animate) {
        var wasIdle = idleEl.className === "on";
        theme = t;
        if (animate) {
          appEl.className = "theme-fade";
          setTimeout(function () {
            syncBodyClass();
            appEl.className = "";
          }, 140);
        } else {
          syncBodyClass();
        }
        idleLoadedTheme = null;
        idleFrame.src = "about:blank";
        saveTheme(t);
        if (wasIdle) {
          setTimeout(function () { showIdle(true); }, 80);
        }
      }

      function driveUrl() {
        var hub = GC ? GC.getHubBase() : "";
        var q = "theme=" + theme +
          "&scene=" + readScene() +
          "&v=" + DRIVE_VER +
          "&mode=" + mode;
        if (hub) q += "&hub=" + encodeURIComponent(hub);
        /* Always same-origin — never hubPath (HTTPS Pages cannot iframe HTTP hub) */
        return "night-drive.html?" + q;
      }

      function readScene() {
        try {
          var s = localStorage.getItem(SCENE_KEY) || "drive";
          for (var i = 0; i < SCENES.length; i++) {
            if (SCENES[i].id === s) return s;
          }
        } catch (e) {}
        return "drive";
      }
      function saveScene(id) {
        try { localStorage.setItem(SCENE_KEY, id); } catch (e) {}
      }
      function syncSceneUI() {
        var cur = readScene();
        var nodes = document.querySelectorAll(".scene-pick");
        for (var i = 0; i < nodes.length; i++) {
          var on = nodes[i].getAttribute("data-scene") === cur;
          nodes[i].className = on ? "drawer-btn scene-pick on" : "drawer-btn scene-pick";
        }
      }
      function buildSceneList() {
        var box = document.getElementById("sceneList");
        if (!box) return;
        box.innerHTML = "";
        for (var i = 0; i < SCENES.length; i++) {
          (function (sc) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "drawer-btn scene-pick";
            b.setAttribute("data-scene", sc.id);
            b.textContent = sc.name;
            b.onclick = function (ev) {
              if (!drawerTapOk()) {
                if (ev && ev.preventDefault) ev.preventDefault();
                return;
              }
              if (ev && ev.preventDefault) ev.preventDefault();
              if (ev && ev.stopPropagation) ev.stopPropagation();
              saveScene(sc.id);
              syncSceneUI();
              idleLoadedTheme = null;
              closeDrawer();
              ignoreBumpUntil = (new Date()).getTime() + 2800;
              setTimeout(function () { showIdle(true); }, 50);
              toast(sc.name);
            };
            box.appendChild(b);
          })(SCENES[i]);
        }
        syncSceneUI();
      }
      var drawerArm = 0;
      function openDrawer() {
        drawerArm = (new Date()).getTime() + 700;
        drawerEl.className = "on";
        syncSceneUI();
        document.getElementById("hubInput").value = GC ? (GC.getHubBase() || location.origin) : location.origin;
      }
      function closeDrawer() {
        drawerEl.className = "";
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
        tipEl.className = "on";
      }

      document.getElementById("fsBtn").onclick = goFullscreenTip;
      document.getElementById("cinemaBtn").onclick = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        closeDrawer();
        /* Delay past iOS synthetic mousedown on the same tap point */
        ignoreBumpUntil = (new Date()).getTime() + 2800;
        setTimeout(function () { showIdle(true); }, 50);
        toast("cinema");
      };
      document.getElementById("infoChip").ontouchend = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        openDrawer();
      };
      document.getElementById("infoChip").onclick = function () { openDrawer(); };
      document.getElementById("drawerBack").onclick = closeDrawer;
      document.getElementById("tipOk").onclick = function () { tipEl.className = ""; };
      document.getElementById("hubSave").onclick = function () {
        var v = document.getElementById("hubInput").value.replace(/^\s+|\s+$/g, "");
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

      function goToHubDeck() {
        var base = GC ? GC.getHubBase() : "";
        if (!base) {
          toast("укажи hub URL");
          setMeta("<b>нет hub URL</b><br>MENU → Save hub URL");
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
          setMode("solo");
          toast("STANDALONE");
          setMeta("<b>standalone</b><br>к ПК не подключаюсь");
        }
      }
      document.getElementById("modeDeckBtn").onclick = function (e) {
        if (!drawerTapOk()) { if (e && e.preventDefault) e.preventDefault(); return; }
        pickMode("deck");
      };
      document.getElementById("modeSoloBtn").onclick = function (e) {
        if (!drawerTapOk()) { if (e && e.preventDefault) e.preventDefault(); return; }
        pickMode("solo");
      };

      // swipe from left edge → drawer
      var touchX0 = 0, touchY0 = 0, tracking = false;
      document.getElementById("header").addEventListener("touchstart", function (e) {
        if (!e.touches || !e.touches.length) return;
        touchX0 = e.touches[0].pageX;
        touchY0 = e.touches[0].pageY;
        tracking = true;
      }, false);
      document.getElementById("header").addEventListener("touchend", function (e) {
        if (!tracking) return;
        tracking = false;
        if (!e.changedTouches || !e.changedTouches.length) return;
        var dx = e.changedTouches[0].pageX - touchX0;
        var dy = e.changedTouches[0].pageY - touchY0;
        if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy)) return;
        if (dx > 0) openDrawer();
        if (dx < 0) closeDrawer();
      }, false);

      function idleArtUrl() {
        var s = readScene();
        var t = readTheme();
        if (s === "ramen") return "art/pack-ramen.gif?v=" + APP_VER;
        if (s !== "rain" && s !== "vinyl") s = "drive";
        return "art/scene-" + s + "-" + t + ".gif?v=" + APP_VER;
      }

      function paintIdleChrome() {
        var w = document.getElementById("lvWeatherVal");
        var iw = document.getElementById("idleWxVal");
        if (w && iw) iw.textContent = w.textContent;
        var a = document.getElementById("lvAlertVal");
        var ia = document.getElementById("idleAlVal");
        if (a && ia) ia.textContent = a.textContent;
        var asub = document.getElementById("lvAlertSub");
        var ias = document.getElementById("idleAlSub");
        if (asub && ias) ias.textContent = asub.textContent;
        var al = document.getElementById("lvAlert");
        var ial = document.getElementById("idleAl");
        if (al && ial) {
          var alertOn = al.className.indexOf(" on") >= 0 || al.className === "lv-alert on";
          ial.className = alertOn ? "card on" : "card";
        }
        var title = document.getElementById("nowTitle");
        var it = document.getElementById("idlePlay");
        if (title && it) it.textContent = title.textContent;
        var artist = document.getElementById("nowArtist");
        var isub = document.getElementById("idlePlaySub");
        if (artist && isub) isub.textContent = artist.textContent;
        var mainTrack = document.getElementById("tickerTrack");
        var idleTrack = document.getElementById("idleTickerTrack");
        if (mainTrack && idleTrack && idleTrack.innerHTML.length < 20 && mainTrack.innerHTML.length > 20) {
          idleTrack.innerHTML = mainTrack.innerHTML;
        }
      }

      function placeIdlePic() {
        var img = document.getElementById("idlePic");
        if (!img) return;
        var vw = window.innerWidth || document.documentElement.clientWidth || 320;
        var vh = window.innerHeight || document.documentElement.clientHeight || 480;
        if (vw < 2) vw = 320;
        if (vh < 2) vh = 480;
        var GW = (img.naturalWidth > 2) ? img.naturalWidth : 480;
        var GH = (img.naturalHeight > 2) ? img.naturalHeight : 270;
        var gs = Math.min(vw / GW, vh / GH);
        if (!(gs > 0)) gs = 1;
        var dw = Math.round(GW * gs);
        var dh = Math.round(GH * gs);
        img.style.width = dw + "px";
        img.style.height = dh + "px";
        img.style.left = Math.max(0, Math.round((vw - dw) / 2)) + "px";
        img.style.top = Math.max(0, Math.round((vh - dh) / 2)) + "px";
      }

      function loadIdleFrame(forceReload) {
        var img = document.getElementById("idlePic");
        var url = idleArtUrl();
        if (!img) return;
        if (forceReload || img.getAttribute("data-on") !== url) {
          img.onload = function () { placeIdlePic(); };
          img.src = url;
          img.setAttribute("data-on", url);
        }
        placeIdlePic();
        paintIdleChrome();
        idleLoadedTheme = theme + "|v" + DRIVE_VER + "|" + readScene();
      }

      function showIdle(forced) {
        /* Guard must outlast iOS ghost mousedown that hits idleCatch after Cinema */
        ignoreBumpUntil = (new Date()).getTime() + (forced ? 2800 : 1500);
        closeDrawer();
        idleEl.className = "on";
        if (idleFailTimer) clearTimeout(idleFailTimer);
        setTimeout(function () {
          loadIdleFrame(false);
          placeIdlePic();
        }, 30);
        setTimeout(placeIdlePic, 400);
        idleFailTimer = null;
      }

      if (window.addEventListener) {
        window.addEventListener("resize", placeIdlePic, false);
        window.addEventListener("orientationchange", function () {
          setTimeout(placeIdlePic, 250);
        }, false);
      }

      function bumpIdle(e, opts) {
        var now = (new Date()).getTime();
        var forceDismiss = !!(opts && opts.dismiss);
        /* iOS ghost mousedown after touch */
        if (e && e.type === "mousedown" && (now - lastTouchAt) < 1600) {
          return;
        }
        /* CRITICAL: even idleCatch dismiss is blocked during guard —
           Cinema tap's synthetic mousedown lands on idleCatch and used to kill idle */
        if (now < ignoreBumpUntil) {
          return;
        }
        if (idleEl.className === "on") {
          if (!forceDismiss) return;
          idleEl.className = "";
          if (idleFailTimer) {
            clearTimeout(idleFailTimer);
            idleFailTimer = null;
          }
        }
        if (e && e.type === "touchstart") {
          lastTouchAt = now;
        }
        lastActivity = now;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function () { showIdle(false); }, IDLE_MS);
      }

      function startIdleWatch() {
        if (idleWatch) return;
        idleWatch = setInterval(function () {
          if (idleEl.className === "on") return;
          var now = (new Date()).getTime();
          if (now < ignoreBumpUntil) return;
          if ((now - lastActivity) >= IDLE_MS) {
            showIdle(false);
          }
        }, 2000);
      }

      var nowPlaying = false;
      var nowBars = document.getElementById("nowBars");
      var barNodes = [];
      for (var bi = 0; bi < 18; bi++) {
        var sp = document.createElement("span");
        nowBars.appendChild(sp);
        barNodes.push(sp);
      }
      setInterval(function () {
        var maxH = 14;
        for (var i = 0; i < barNodes.length; i++) {
          var h = nowPlaying
            ? (3 + Math.floor(Math.random() * maxH))
            : (3 + (i % 3));
          barNodes[i].style.height = h + "px";
        }
      }, 110);

      function updateNowPlaying(np) {
        if (!np) np = {};
        var title = np.title || "";
        var artist = np.artist || "";
        nowPlaying = !!np.playing && !!title;
        document.getElementById("nowTitle").textContent = title || "-- NO SIGNAL --";
        document.getElementById("nowArtist").textContent = artist || "";
        var label = np.app_label || np.app || "";
        if (label) {
          nowApp.textContent = label;
          nowApp.className = "media-app on";
        } else {
          nowApp.textContent = "";
          nowApp.className = "media-app";
        }
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
        paintIdleChrome();
        if (radioPlaying) {
          try { syncRadioNowPlaying(); } catch (eR) {}
        }
      }

      function syncAudioUI(audio) {
        if (!audio || !audio.scenes) return;
        var hp = audio.scenes.headphones || {};
        var bt = audio.scenes.bluetooth || audio.scenes.speakers || {};
        var hpBtn = document.getElementById("sceneHp");
        var spBtn = document.getElementById("sceneSp");
        document.getElementById("sceneHpSub").textContent = hp.available ? (hp.name || "Headphones") : "—";
        document.getElementById("sceneSpSub").textContent = bt.available ? (bt.name || "Bluetooth") : "offline";
        var kind = audio.default_kind || "";
        if (kind === "speakers") kind = "bluetooth";
        hpBtn.className = "scene-btn" + (hp.available ? "" : " off") +
          (kind === "headphones" ? " on" : "");
        spBtn.className = "scene-btn" + (bt.available ? "" : " off") +
          (kind === "bluetooth" ? " on" : "");
      }

      var tickerSig = "";
      var tickerOffset = 0;
      var tickerHalf = 0;
      var tickerTimer = null;

      function escHtml(s) {
        return String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function tickScroll() {
        var track = document.getElementById("tickerTrack");
        if (!track) return;
        if (tickerHalf < 20) {
          tickerHalf = Math.floor(track.offsetWidth / 2);
          if (tickerHalf < 20) return;
        }
        tickerOffset -= 1;
        if (-tickerOffset >= tickerHalf) tickerOffset = 0;
        var shift = "translateX(" + tickerOffset + "px)";
        track.style.webkitTransform = shift;
        track.style.transform = shift;
        var idleTrack = document.getElementById("idleTickerTrack");
        if (idleTrack) {
          idleTrack.style.webkitTransform = shift;
          idleTrack.style.transform = shift;
        }
      }

      function startTickerScroll() {
        if (tickerTimer) return;
        tickerTimer = setInterval(tickScroll, 28);
      }

      function renderTicker(ticker) {
        if (!ticker || !ticker.items || !ticker.items.length) return;
        var parts = [];
        for (var i = 0; i < ticker.items.length; i++) {
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
        if (sig === tickerSig) {
          startTickerScroll();
          return;
        }
        tickerSig = sig;
        var html = parts.join('<span class="sep"> · </span>');
        var doubled = html + '<span class="sep"> · </span>' + html;
        var track = document.getElementById("tickerTrack");
        track.innerHTML = doubled;
        var idleTrack = document.getElementById("idleTickerTrack");
        if (idleTrack) idleTrack.innerHTML = doubled;
        tickerOffset = 0;
        tickerHalf = 0;
        track.style.webkitTransform = "translateX(0)";
        track.style.transform = "translateX(0)";
        setTimeout(function () {
          tickerHalf = Math.floor(track.offsetWidth / 2);
          startTickerScroll();
        }, 50);
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
        paintIdleChrome();
      }

      function hubIsQuiet() {
        return (new Date()).getTime() < hubQuietUntil;
      }

      function markHubDown() {
        failCount++;
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
        return wasQuiet;
      }

      function refreshStatus() {
        if (GC && GC.isMixedContentHub()) {
          setMeta("<b>Pages · Solo</b><br>DECK = открыть LAN hub");
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
            var s = JSON.parse(xhr.responseText);
            var disk = s.disk_free_gb != null ? s.disk_free_gb + " GB free" : "?";
            var ip = (s.ips && s.ips[0]) ? s.ips[0] : "—";
            var shortHost = (s.hostname || "").replace(/^DESKTOP-/, "");
            setMeta(
              "<b>" + shortHost + "</b><br>" +
              disk + "<br>" +
              ip
            );
            if (typeof s.volume === "number") syncVolumeUI(s.volume, s.muted);
            if (typeof s.muted === "boolean") isMuted = s.muted;
            if (s.now_playing) updateNowPlaying(s.now_playing);
            if (s.audio) syncAudioUI(s.audio);
          } catch (e) {
            setMeta("ошибка статуса");
          }
        };
        xhr.onerror = function () { markHubDown(); };
        xhr.ontimeout = function () { markHubDown(); };
        try { xhr.send(null); } catch (e) { markHubDown(); }
      }

      function heartbeat() {
        if (GC && GC.isMixedContentHub()) {
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
        /* Hard deadline so old iPad never stays on «загрузка…» forever */
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
        var el = document.getElementById("soloClock");
        if (el) el.textContent = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
        var dateEl = document.getElementById("soloDate");
        if (dateEl) {
          var days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
          dateEl.textContent = days[d.getDay()] + " · " + pad2(d.getDate()) + "." + pad2(d.getMonth() + 1);
        }
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
        inp.value = pad2(a.hh || 0) + ":" + pad2(a.mm || 0);
        btn.textContent = a.enabled ? "On" : "Off";
        btn.className = a.enabled ? "solo-toggle on" : "solo-toggle";
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
              g.gain.value = 0.45;
              o.connect(g);
              g.connect(alarmCtx.destination);
              o.start(0);
              if (g.gain.exponentialRampToValueAtTime) {
                g.gain.setValueAtTime(0.45, alarmCtx.currentTime);
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
        var oscOk = false;
        try { oscOk = startAlarmOscPulse(); } catch (e0) { oscOk = false; }
        /* Always try WAV too — old iPad speakers need a real file at full volume */
        try {
          ensureAlarmAudio();
          alarmAudio.volume = 1;
          alarmAudio.muted = false;
          var p = alarmAudio.play();
          if (p && typeof p.then === "function") {
            p.catch(function () {});
          }
        } catch (e) {}
        if (!oscOk) toast("ALARM");
        else toast("ALARM");
        if (idleEl.className === "on") {
          bumpIdle(null, { dismiss: true });
        }
      }

      function stopAlarmTone() {
        try {
          if (alarmAudio) {
            alarmAudio.pause();
            alarmAudio.currentTime = 0;
          }
        } catch (e) {}
        stopAlarmOscPulse();
        /* keep alarmFiredKey so it does not re-ring the same minute */
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
        /* exact minute, or catch-up within 2 min if JS slept past it */
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
        /* enabling after today's time → wait until tomorrow */
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
        var dock = document.getElementById("radioDock");
        if (!el) {
          el = document.createElement("audio");
          el.id = "radioNative";
          if (dock) dock.appendChild(el);
          else document.body.appendChild(el);
        } else if (dock && el.parentNode !== dock) {
          dock.appendChild(el);
        }
        el.setAttribute("playsinline", "true");
        el.setAttribute("webkit-playsinline", "true");
        el.setAttribute("controls", "controls");
        el.preload = "none";
        /* Stay in the radio dock — never float a 1px/full-width bar over the header */
        try { el.style.setProperty("display", "block", "important"); } catch (eD) { el.style.display = "block"; }
        el.style.position = "static";
        el.style.left = "auto";
        el.style.top = "auto";
        el.style.width = "100%";
        el.style.height = "36px";
        el.style.opacity = "1";
        el.style.margin = "6px 0 0";
        try { el.volume = 1; } catch (eV) {}
        radioAudioEl = el;
        radioAudio = el;
        return el;
      }

      function syncRadioNowPlaying() {
        if (!GC) return;
        var st = GC.stationById(GC.getRadioId());
        document.getElementById("nowTitle").textContent = st.name;
        document.getElementById("nowArtist").textContent = radioPlaying ? "Radio · live" : "Radio · ready";
        nowApp.className = "media-app on";
        nowApp.textContent = "RADIO";
        nowArt.className = "now-art";
        nowArt.removeAttribute("src");
        paintIdleChrome();
        var playBtn = document.getElementById("radioPlayBtn");
        if (playBtn) playBtn.textContent = radioPlaying ? "Stop" : "Play";
        if (GC.publishRadioNow) {
          GC.publishRadioNow({
            playing: radioPlaying,
            id: st.id,
            name: st.name,
            t: new Date().getTime()
          });
        }
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
              if (radioPlaying) playRadio();
              else syncRadioNowPlaying();
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
        var el = ensureRadioAudio();
        var gen = ++radioPlayGen;
        el.onerror = null;
        try { el.pause(); } catch (e0) {}
        el.src = url;
        el.onerror = function () {
          if (gen !== radioPlayGen) return;
          radioTryIdx++;
          if (radioTryIdx < radioTryList.length) {
            toast("radio retry…");
            playRadioUrl(radioTryList[radioTryIdx]);
          } else {
            radioPlaying = false;
            syncRadioUI();
            toast("radio fail");
          }
        };
        var p = null;
        try { p = el.play(); } catch (e2) { p = null; }
        if (p && typeof p.then === "function") {
          p.then(function () {
            if (gen !== radioPlayGen) return;
            radioPlaying = true;
            syncRadioUI();
            toast("radio · on");
          }).catch(function () {
            if (gen !== radioPlayGen) return;
            radioTryIdx++;
            if (radioTryIdx < radioTryList.length) playRadioUrl(radioTryList[radioTryIdx]);
            else {
              radioPlaying = false;
              syncRadioUI();
              toast("radio fail");
            }
          });
        } else {
          radioPlaying = true;
          syncRadioUI();
          toast("radio · on");
        }
      }

      function playRadio() {
        if (!GC) return;
        var st = GC.stationById(GC.getRadioId());
        radioTryList = [];
        if (st.url) radioTryList.push(st.url);
        /* Same station, other codec only — never a different station. */
        if (st.url2 && st.url2 !== st.url) radioTryList.push(st.url2);
        if (!radioTryList.length) {
          radioPlaying = false;
          syncRadioUI();
          toast("radio fail");
          return;
        }
        radioTryIdx = 0;
        playRadioUrl(radioTryList[0]);
      }

      function stopRadio() {
        try {
          var el = ensureRadioAudio();
          el.pause();
          el.removeAttribute("src");
          while (el.firstChild) el.removeChild(el.firstChild);
          try { el.load(); } catch (e2) {}
        } catch (e) {}
        radioPlaying = false;
        syncRadioUI();
        toast("radio stop");
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
          bumpIdle();
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
          bumpIdle();
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
        volValueEl.textContent = v + "%";
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
          bumpIdle();
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

      document.getElementById("sceneHp").onclick = function () { sendAudioScene("headphones"); };
      document.getElementById("sceneSp").onclick = function () { sendAudioScene("bluetooth"); };

      document.getElementById("alarmToggle").onclick = function () {
        if (!GC) return;
        var a = GC.getAlarm();
        var parts = (document.getElementById("alarmTime").value || "07:00").split(":");
        a.hh = parseInt(parts[0], 10) || 0;
        a.mm = parseInt(parts[1], 10) || 0;
        a.enabled = !a.enabled;
        GC.setAlarm(a);
        if (a.enabled) {
          unlockAlarmAudio(); /* iOS: unlock sound on this tap */
          armAlarmForToday();
          toast("alarm on");
        } else {
          stopAlarmTone();
          toast("alarm off");
        }
        syncAlarmUI();
      };
      document.getElementById("alarmStop").onclick = function () {
        stopAlarmTone();
        toast("alarm stop");
      };
      document.getElementById("alarmTime").onchange = function () {
        if (!GC) return;
        var a = GC.getAlarm();
        var parts = (document.getElementById("alarmTime").value || "07:00").split(":");
        a.hh = parseInt(parts[0], 10) || 0;
        a.mm = parseInt(parts[1], 10) || 0;
        GC.setAlarm(a);
        if (a.enabled) armAlarmForToday();
        syncAlarmUI();
      };

      var actionBtns = document.querySelectorAll("button.pad, #mediaControlsDeck button.media-btn");
      for (var i = 0; i < actionBtns.length; i++) {
        (function (btn) {
          btn.onclick = function () { doAction(btn.getAttribute("data-action")); };
        })(actionBtns[i]);
      }

      document.getElementById("radioPlayBtn").onclick = toggleRadio;
      document.getElementById("radioPrevBtn").onclick = function () { stepRadio(-1); };
      document.getElementById("radioNextBtn").onclick = function () { stepRadio(1); };

      var themePills = document.querySelectorAll(".theme-pill");
      for (var j = 0; j < themePills.length; j++) {
        (function (pill) {
          pill.onclick = function () {
            applyTheme(pill.getAttribute("data-theme"), true);
            toast("тема " + pill.getAttribute("data-theme"));
            bumpIdle();
          };
        })(themePills[j]);
      }

      document.body.addEventListener("touchstart", function (e) { bumpIdle(e); }, false);
      document.body.addEventListener("mousedown", function (e) { bumpIdle(e); }, false);
      document.getElementById("idleCatch").addEventListener("touchstart", function (e) {
        e.preventDefault();
        bumpIdle(e, { dismiss: true });
      }, false);
      document.getElementById("idleCatch").addEventListener("mousedown", function (e) {
        bumpIdle(e, { dismiss: true });
      }, false);

      buildSceneList();
      applyTheme(readTheme(), false);
      hideChrome();
      bumpIdle();
      startIdleWatch();
      /* Preload screensaver once so Cinema is instant on iPad */
      setTimeout(function () {
        if (idleEl.className !== "on") loadIdleFrame(false);
      }, 2500);
      initRadioUI();
      syncAlarmUI();
      armAlarmForToday();
      tickClock();
      setInterval(tickClock, 1000);
      refreshLivingClient();
      setInterval(refreshLivingClient, 30000);
      setTimeout(refreshLivingClient, 3000);
      setTimeout(refreshLivingClient, 10000);
      if (!hubHeld) {
        heartbeat();
        refreshStatus();
      } else {
        setMode("solo", { auto: true });
        setMeta("<b>standalone</b><br>ПК был выключен · DECK когда включишь");
      }
      setInterval(heartbeat, 8000);
      setInterval(refreshStatus, 8000);
    })();
