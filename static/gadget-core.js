/**
 * Shared ES5 client for Hybrid Gadget ↔ Stream Deck (iOS 9 Safari).
 * - Hub API base (LAN) via localStorage
 * - Living data: weather / air alert / news (internet, not PC)
 */
(function (global) {
  var HUB_KEY = "kissaten_hub_base";
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

  /* HTTPS MP3 streams, commercial-free / chill vibe (iOS-friendly) */
  var RADIO_STATIONS = [
    { id: "fluid", name: "SomaFM Fluid · chill hop", url: "https://ice5.somafm.com/fluid-128-mp3", url2: "https://ice6.somafm.com/fluid-128-mp3" },
    { id: "groove", name: "SomaFM Groove Salad", url: "https://ice5.somafm.com/groovesalad-128-mp3", url2: "https://ice6.somafm.com/groovesalad-128-mp3" },
    { id: "gsclassic", name: "SomaFM Groove Classic", url: "https://ice5.somafm.com/gsclassic-128-mp3", url2: "https://ice6.somafm.com/gsclassic-128-mp3" },
    { id: "drone", name: "SomaFM Drone Zone", url: "https://ice5.somafm.com/dronezone-128-mp3", url2: "https://ice6.somafm.com/dronezone-128-mp3" },
    { id: "space", name: "SomaFM Deep Space One", url: "https://ice5.somafm.com/deepspaceone-128-mp3", url2: "https://ice6.somafm.com/deepspaceone-128-mp3" },
    { id: "beat", name: "SomaFM Beat Blender", url: "https://ice5.somafm.com/beatblender-128-mp3", url2: "https://ice6.somafm.com/beatblender-128-mp3" },
    { id: "cliqhop", name: "SomaFM cliqhop", url: "https://ice5.somafm.com/cliqhop-128-mp3", url2: "https://ice2.somafm.com/cliqhop-128-mp3" },
    { id: "lush", name: "SomaFM Lush", url: "https://ice5.somafm.com/lush-128-mp3", url2: "https://ice6.somafm.com/lush-128-mp3" },
    { id: "asp", name: "Ambient Sleeping Pill", url: "https://radio.stereoscenic.com/asp-h" },
    { id: "chillhop", name: "I Love Chillhop", url: "https://streams.ilovemusic.de/iloveradio17.mp3" },
    { id: "lofi", name: "Lofi Radio", url: "https://play.streamafrica.net/lofiradio" },
    { id: "rp", name: "Radio Paradise", url: "https://stream.radioparadise.com/mp3-128" }
  ];

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

  function xhrGet(url, timeout, onOk, onFail) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.timeout = timeout || 8000;
    try { xhr.setRequestHeader("Accept", "application/json,text/plain,*/*"); } catch (eH) {}
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onOk) onOk(xhr.responseText, xhr);
      } else if (onFail) onFail(xhr);
    };
    xhr.onerror = function () { if (onFail) onFail(xhr); };
    xhr.ontimeout = function () { if (onFail) onFail(xhr); };
    try { xhr.send(null); } catch (e) { if (onFail) onFail(xhr); }
    return xhr;
  }

  function corsProxy(url) {
    return "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
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
      updated: Math.floor(Date.now() / 1000)
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
    var meteoOld =
      "https://api.open-meteo.com/v1/forecast?latitude=50.45&longitude=30.52&current_weather=true";
    var meteoNew =
      "https://api.open-meteo.com/v1/forecast?latitude=50.4501&longitude=30.5234" +
      "&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto";
    var wttr = "https://wttr.in/Kyiv?format=j1";
    var wttrSimple = "https://wttr.in/Kyiv?format=j1&lang=en";

    function tryWttrSimple() {
      xhrGet(wttrSimple, 10000, function (txt) {
        cb(parseWttr(txt));
      }, function () { cb(null); });
    }

    function tryWttr() {
      xhrGet(wttr, 10000, function (txt) {
        var w = parseWttr(txt);
        if (w) { cb(w); return; }
        tryWttrSimple();
      }, function () { tryWttrSimple(); });
    }

    function tryNew() {
      xhrGet(meteoNew, 8000, function (txt) {
        var w = parseOpenMeteo(txt);
        if (w) { cb(w); return; }
        tryWttr();
      }, function () { tryWttr(); });
    }

    /* Prefer short URL first — more reliable on old Safari */
    xhrGet(meteoOld, 8000, function (txt) {
      var w = parseOpenMeteo(txt);
      if (w) { cb(w); return; }
      tryNew();
    }, function () { tryNew(); });
  }

  function emptyAlert() {
    return {
      ok: false, alert: false, label: "НЕТ ДАННЫХ", place: "Киев",
      places: [], changed: "", updated: Math.floor(Date.now() / 1000)
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
        updated: Math.floor(Date.now() / 1000)
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
        updated: Math.floor(Date.now() / 1000)
      };
    } catch (e) {
      return emptyAlert();
    }
  }

  function fetchAlert(cb) {
    /* NEPTUN: CORS * — works from GitHub Pages. alerts.com.ua has no CORS. */
    var neptun = "https://neptun.in.ua/api/v1/alerts";
    xhrGet(neptun, 8000, function (txt) {
      var r = parseNeptunAlert(txt);
      if (r.ok) { cb(r); return; }
      xhrGet(corsProxy("https://alerts.com.ua/api/states"), 8000, function (txt2) {
        cb(parseAlertPayload(txt2));
      }, function () { cb(emptyAlert()); });
    }, function () {
      xhrGet(corsProxy("https://alerts.com.ua/api/states"), 8000, function (txt2) {
        cb(parseAlertPayload(txt2));
      }, function () { cb(emptyAlert()); });
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
    if (!left) { cb({ ok: true, items: [], updated: Math.floor(Date.now() / 1000) }); return; }
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
            cb({ ok: true, items: unique, updated: Math.floor(Date.now() / 1000) });
          }
        });
      })(NEWS_FEEDS[i]);
    }
  }

  function fetchLivingBundle(cb) {
    var weather = null;
    var alert = null;
    var done = 0;
    function finish() {
      done++;
      if (done < 2) return;
      cb({ ok: true, weather: weather, alert: alert });
    }
    fetchWeather(function (w) { weather = w; finish(); });
    fetchAlert(function (a) { alert = a; finish(); });
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

  function getRadioId() {
    try { return localStorage.getItem(RADIO_KEY) || "fluid"; } catch (e) { return "fluid"; }
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
    RADIO_STATIONS: RADIO_STATIONS
  };
})(this);
