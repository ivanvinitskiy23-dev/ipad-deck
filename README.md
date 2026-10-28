# Textmode Deck / iPad Hub

Гибрид: планшет — constantly-on textmode-гаджет; Windows-ПК — Stream Deck API.  
Визуальный стиль: CRT / phosphor / monospace (в духе textmode.art).

## Режимы

| Режим | Когда | Что видно |
|--------|--------|-----------|
| **STANDALONE** | хаб не отвечает | заставка, погода, POWER, тревога, лента, часы / pomo / markets, будильник, радио, Music TV / CS LIVE |
| **DECK** | `http://<PC>:8787` online | звук, per-app mixer + CLUTCH, bluetooth/headphones, apps, lock, now playing, vitals |

Переключение: MENU → DECK / STANDALONE (heartbeat `/api/ping` + long-poll `/api/events` в DECK).

## Палитры

| Theme | Look |
|--------|------|
| **PHOSPHOR** (B) | зелёный phosphor CRT |
| **CRT** (C) | cyan + magenta overlay |
| **AMBER** (D) | янтарный terminal |
| **CASIO** (E) | paper LCD / F-91W |

## Запуск хаба (Windows)

```bat
start.bat
```

или `python server.py` → порт **8787**.

На iPad в той же Wi‑Fi:

`http://192.168.x.x:8787/?v=93`

**Поделиться → На экран «Домой»** (URL обязательно с `?v=…`).

## Холодный старт без ПК (GitHub Pages)

1. В GitHub: Settings → Pages → Source = **GitHub Actions**.
2. Запушьте репо — workflow `.github/workflows/pages.yml` выложит папку `static/`.
3. На iPad откройте `https://ivanvinitskiy23-dev.github.io/ipad-deck/?v=93` → на Home Screen.
4. MENU → вставьте URL хаба, например `http://192.168.0.247:8787` → **Save hub URL**.
5. Чтобы войти в **DECK** с Pages: MENU → **DECK** — страница откроет LAN-хаб  
   (браузер **блокирует** HTTPS→HTTP XHR / mixed content; поэтому с Pages нельзя «тихо» пинговать хаб).

Пока ПК выкл — Solo на Pages. Когда ПК включится — жми **DECK** (или открой LAN URL напрямую).

## Что на клиенте / что на ПК

- **Планшет (JS):** погода, POWER (Yasno + DTEK + ASCII-шкала суток), тревога, лента, радио, будильник, Cinema (AUTO/CAFÉ/RAIN/DRIVE/CORE), Nightwire CLOCK↔POMODORO↔MARKETS.
- **Windows hub:** volume / mute / scenes / **app mixer + CLUTCH** / lock / apps / SMTC / long-poll `/api/events` / CS LIVE proxy / POWER proxies / PC vitals + sparklines (NVML/psutil; LHM only if you start it yourself).
- **Twitch:** native GQL resolve + `tools/crypto_shim` so Smart App Control can’t block pycryptodome `.pyd`.

Будильник и радио работают только пока Web App открыт на экране (лимит iOS).

## Файлы

- `server.py` — PC hub
- `static/index.html` — shell
- `static/deck.css` — UI
- `static/deck-app.js` — режимы, idle, radio/TV, POWER, hub
- `static/gadget-core.js` — hub base + living/POWER + radio/alarm/markets
- `tools/build_cinema_gifs.py` — генерация cinema GIF
- `tools/crypto_shim/` — Crypto API на cryptography (Windows)
