# Textmode Deck / iPad Hub

Гибрид: планшет — constantly-on textmode-гаджет; Windows-ПК — Stream Deck API.  
Визуальный стиль: CRT / phosphor / monospace (в духе textmode.art).

## Режимы

| Режим | Когда | Что видно |
|--------|--------|-----------|
| **STANDALONE** | хаб не отвечает | заставка, погода, POWER, тревога, лента, часы, будильник, радио |
| **DECK** | `http://<PC>:8787` online | звук, bluetooth/headphones, apps, lock, now playing |

Переключение: MENU → DECK / STANDALONE (heartbeat `/api/ping` в DECK).

## Палитры

| Theme | Look |
|--------|------|
| **PHOSPHOR** (B) | зелёный phosphor CRT |
| **CRT** (C) | cyan + magenta overlay |
| **AMBER** (D) | янтарный terminal |

## Запуск хаба (Windows)

```bat
start.bat
```

или `python server.py` → порт **8787**.

На iPad в той же Wi‑Fi:

`http://192.168.x.x:8787/?v=81`

**Поделиться → На экран «Домой»** (URL обязательно с `?v=…`).

## Холодный старт без ПК (GitHub Pages)

1. В GitHub: Settings → Pages → Source = **GitHub Actions**.
2. Запушьте репо — workflow `.github/workflows/pages.yml` выложит папку `static/`.
3. На iPad откройте `https://ivanvinitskiy23-dev.github.io/ipad-deck/?v=81` → на Home Screen.
4. MENU → вставьте URL хаба, например `http://192.168.0.247:8787` → **Save hub URL**.
5. Чтобы войти в **DECK** с Pages: MENU → **DECK** — страница откроет LAN-хаб  
   (браузер **блокирует** HTTPS→HTTP XHR / mixed content; поэтому с Pages нельзя «тихо» пинговать хаб).

Пока ПК выкл — Solo на Pages. Когда ПК включится — жми **DECK** (или открой LAN URL напрямую).

## Что на клиенте / что на ПК

- **Планшет (JS):** погода (Open-Meteo), POWER (Yasno + DTEK, flip-карточка, экстренные), тревога (alerts.com.ua), новости (RSS), радио, будильник, одна Cinema-заставка (YUM cafe).
- **Windows hub:** volume / mute / audio scenes / lock / apps / SMTC media / proxy `/api/power/dtek` + `/api/power/yasno/planned` / PC vitals in titlebar (GPU/RAM via NVIDIA/psutil; LHM only if you start it yourself).

Будильник и радио работают только пока Web App открыт на экране (лимит iOS).

## Файлы

- `server.py` — slim PC hub
- `static/index.html` — shell (CRT frame / textmode UI)
- `static/deck.css` — полный UI с нуля
- `static/deck-app.js` — клиентская логика (режимы, idle, radio, POWER, hub)
- `static/gadget-core.js` — hub base + living/POWER + radio/alarm helpers
- `static/night-drive.html` — legacy idle page
