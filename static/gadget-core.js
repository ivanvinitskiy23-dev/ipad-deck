/**
 * Shared ES5 client for Hybrid Gadget ↔ Stream Deck (iOS 9 Safari).
 * - Hub API base (LAN) via localStorage
 * - Living data: weather / air alert / news (internet, not PC)
 */
(function (global) {
  var HUB_KEY = "kissaten_hub_base";
  var LIVING_CACHE_KEY = "kissaten_living_cache";
  var ALARM_KEY = "kissaten_alarm";
  var RADIO_KEY = "kissaten_radio";

  var WMO_RU = {
    0: "ясно", 1: "почти ясно", 2: "переменная облачность", 3: "облачно",
    45: "туман", 48: "туман", 51: "морось", 53: "морось", 55: "морось",
    61: "дождь", 63: "дождь", 65: "сильный дождь",
    71: "снег", 73: "снег", 75: "сильный снег",
    80: "ливень", 81: "ливень", 82: "ливень",
    95: "гроза", 96: "гроза", 99: "гроза"
  };

  /* Legacy alerts.com.ua oblast ids (fallback only) */
  var ALERT_STATE_IDS = { 25: 1, 9: 1 };

  var NEWS_FEEDS = [
    { source: "УП", url: "https://www.pravda.com.ua/rus/rss/" },
    { source: "BBC", url: "https://feeds.bbci.co.uk/russian/rss.xml" },
    { source: "DW", url: "https://rss.dw.com/xml/rss-ru-news" },
    { source: "Meduza", url: "https://meduza.io/rss/all" }
  ];

  var BLOCK_HOST = [
    ".ru", "tass.", "ria.ru", "rbc.ru", "lenta.ru", "rt.com", "sputnik",
    "iz.ru", "gazeta.ru", "kommersant.ru", "vedomosti.ru", "aif.ru", "mk.ru"
  ];

  /* HTTPS MP3/AAC that start with a real frame (no ICY metadata block). Each URL is a different mount. */
  var RADIO_STATIONS = [
    { id: "chillout", name: "0n Chillout", url: "https://0n-chillout.radionetz.de/0n-chillout.mp3" },
    { id: "jazz", name: "0n Jazz", url: "https://0n-jazz.radionetz.de/0n-jazz.mp3" },
    { id: "dance", name: "I Love Dance", url: "https://streams.ilovemusic.de/iloveradio2.mp3" },
    { id: "hiphop", name: "I Love Hip Hop", url: "https://streams.ilovemusic.de/iloveradio3.mp3" },
    { id: "rock", name: "I Love Rock", url: "https://streams.ilovemusic.de/iloveradio4.mp3" },
    { id: "lofi", name: "Lofi Radio", url: "https://play.streamafrica.net/lofiradio" },
    { id: "rp", name: "Radio Paradise", url: "https://stream.radioparadise.com/mp3-128", url2: "https://stream.radioparadise.com/aac-128" }
  ];

  /* Retired ids → closest current station. Dead SomaFM ice ids used to all become chillout. */
  var RADIO_ID_ALIAS = {
    fluid: "chillout", groove: "chillout", gsclassic: "chillout", drone: "chillout",
    space: "chillout", beat: "chillout", cliqhop: "chillout", lush: "chillout", soma: "chillout",
    lounge: "chillout", asp: "chillout",
    smooth: "jazz", smoothuk: "jazz",
    ilove2: "dance",
    ilove3: "hiphop",
    chillhop: "lofi", zenolofi: "lofi"
  };

  function trimSlash(s) {
    return String(s || "").replace(/\/+$/, "");
  }

  function isLikelyHubOrigin() {
    var h = location.hostname || "";
    if (h === "localhost" || h === "127.0.0.1") return true;
    if (/^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (String(location.port) === "8787" || String(location.port) === "8080") return true;
    return false;
  }

  function getHubBase() {
    try {
      var b = localStorage.getItem(HUB_KEY);
      if (b) return trimSlash(b);
    } catch (e) {}
    if (isLikelyHubOrigin()) return "";
    return "";
  }

  function setHubBase(url) {
    var u = trimSlash(url || "");
    try {
      if (u) localStorage.setItem(HUB_KEY, u);
      else localStorage.removeItem(HUB_KEY);
    } catch (e) {}
  }

  function apiUrl(path) {
    var base = getHubBase();
    if (!path) path = "/";
    if (path.charAt(0) !== "/") path = "/" + path;
    return base + path;
  }

  /** HTTPS shell + HTTP LAN hub → browser blocks XHR (mixed content). */
  function isMixedContentHub() {
    var base = getHubBase();
    if (!base) return false;
    if (location.protocol !== "https:") return false;
    return /^http:\/\//i.test(base);
  }

  function hostBlocked(url) {
    var u = String(url || "").toLowerCase();
    for (var i = 0; i < BLOCK_HOST.length; i++) {
      if (u.indexOf(BLOCK_HOST[i]) !== -1) return true;
    }
    return false;
  }

  function cleanText(s, limit) {
    s = String(s || "");
    s = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    limit = limit || 110;
    if (s.length > limit) s = s.substring(0, limit - 1) + "…";
    return s;
  }

  function nowSec() {
    return Math.floor((new Date()).getTime() / 1000);
  }

  function xhrGet(url, timeout, onOk, onFail) {
    var xhr = new XMLHttpRequest();
    var settled = false;
    function ok(txt) {
      if (settled) return;
      settled = true;
      if (onOk) onOk(txt, xhr);
    }
    function fail() {
      if (settled) return;
      settled = true;
      if (onFail) onFail(xhr);
    }
    xhr.open("GET", url, true);
    xhr.timeout = timeout || 8000;
    try { xhr.setRequestHeader("Accept", "application/json,text/plain,*/*"); } catch (eH) {}
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) ok(xhr.responseText);
      else fail();
    };
    xhr.onerror = fail;
    xhr.ontimeout = fail;
    try { xhr.send(null); } catch (e) { fail(); }
    return xhr;
  }

  function corsProxy(url) {
    return "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
  }

  function corsProxyGet(url) {
    return "https://api.allorigins.win/get?url=" + encodeURIComponent(url);
  }

  function parseAllOriginsGet(txt) {
    try {
      var data = JSON.parse(txt);
      if (data && typeof data.contents === "string") return data.contents;
    } catch (e) {}
    return null;
  }

  function rss2jsonUrl(feedUrl) {
    return "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feedUrl);
  }

  function weatherObj(tempI, label, windI) {
    var short = "Киев " + tempI + "° · " + label;
    return {
      ok: true,
      city: "Киев",
      temp_c: tempI,
      label: label,
      wind_kmh: windI,
      text: short,
      text_full: windI == null ? short : (short + " · ветер " + windI + " км/ч"),
      updated: nowSec()
    };
  }

  function parseOpenMeteo(txt) {
    try {
      var data = JSON.parse(txt);
      var cur = data.current || data.current_weather || {};
      var temp = cur.temperature_2m != null ? cur.temperature_2m : cur.temperature;
      if (temp == null) return null;
      var code = parseInt(cur.weather_code != null ? cur.weather_code : cur.weathercode, 10) || 0;
      var label = WMO_RU[code] || "погода";
      var tempI = Math.round(Number(temp));
      var windI = null;
      if (cur.wind_speed_10m != null) windI = Math.round(Number(cur.wind_speed_10m));
      else if (cur.windspeed != null) windI = Math.round(Number(cur.windspeed));
      return weatherObj(tempI, label, windI);
    } catch (e) {
      return null;
    }
  }

  function parseWttr(txt) {
    try {
      var data = JSON.parse(txt);
      var cur = (data.current_condition && data.current_condition[0]) || null;
      if (!cur || cur.temp_C == null) return null;
      var desc = "";
      if (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value) {
        desc = String(cur.weatherDesc[0].value).toLowerCase();
      }
      var map = {
        "clear": "ясно", "sunny": "ясно", "partly cloudy": "переменная облачность",
        "cloudy": "облачно", "overcast": "облачно", "mist": "туман", "fog": "туман",
        "light rain": "дождь", "rain": "дождь", "heavy rain": "сильный дождь",
        "light snow": "снег", "snow": "снег", "thunderstorm": "гроза"
      };
      var label = map[desc] || desc || "погода";
      var windI = cur.windspeedKmph != null ? Math.round(Number(cur.windspeedKmph)) : null;
      return weatherObj(Math.round(Number(cur.temp_C)), label, windI);
    } catch (e) {
      return null;
    }
  }

  function fetchWeather(cb) {
    var finished = false;
    function done(w) {
      if (finished) return;
      finished = true;
      cb(w);
    }

    var meteoOld =
      "https://api.open-meteo.com/v1/forecast?latitude=50.45&longitude=30.52&current_weather=true";
    var meteoNew =
      "https://api.open-meteo.com/v1/forecast?latitude=50.4501&longitude=30.5234" +
      "&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto";
    var wttr = "https://wttr.in/Kyiv?format=j1";

    function tryProxyGet(url, parser, next) {
      xhrGet(corsProxyGet(url), 12000, function (txt) {
        var body = parseAllOriginsGet(txt);
        var w = body ? parser(body) : null;
        if (w) { done(w); return; }
        if (next) next();
        else done(null);
      }, function () {
        if (next) next();
        else done(null);
      });
    }

    function tryProxyRaw(url, parser, next) {
      xhrGet(corsProxy(url), 12000, function (txt) {
        var w = parser(txt);
        if (w) { done(w); return; }
        if (next) next();
        else done(null);
      }, function () {
        if (next) next();
        else done(null);
      });
    }

    function tryProxied() {
      tryProxyRaw(meteoOld, parseOpenMeteo, function () {
        tryProxyGet(meteoOld, parseOpenMeteo, function () {
          tryProxyRaw(wttr, parseWttr, function () {
            tryProxyGet(wttr, parseWttr, function () { done(null); });
          });
        });
      });
    }

    function tryWttr() {
      xhrGet(wttr, 10000, function (txt) {
        var w = parseWttr(txt);
        if (w) { done(w); return; }
        tryProxied();
      }, function () { tryProxied(); });
    }

    function tryNew() {
      xhrGet(meteoNew, 8000, function (txt) {
        var w = parseOpenMeteo(txt);
        if (w) { done(w); return; }
        tryWttr();
      }, function () { tryWttr(); });
    }

    xhrGet(meteoOld, 8000, function (txt) {
      var w = parseOpenMeteo(txt);
      if (w) { done(w); return; }
      tryNew();
    }, function () { tryNew(); });
  }

  function emptyAlert() {
    return {
      ok: false, alert: false, label: "НЕТ ДАННЫХ", place: "Киев",
      places: [], changed: "", updated: nowSec()
    };
  }

  function isKyivName(s) {
    s = String(s || "").toLowerCase();
    return s.indexOf("київ") !== -1 || s.indexOf("киев") !== -1 || s.indexOf("kyiv") !== -1;
  }

  function parseNeptunAlert(txt) {
    try {
      var data = JSON.parse(txt);
      var active = [];
      var changed = data.updatedAt || "";
      var oblasts = data.oblasts || [];
      var raions = data.raions || [];
      var i, o, r, name;
      for (i = 0; i < oblasts.length; i++) {
        o = oblasts[i];
        if (!o) continue;
        name = o.name || o.oblast || o.key || "";
        if (isKyivName(name) || isKyivName(o.key) || isKyivName(o.oblast)) {
          active.push(name || "Киев");
        }
      }
      for (i = 0; i < raions.length; i++) {
        r = raions[i];
        if (!r) continue;
        if (isKyivName(r.oblast) || isKyivName(r.name)) {
          /* city-level: prefer м. Київ from oblasts; skip oblast raions unless city */
          if (isKyivName(r.name) && String(r.name).toLowerCase().indexOf("област") === -1) {
            /* district names aren't the city itself */
          }
        }
      }
      /* Also flag Київська область districts as soft context in place string if city alert */
      var isAlert = active.length > 0;
      var place = isAlert ? active.join(" · ") : "Киев";
      var level = "";
      for (i = 0; i < oblasts.length; i++) {
        o = oblasts[i];
        if (o && isKyivName(o.name || o.key) && o.level) {
          level = o.level;
          break;
        }
      }
      return {
        ok: true,
        alert: isAlert,
        label: isAlert ? (level === "red" ? "ТРЕВОГА" : "ТРЕВОГА") : "ОТБОЙ",
        place: place,
        places: active,
        changed: changed,
        level: level,
        source: "NEPTUN",
        updated: nowSec()
      };
    } catch (e) {
      return emptyAlert();
    }
  }

  function parseAlertPayload(txt) {
    try {
      var data = JSON.parse(txt);
      if (data && (data.oblasts || data.raions)) return parseNeptunAlert(txt);
      var states = data.states || [];
      var byId = {};
      for (var i = 0; i < states.length; i++) {
        var s = states[i];
        if (s && s.id != null) byId[parseInt(s.id, 10)] = s;
      }
      var active = [];
      var changed = "";
      for (var id in ALERT_STATE_IDS) {
        if (!ALERT_STATE_IDS.hasOwnProperty(id)) continue;
        var st = byId[parseInt(id, 10)];
        if (!st) continue;
        if (st.alert) {
          active.push((st.name || st.name_en || id).replace(/^\s+|\s+$/g, ""));
        }
        var ch = st.changed || "";
        if (ch && (!changed || ch > changed)) changed = ch;
      }
      var isAlert = active.length > 0;
      return {
        ok: true,
        alert: isAlert,
        label: isAlert ? "ТРЕВОГА" : "ОТБОЙ",
        place: isAlert ? active.join(" · ") : "Киев",
        places: active,
        changed: changed,
        updated: nowSec()
      };
    } catch (e) {
      return emptyAlert();
    }
  }

  function fetchAlert(cb) {
    var finished = false;
    function done(r) {
      if (finished) return;
      finished = true;
      cb(r);
    }
    /* NEPTUN: CORS * — works from GitHub Pages. alerts.com.ua has no CORS. */
    var neptun = "https://neptun.in.ua/api/v1/alerts";
    xhrGet(neptun, 8000, function (txt) {
      var r = parseNeptunAlert(txt);
      if (r.ok) { done(r); return; }
      xhrGet(corsProxy("https://alerts.com.ua/api/states"), 8000, function (txt2) {
        done(parseAlertPayload(txt2));
      }, function () { done(emptyAlert()); });
    }, function () {
      xhrGet(corsProxy("https://alerts.com.ua/api/states"), 8000, function (txt2) {
        done(parseAlertPayload(txt2));
      }, function () { done(emptyAlert()); });
    });
  }

  function parseRssTitles(xml, source, limit) {
    var out = [];
    limit = limit || 3;
    if (!xml) return out;
    try {
      var doc = new DOMParser().parseFromString(xml, "text/xml");
      var items = doc.getElementsByTagName("item");
      if (!items || !items.length) {
        items = doc.getElementsByTagName("entry");
        for (var e = 0; e < items.length && out.length < limit; e++) {
          var entry = items[e];
          var titleEl = entry.getElementsByTagName("title")[0];
          var link = "";
          var linkEl = entry.getElementsByTagName("link")[0];
          if (linkEl) link = linkEl.getAttribute("href") || (linkEl.textContent || "");
          var title = cleanText(titleEl ? (titleEl.textContent || "") : "");
          if (!title || hostBlocked(link)) continue;
          out.push({ kind: "news", source: source, text: source + ": " + title });
        }
        return out;
      }
      for (var i = 0; i < items.length && out.length < limit; i++) {
        var item = items[i];
        var tEl = item.getElementsByTagName("title")[0];
        var lEl = item.getElementsByTagName("link")[0];
        var link2 = lEl ? ((lEl.textContent || "").replace(/^\s+|\s+$/g, "")) : "";
        if (hostBlocked(link2)) continue;
        var title2 = cleanText(tEl ? (tEl.textContent || "") : "");
        if (!title2) continue;
        out.push({ kind: "news", source: source, text: source + ": " + title2 });
      }
    } catch (err) {}
    return out;
  }

  function parseRss2Json(txt, source, limit) {
    var out = [];
    limit = limit || 3;
    try {
      var data = JSON.parse(txt);
      if (!data || data.status !== "ok" || !data.items) return out;
      for (var i = 0; i < data.items.length && out.length < limit; i++) {
        var it = data.items[i];
        var link = it.link || "";
        if (hostBlocked(link)) continue;
        var title = cleanText(it.title || "");
        if (!title) continue;
        out.push({ kind: "news", source: source, text: source + ": " + title });
      }
    } catch (e) {}
    return out;
  }

  function fetchOneFeed(feed, cb) {
    if (hostBlocked(feed.url)) { cb([]); return; }
    xhrGet(rss2jsonUrl(feed.url), 12000, function (txt) {
      var items = parseRss2Json(txt, feed.source, 3);
      if (items.length) { cb(items); return; }
      xhrGet(corsProxy(feed.url), 10000, function (xml) {
        cb(parseRssTitles(xml, feed.source, 3));
      }, function () { cb([]); });
    }, function () {
      xhrGet(corsProxy(feed.url), 10000, function (xml) {
        cb(parseRssTitles(xml, feed.source, 3));
      }, function () { cb([]); });
    });
  }

  function fetchNews(cb) {
    var all = [];
    var left = NEWS_FEEDS.length;
    if (!left) { cb({ ok: true, items: [], updated: nowSec() }); return; }
    for (var i = 0; i < NEWS_FEEDS.length; i++) {
      (function (feed) {
        fetchOneFeed(feed, function (items) {
          for (var j = 0; j < items.length; j++) all.push(items[j]);
          left--;
          if (left <= 0) {
            var seen = {};
            var unique = [];
            for (var k = 0; k < all.length; k++) {
              var key = all[k].text;
              if (seen[key]) continue;
              seen[key] = 1;
              unique.push(all[k]);
              if (unique.length >= 18) break;
            }
            cb({ ok: true, items: unique, updated: nowSec() });
          }
        });
      })(NEWS_FEEDS[i]);
    }
  }

  function readLivingCache() {
    try {
      var raw = localStorage.getItem(LIVING_CACHE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.weather) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function writeLivingCache(bundle) {
    try { localStorage.setItem(LIVING_CACHE_KEY, JSON.stringify(bundle)); } catch (e) {}
  }

  function fetchLivingBundle(cb) {
    var weather = null;
    var alert = null;
    var weatherDone = false;
    var alertDone = false;
    var sent = false;
    function maybeSend() {
      if (sent || !weatherDone || !alertDone) return;
      sent = true;
      var cached = readLivingCache();
      if ((!weather || weather.temp_c == null) && cached && cached.weather) weather = cached.weather;
      if ((!alert || !alert.ok) && cached && cached.alert && cached.alert.ok) alert = cached.alert;
      if (!alert) alert = emptyAlert();
      var bundle = { ok: true, weather: weather, alert: alert };
      if (weather && weather.temp_c != null) writeLivingCache(bundle);
      try { cb(bundle); } catch (eCb) {}
    }
    fetchWeather(function (w) {
      if (weatherDone) return;
      weatherDone = true;
      weather = w;
      maybeSend();
    });
    fetchAlert(function (a) {
      if (alertDone) return;
      alertDone = true;
      alert = a;
      maybeSend();
    });
    /* Old iPad / slow proxies: never block UI forever waiting on either call */
    setTimeout(function () {
      if (!weatherDone) {
        weatherDone = true;
        weather = null;
      }
      if (!alertDone) {
        alertDone = true;
        alert = emptyAlert();
      }
      maybeSend();
    }, 10000);
  }

  function getAlarm() {
    try {
      var raw = localStorage.getItem(ALARM_KEY);
      if (!raw) return { enabled: false, hh: 7, mm: 0 };
      return JSON.parse(raw);
    } catch (e) {
      return { enabled: false, hh: 7, mm: 0 };
    }
  }

  function setAlarm(cfg) {
    try { localStorage.setItem(ALARM_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  var RADIO_NOW_KEY = "kissaten_radio_now";

  function publishRadioNow(state) {
    try {
      localStorage.setItem(RADIO_NOW_KEY, JSON.stringify(state || { playing: false }));
    } catch (e) {}
  }

  function readRadioNow() {
    try {
      var raw = localStorage.getItem(RADIO_NOW_KEY);
      if (!raw) return { playing: false };
      return JSON.parse(raw);
    } catch (e) {
      return { playing: false };
    }
  }

  function canonicalRadioId(id) {
    if (!id) return RADIO_STATIONS[0].id;
    if (RADIO_ID_ALIAS[id]) id = RADIO_ID_ALIAS[id];
    for (var i = 0; i < RADIO_STATIONS.length; i++) {
      if (RADIO_STATIONS[i].id === id) return id;
    }
    return RADIO_STATIONS[0].id;
  }

  function getRadioId() {
    try {
      var id = canonicalRadioId(localStorage.getItem(RADIO_KEY) || "chillout");
      try { localStorage.setItem(RADIO_KEY, id); } catch (e2) {}
      return id;
    } catch (e) { return RADIO_STATIONS[0].id; }
  }

  function setRadioId(id) {
    try { localStorage.setItem(RADIO_KEY, id); } catch (e) {}
  }

  function stationById(id) {
    for (var i = 0; i < RADIO_STATIONS.length; i++) {
      if (RADIO_STATIONS[i].id === id) return RADIO_STATIONS[i];
    }
    return RADIO_STATIONS[0];
  }

  function stationIndex(id) {
    for (var i = 0; i < RADIO_STATIONS.length; i++) {
      if (RADIO_STATIONS[i].id === id) return i;
    }
    return 0;
  }

  function nextStationId(id, delta) {
    var i = stationIndex(id) + (delta || 1);
    var n = RADIO_STATIONS.length;
    i = ((i % n) + n) % n;
    return RADIO_STATIONS[i].id;
  }

  /* ===== Power outages (Kyiv · Yasno primary + DTEK backup) ===== */
  var POWER_KEY = "kissaten_power_cfg";
  var POWER_CACHE_KEY = "kissaten_power_cache_v2";
  var POWER_SCHED_KEY = "kissaten_power_sched_v1";
  var DEFAULT_POWER = {
    city: "Київ",
    street: "вул. Здолбунівська",
    house: "11б",
    houseDtek: "11/Б",
    group: "45.1",
    regionId: "25",
    dsoId: "902",
    warnMin: 15
  };

  function getPowerCfg() {
    var cfg = {};
    var k;
    for (k in DEFAULT_POWER) {
      if (DEFAULT_POWER.hasOwnProperty(k)) cfg[k] = DEFAULT_POWER[k];
    }
    try {
      var raw = localStorage.getItem(POWER_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === "object") {
          for (k in o) {
            if (o.hasOwnProperty(k) && o[k] != null && o[k] !== "") cfg[k] = o[k];
          }
        }
      }
    } catch (e) {}
    return cfg;
  }

  function setPowerCfg(partial) {
    var cfg = getPowerCfg();
    var k;
    if (partial) {
      for (k in partial) {
        if (partial.hasOwnProperty(k)) cfg[k] = partial[k];
      }
    }
    try { localStorage.setItem(POWER_KEY, JSON.stringify(cfg)); } catch (e) {}
    return cfg;
  }

  function pad2p(n) {
    n = n | 0;
    return (n < 10 ? "0" : "") + n;
  }

  function minsToHHMM(mins) {
    mins = mins | 0;
    if (mins < 0) mins = 0;
    if (mins > 24 * 60) mins = 24 * 60;
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return pad2p(h) + ":" + pad2p(m);
  }

  function nowMinsKyiv() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function emptyPower() {
    return {
      ok: false,
      level: "unknown",
      label: "НЕМАЄ ДАНИХ",
      sub: "Kyiv · POWER",
      group: getPowerCfg().group,
      emergency: false,
      offNow: false,
      soon: false,
      nextOff: "",
      nextOn: "",
      restore: "",
      reason: "",
      source: "",
      slots: [],
      todaySched: null,
      tomorrowSched: null,
      updated: nowSec()
    };
  }

  function dayKeyFromIso(iso) {
    if (!iso) return "";
    var s = String(iso);
    var m = s.match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : s.slice(0, 10);
  }

  function kyivDayKey(offsetDays) {
    var d = new Date((new Date()).getTime() + (offsetDays || 0) * 86400000);
    return d.getFullYear() + "-" + pad2p(d.getMonth() + 1) + "-" + pad2p(d.getDate());
  }

  function slotsToOffRanges(slots) {
    var offRanges = [];
    var i, s, start, end, typ;
    slots = slots || [];
    for (i = 0; i < slots.length; i++) {
      s = slots[i] || {};
      start = (s.start | 0);
      end = (s.end | 0);
      typ = String(s.type || "");
      if (typ !== "NotPlanned" && end > start) {
        offRanges.push({ start: start, end: end, label: minsToHHMM(start) + "–" + minsToHHMM(end) });
      }
    }
    return offRanges;
  }

  function emptyDaySched(which) {
    return {
      which: which || "today",
      date: "",
      status: "",
      emergency: false,
      live: false,
      slots: [],
      labels: [],
      text: "ще не сформовано"
    };
  }

  function parseYasnoDay(dayObj, which) {
    var out = emptyDaySched(which);
    dayObj = dayObj || {};
    out.date = dayKeyFromIso(dayObj.date) || "";
    out.status = String(dayObj.status || "");
    out.emergency = out.status === "EmergencyShutdowns";
    out.slots = slotsToOffRanges(dayObj.slots || []);
    out.labels = [];
    var i;
    for (i = 0; i < out.slots.length; i++) out.labels.push(out.slots[i].label);
    if (out.emergency && !out.labels.length) {
      out.live = true;
      out.text = "графік не діє";
    } else if (out.labels.length) {
      out.live = true;
      out.text = out.labels.slice(0, 3).join(" · ");
    } else if (out.status) {
      out.live = true;
      out.text = "без відключень";
    } else {
      out.live = false;
      out.text = "ще не сформовано";
    }
    return out;
  }

  function readScheduleStore() {
    try {
      var raw = localStorage.getItem(POWER_SCHED_KEY);
      if (!raw) return { group: getPowerCfg().group, days: {} };
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return { group: getPowerCfg().group, days: {} };
      if (!o.days || typeof o.days !== "object") o.days = {};
      return o;
    } catch (e) {
      return { group: getPowerCfg().group, days: {} };
    }
  }

  function writeScheduleStore(store) {
    try { localStorage.setItem(POWER_SCHED_KEY, JSON.stringify(store)); } catch (e) {}
  }

  function saveLiveDayToStore(day, group) {
    if (!day || !day.date || !day.live) return;
    /* Only persist usable hourly graphs — not emergency-empty days. */
    if (day.emergency && !day.labels.length) return;
    if (!day.labels.length && day.text === "ще не сформовано") return;
    var store = readScheduleStore();
    store.group = group || getPowerCfg().group;
    store.days[day.date] = {
      date: day.date,
      labels: day.labels.slice(0),
      text: day.text,
      status: day.status,
      savedAt: nowSec()
    };
    /* Keep ~10 days max */
    var keys = [];
    var k;
    for (k in store.days) {
      if (store.days.hasOwnProperty(k)) keys.push(k);
    }
    keys.sort();
    while (keys.length > 10) {
      delete store.days[keys[0]];
      keys.shift();
    }
    writeScheduleStore(store);
  }

  function resolveDaySched(liveDay, which) {
    var out = liveDay || emptyDaySched(which);
    var wantDate = out.date || kyivDayKey(which === "tomorrow" ? 1 : 0);
    if (out.live && out.labels.length) {
      out.cached = false;
      return out;
    }
    if (out.live && !out.emergency && out.text === "без відключень") {
      out.cached = false;
      return out;
    }
    var store = readScheduleStore();
    var hit = store.days && store.days[wantDate];
    if (hit && hit.labels && hit.labels.length) {
      return {
        which: which,
        date: wantDate,
        status: hit.status || "",
        emergency: false,
        live: false,
        cached: true,
        slots: [],
        labels: hit.labels.slice(0),
        text: hit.labels.slice(0, 3).join(" · ")
      };
    }
    if (out.emergency) {
      out.date = wantDate;
      out.cached = false;
      out.text = "ще не сформовано";
      out.labels = [];
      return out;
    }
    out.date = wantDate;
    out.cached = false;
    if (!out.text) out.text = "ще не сформовано";
    return out;
  }

  function applyScheduleSide(out, todayLive, tomorrowLive) {
    if (todayLive && todayLive.live) saveLiveDayToStore(todayLive, out.group);
    if (tomorrowLive && tomorrowLive.live) saveLiveDayToStore(tomorrowLive, out.group);
    out.todaySched = resolveDaySched(todayLive, "today");
    out.tomorrowSched = resolveDaySched(tomorrowLive, "tomorrow");
    if ((!out.slots || !out.slots.length) && out.todaySched && out.todaySched.labels && out.todaySched.labels.length) {
      out.slots = [];
      var i;
      for (i = 0; i < out.todaySched.labels.length; i++) {
        out.slots.push({ label: out.todaySched.labels[i] });
      }
    }
  }

  function parseYasnoGroup(data, group) {
    var out = emptyPower();
    out.source = "Yasno";
    out.group = group;
    if (!data || !data[group]) return out;
    var g = data[group];
    var todayLive = parseYasnoDay(g.today, "today");
    var tomorrowLive = parseYasnoDay(g.tomorrow, "tomorrow");
    out.ok = true;
    out.updated = nowSec();

    if (todayLive.emergency) {
      /* Schedules void — light may still be on at the address. */
      out.emergency = true;
      out.offNow = false;
      out.level = "emergency";
      out.label = "ЕКСТРЕНІ";
      out.sub = "графіки не діють · " + group;
      applyScheduleSide(out, todayLive, tomorrowLive);
      return out;
    }

    var offRanges = todayLive.slots || [];
    out.slots = offRanges;
    var half = [];
    var i, j, s, start, end, typ, on;
    var rawSlots = (g.today && g.today.slots) || [];
    for (i = 0; i < 48; i++) half[i] = true;
    for (i = 0; i < rawSlots.length; i++) {
      s = rawSlots[i] || {};
      start = (s.start | 0);
      end = (s.end | 0);
      typ = String(s.type || "");
      on = (typ === "NotPlanned");
      var a = Math.floor(start / 30);
      var b = Math.ceil(end / 30);
      for (j = a; j < b && j < 48; j++) half[j] = on;
    }
    var nowM = nowMinsKyiv();
    var idx = Math.floor(nowM / 30);
    if (idx > 47) idx = 47;
    out.offNow = !half[idx];
    var nextOff = -1;
    var nextOn = -1;
    if (out.offNow) {
      for (i = idx; i < 48; i++) {
        if (half[i]) { nextOn = i * 30; break; }
      }
    } else {
      for (i = idx + 1; i < 48; i++) {
        if (!half[i]) { nextOff = i * 30; break; }
      }
      for (i = 0; i < offRanges.length; i++) {
        if (offRanges[i].start > nowM) {
          if (nextOff < 0 || offRanges[i].start < nextOff) nextOff = offRanges[i].start;
        }
        if (out.offNow && offRanges[i].start <= nowM && offRanges[i].end > nowM) {
          nextOn = offRanges[i].end;
        }
      }
    }
    if (nextOff >= 0) out.nextOff = minsToHHMM(nextOff);
    if (nextOn >= 0) out.nextOn = minsToHHMM(nextOn);
    var warn = (getPowerCfg().warnMin | 0) || 15;
    out.soon = (!out.offNow && nextOff >= 0 && (nextOff - nowM) <= warn && (nextOff - nowM) >= 0);
    if (out.offNow) {
      out.level = "off";
      out.label = "НЕМАЄ СВІТЛА";
      out.sub = (out.nextOn ? ("до " + out.nextOn) : "за графіком") + " · " + group;
    } else if (out.soon) {
      out.level = "soon";
      out.label = "СКОРО";
      out.sub = (out.nextOff ? ("з " + out.nextOff) : "скоро") + " · " + group;
    } else {
      out.level = "on";
      out.label = "СВІТЛО Є";
      out.sub = (out.nextOff ? ("далі " + out.nextOff) : "без слотів") + " · " + group;
    }
    applyScheduleSide(out, todayLive, tomorrowLive);
    return out;
  }

  function fetchYasnoPower(cb) {
    var cfg = getPowerCfg();
    var url = "https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/" +
      cfg.regionId + "/dsos/" + cfg.dsoId + "/planned-outages";
    function done(data) {
      cb(parseYasnoGroup(data, cfg.group));
    }
    xhrGet(url, 10000, function (txt) {
      try { done(JSON.parse(txt)); } catch (e) { done(null); }
    }, function () {
      xhrGet(corsProxy(url), 12000, function (txt) {
        try { done(JSON.parse(txt)); } catch (e2) { done(null); }
      }, function () {
        xhrGet(corsProxyGet(url), 12000, function (txt) {
          var body = parseAllOriginsGet(txt);
          try { done(body ? JSON.parse(body) : null); } catch (e3) {
            try { done(typeof body === "object" ? body : null); } catch (e4) { done(null); }
          }
        }, function () { done(null); });
      });
    });
  }

  function parseDtekPower(data) {
    var out = emptyPower();
    out.source = "DTEK";
    if (!data || !data.ok) return out;
    out.ok = true;
    out.group = data.group || getPowerCfg().group;
    out.updated = nowSec();
    if (data.emergency || data.current_off) {
      out.offNow = !!data.current_off || !!data.emergency;
      out.emergency = !!data.emergency || !!data.current_off;
      out.reason = data.reason || "";
      out.restore = data.restore || "";
      if (out.offNow) {
        out.level = data.emergency ? "emergency" : "off";
        out.label = data.emergency ? "ЕКСТРЕНІ" : "НЕМАЄ СВІТЛА";
        out.sub = (out.restore ? ("до " + out.restore) : (out.reason || "DTEK")) +
          (out.group ? (" · " + out.group) : "");
      }
    }
    if (data.slots && data.slots.length) out.slots = data.slots;
    if (data.nextOff) out.nextOff = data.nextOff;
    if (data.nextOn) out.nextOn = data.nextOn;
    return out;
  }

  function fetchDtekPower(cb) {
    /* Prefer LAN hub proxy (bypasses browser CORS / WAF quirks). */
    var hubUrl = "";
    try {
      if (!isMixedContentHub()) hubUrl = apiUrl("/api/power/dtek");
    } catch (e0) {}
    function fail() {
      cb(parseDtekPower({ ok: false }));
    }
    if (hubUrl) {
      xhrGet(hubUrl, 12000, function (txt) {
        try { cb(parseDtekPower(JSON.parse(txt))); } catch (e) { fail(); }
      }, fail);
      return;
    }
    fail();
  }

  function mergePower(yasno, dtek) {
    var y = yasno || emptyPower();
    var d = dtek || emptyPower();
    var m = emptyPower();
    m.ok = !!(y.ok || d.ok);
    m.group = y.group || d.group || getPowerCfg().group;
    /* Yasno primary for schedule; DTEK overlays live emergency/outage */
    m.slots = (y.slots && y.slots.length) ? y.slots : (d.slots || []);
    m.nextOff = y.nextOff || d.nextOff || "";
    m.nextOn = y.nextOn || d.nextOn || "";
    m.emergency = !!(y.emergency || d.emergency);
    /* DTEK confirms live outage; Yasno EmergencyShutdowns alone ≠ lights off. */
    m.offNow = !!(d.offNow || (y.offNow && !y.emergency));
    m.soon = !!(!m.offNow && !m.emergency && (y.soon || d.soon));
    m.reason = d.reason || y.reason || "";
    m.restore = d.restore || y.restore || "";
    m.source = (y.ok && d.ok) ? "Yasno+DTEK" : (y.ok ? "Yasno" : (d.ok ? "DTEK" : ""));
    m.updated = nowSec();
    m.todaySched = y.todaySched || resolveDaySched(null, "today");
    m.tomorrowSched = y.tomorrowSched || resolveDaySched(null, "tomorrow");
    if (m.offNow && m.emergency) {
      m.level = "emergency";
      m.label = "ЕКСТРЕНІ";
      m.sub = (m.restore ? ("до " + m.restore) : (m.reason || "немає світла")) +
        (m.group ? (" · " + m.group) : "");
    } else if (m.offNow) {
      m.level = "off";
      m.label = "НЕМАЄ СВІТЛА";
      m.sub = (m.nextOn ? ("до " + m.nextOn) : (m.restore ? ("до " + m.restore) : "за графіком")) +
        (m.group ? (" · " + m.group) : "");
    } else if (m.emergency) {
      m.level = "emergency";
      m.label = "ЕКСТРЕНІ";
      m.sub = (m.reason || "графіки не діють") + (m.group ? (" · " + m.group) : "");
    } else if (m.soon) {
      m.level = "soon";
      m.label = "СКОРО";
      m.sub = (m.nextOff ? ("з " + m.nextOff) : "скоро") + (m.group ? (" · " + m.group) : "");
    } else if (m.ok) {
      m.level = "on";
      m.label = "СВІТЛО Є";
      m.sub = (m.nextOff ? ("далі " + m.nextOff) : "без слотів") + (m.group ? (" · " + m.group) : "");
    } else {
      m.level = "unknown";
      m.label = "НЕМАЄ ДАНИХ";
      m.sub = "Kyiv · POWER";
    }
    return m;
  }

  function readPowerCache() {
    try {
      var raw = localStorage.getItem(POWER_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writePowerCache(bundle) {
    try { localStorage.setItem(POWER_CACHE_KEY, JSON.stringify(bundle)); } catch (e) {}
  }

  function fetchPowerBundle(cb) {
    var yDone = false;
    var dDone = false;
    var y = null;
    var d = null;
    var sent = false;
    function maybe() {
      if (sent || !yDone || !dDone) return;
      sent = true;
      var merged = mergePower(y, d);
      if (merged.ok) writePowerCache(merged);
      else {
        var cached = readPowerCache();
        if (cached && cached.ok) merged = cached;
      }
      try { cb(merged); } catch (e) {}
    }
    fetchYasnoPower(function (r) { yDone = true; y = r; maybe(); });
    fetchDtekPower(function (r) { dDone = true; d = r; maybe(); });
    setTimeout(function () {
      if (!yDone) { yDone = true; y = emptyPower(); }
      if (!dDone) { dDone = true; d = emptyPower(); }
      maybe();
    }, 12000);
  }

  global.GadgetCore = {
    HUB_KEY: HUB_KEY,
    getHubBase: getHubBase,
    setHubBase: setHubBase,
    apiUrl: apiUrl,
    isLikelyHubOrigin: isLikelyHubOrigin,
    isMixedContentHub: isMixedContentHub,
    xhrGet: xhrGet,
    fetchWeather: fetchWeather,
    fetchAlert: fetchAlert,
    fetchNews: fetchNews,
    fetchLivingBundle: fetchLivingBundle,
    readLivingCache: readLivingCache,
    getAlarm: getAlarm,
    setAlarm: setAlarm,
    getRadioId: getRadioId,
    setRadioId: setRadioId,
    stationById: stationById,
    stationIndex: stationIndex,
    nextStationId: nextStationId,
    publishRadioNow: publishRadioNow,
    readRadioNow: readRadioNow,
    RADIO_NOW_KEY: RADIO_NOW_KEY,
    RADIO_STATIONS: RADIO_STATIONS,
    getPowerCfg: getPowerCfg,
    setPowerCfg: setPowerCfg,
    fetchPowerBundle: fetchPowerBundle,
    readPowerCache: readPowerCache
  };
})(this);
