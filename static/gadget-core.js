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

  var RADIO_STATIONS = [
    { id: "soma", name: "SomaFM Groove", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
    { id: "fip", name: "FIP", url: "https://icecast.radiofrance.fr/fip-midfi.mp3" },
    { id: "npr", name: "NPR", url: "https://npr-ice.streamguys1.com/live.mp3" }
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

  function fetchWeather(cb) {
    var url =
      "https://api.open-meteo.com/v1/forecast" +
      "?latitude=50.4501&longitude=30.5234" +
      "&current=temperature_2m,weather_code,wind_speed_10m" +
      "&timezone=Europe%2FKyiv";
    xhrGet(url, 7000, function (txt) {
      try {
        var data = JSON.parse(txt);
        var cur = data.current || {};
        var temp = cur.temperature_2m;
        if (temp == null) { cb(null); return; }
        var code = parseInt(cur.weather_code, 10) || 0;
        var label = WMO_RU[code] || "погода";
        var tempI = Math.round(Number(temp));
        var windI = null;
        if (cur.wind_speed_10m != null) windI = Math.round(Number(cur.wind_speed_10m));
        var short = "Киев " + tempI + "° · " + label;
        cb({
          ok: true,
          city: "Киев",
          temp_c: tempI,
          label: label,
          wind_kmh: windI,
          text: short,
          text_full: windI == null ? short : (short + " · ветер " + windI + " км/ч"),
          updated: Math.floor(Date.now() / 1000)
        });
      } catch (e) { cb(null); }
    }, function () { cb(null); });
  }

  function parseAlertPayload(txt) {
    var empty = {
      ok: false, alert: false, label: "НЕТ ДАННЫХ", place: "Киев",
      places: [], changed: "", updated: Math.floor(Date.now() / 1000)
    };
    try {
      var data = JSON.parse(txt);
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
      return empty;
    }
  }

  function fetchAlert(cb) {
    var direct = "https://alerts.com.ua/api/states";
    xhrGet(direct, 6000, function (txt) {
      var r = parseAlertPayload(txt);
      if (r.ok) { cb(r); return; }
      xhrGet(corsProxy(direct), 8000, function (txt2) {
        cb(parseAlertPayload(txt2));
      }, function () { cb(parseAlertPayload("")); });
    }, function () {
      xhrGet(corsProxy(direct), 8000, function (txt2) {
        cb(parseAlertPayload(txt2));
      }, function () { cb(parseAlertPayload("")); });
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

  function fetchOneFeed(feed, cb) {
    if (hostBlocked(feed.url)) { cb([]); return; }
    xhrGet(corsProxy(feed.url), 10000, function (txt) {
      cb(parseRssTitles(txt, feed.source, 3));
    }, function () { cb([]); });
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

  function getRadioId() {
    try { return localStorage.getItem(RADIO_KEY) || "soma"; } catch (e) { return "soma"; }
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

  global.GadgetCore = {
    HUB_KEY: HUB_KEY,
    getHubBase: getHubBase,
    setHubBase: setHubBase,
    apiUrl: apiUrl,
    isLikelyHubOrigin: isLikelyHubOrigin,
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
    RADIO_STATIONS: RADIO_STATIONS
  };
})(this);
