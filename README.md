# Kissaten Gadget / iPad Deck

Гибрид: планшет — constantly-on гаджет; Windows-ПК — Stream Deck API.

## Режимы

| Режим | Когда | Что видно |
|--------|--------|-----------|
| **STANDALONE** | хаб не отвечает | заставка, погода, тревога, лента, часы, будильник, радио |
| **DECK** | `http://<PC>:8787` online | звук, bluetooth/headphones, apps, lock, now playing |

Переключение автоматическое (heartbeat `/api/ping` каждые 1.5с).

## Запуск хаба (Windows)

```bat
start.bat
```

или `python server.py` → порт **8787**.

На iPad в той же Wi‑Fi (пока пользуетесь LAN):

`http://192.168.x.x:8787/?v=30`

**Поделиться → На экран «Домой»** (URL обязательно с `?v=…`).

## Холодный старт без ПК (GitHub Pages)

1. В GitHub: Settings → Pages → Source = **GitHub Actions**.
2. Запушьте репо — workflow `.github/workflows/pages.yml` выложит папку `static/`.
3. На iPad откройте `https://ivanvinitskiy23-dev.github.io/ipad-deck/?v=30` → на Home Screen.
4. MENU → вставьте URL хаба, например `http://192.168.0.247:8787` → **Save hub URL**.
5. Чтобы войти в **DECK** с Pages: MENU → **DECK** — страница откроет LAN-хаб  
   (браузер **блокирует** HTTPS→HTTP XHR / mixed content; поэтому с Pages нельзя «тихо» пинговать хаб).

Пока ПК выкл — Solo на Pages. Когда ПК включится — жми **DECK** (или открой LAN URL напрямую).

## Что на клиенте / что на ПК

- **Планшет (JS):** погода (Open-Meteo), тревога (alerts.com.ua), новости (RSS через CORS proxy), радио, будильник, night-drive.
- **Windows hub:** volume / mute / audio scenes / lock / Cursor·Chrome·Telegram·Discord / SMTC media.

Будильник и радио работают только пока Web App открыт на экране (лимит iOS 9).

## Файлы

- `server.py` — slim PC hub
- `static/index.html` — основная оболочка
- `static/night-drive.html` — заставка
- `static/gadget-core.js` — hub base + living data + radio/alarm helpers
