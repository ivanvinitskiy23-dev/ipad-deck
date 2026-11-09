# Qwiqly Deck // Hardware Panel (v100)

Гибридный пульт управления ПК и автономный настольный прибор для **iPad 2** (iOS 9 Safari, горизонтальная ориентация `1024×768`).
Единый индустриальный дизайн **Hardware Panel** в духе приборов **Teenage Engineering / Braun**: матовый графитовый корпус, тактильные клавиши, сигнальный оранжевый акцент (`#ff5500`) и лёгкие аппаратные анимации на `transform`/`opacity` без нагрузки на GPU Apple A5.

## Режимы работы

| Режим | Когда активен | Функции |
|---|---|---|
| **DECK** (`QWIQLY // DECK`) | ПК включён (`http://<PC>:8787`) | Мастер-громкость + Mute, переключение выходов `HP`/`BT`, быстрый запуск игр и приложений (`Telegram`, `Discord`, `Chrome`, `Steam`, `FACEIT`, `FACEIT+`, `CS2`, `PUBG`), системные макросы (`Cursor`, `Flush DNS`, `Recycle`, `Lock PC`, `Sleep PC`), Now Playing с обложкой из Windows SMTC, телеметрия ПК (`CPU`, `GPU`, `RAM`, диски, сеть) |
| **STANDALONE** (`NIGHTWIRE // SOLO`) | ПК выключен или выбран вручную | Крупные настольные часы + дата, FM/интернет-радио, будильник (`Web Audio` + `alarm-beep.wav`), видеоплеер **Music TV** (Rock / Rap / Pop) + **CS LIVE** (прямые трансляции Twitch/Kick через хаб) |

Постоянно на экране в обоих режимах (**INFO**):
- **WX · KYIV** — актуальная погода в Киеве (Open-Meteo / wttr.in)
- **ALERT** — статус воздушной тревоги в Киеве
- **POWER · GRID** — 3-гранная карточка отключений света (`Статус` ↔ `Сьогодні` ↔ `Завтра`) с данными Yasno + ДТЕК и 24-часовой шкалой суток (`█` свет есть / `▒` полчаса / `░` отключение)
- **TICKER** — бегущая строка новостей (RSS)

Переключение режимов: кнопка **SYS** → **DECK** / **STANDALONE** (автоматический переход через `/api/ping` и мгновенные обновления через long-polling `/api/events`).

## Запуск хаба на Windows

```bat
start.bat
```

или напрямую:

```powershell
python server.py
```

Сервер слушает порт **8787**.

На iPad в локальной Wi‑Fi сети открой:

`http://192.168.0.247:8787/?v=103`

Нажми **Поделиться → На экран «Домой»**, чтобы запускать пульт в полноэкранном режиме без адресной строки Safari.

## Холодный старт без ПК (GitHub Pages)

1. В настройках репозитория GitHub: **Settings → Pages → Source = GitHub Actions** (workflow `.github/workflows/pages.yml` публикует каталог `static/`).
2. На iPad открой `https://ivanvinitskiy23-dev.github.io/ipad-deck/?v=103` и добавь ярлык на экран «Домой».
3. Нажми **SYS** → укажи адрес домашнего ПК (`http://192.168.0.247:8787`) → **Save Hub URL**.
4. Пока ПК выключен — планшет работает в режиме **STANDALONE** (часы, радио, ТВ, погода, свет, тревога). Когда включишь ПК — нажми **SYS → DECK** для перехода на LAN-хаб.

## Структура проекта

- `server.py` — HTTP-сервер Windows-хаба (SMTC, pycaw, AudioConfig, виталсы CPU/GPU/RAM/LAN, прокси Yasno/DTEK и Twitch/Kick HLS)
- `static/index.html` — разметка интерфейса Hardware Panel (`v100`)
- `static/deck.css` — единая таблица стилей аппаратной панели (`v100`)
- `static/deck-app.js` — клиентская логика (strict ES5 для iOS 9 Safari)
- `static/gadget-core.js` — ядро автономных сервисов (погода, тревога, графики света, радио, каналы ТВ, кэш)
- `tools/crypto_shim/` — обёртка Crypto API поверх `cryptography` для совместимости со Smart App Control в Windows
