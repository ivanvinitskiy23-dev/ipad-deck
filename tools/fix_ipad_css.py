# -*- coding: utf-8 -*-
"""Make Textmode Deck CSS safe for old iPad Safari (pre-iOS 14.5)."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
css_path = root / "static" / "deck.css"
html_path = root / "static" / "index.html"
js_path = root / "static" / "deck-app.js"

css = css_path.read_text(encoding="utf-8")

# 1) inset → top/right/bottom/left (critical: iOS < 14.5 ignores inset)
css = css.replace("position: fixed; inset: 0; z-index: 80;",
                  "position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 80;")
css = css.replace("position: absolute; inset: 0; overflow: auto;",
                  "position: absolute; top: 0; right: 0; bottom: 0; left: 0; width: 100%; height: 100%; overflow: auto;")
css = css.replace("position: fixed; inset: 0; z-index: 200;",
                  "position: fixed; top: 0; right: 0; bottom: 0; left: 0; width: 100%; height: 100%; z-index: 200;")
css = css.replace("position: absolute; inset: 0; background:",
                  "position: absolute; top: 0; right: 0; bottom: 0; left: 0; background:")
css = css.replace("position: fixed; inset: 0; width: 100%; height: 100%;",
                  "position: fixed; top: 0; right: 0; bottom: 0; left: 0; width: 100%; height: 100%;")
css = css.replace("position: absolute; inset: 0; z-index: 5;",
                  "position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 5;")

if "inset:" in css:
    raise SystemExit("leftover inset: " + ", ".join(
        line.strip() for line in css.splitlines() if "inset:" in line
    ))

# 2) modern gradient stop syntax → old WebKit-safe
css = css.replace(
    "repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0,0,0,.18) 2px 3px)",
    "repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,.18) 2px, rgba(0,0,0,.18) 3px)"
)

# 3) hard fallbacks so themes still work if CSS variables fail
fallback = """
/* Hard theme colors — old Safari fallback if var() ignored */
body, body.theme-C { background: #04060c; color: #d0e8f8; }
body.theme-B { background: #020804; color: #b0f0c0; }
body.theme-D { background: #080604; color: #f0e0a8; }
body.theme-B .menu-chip, body.theme-B .media-btn, body.theme-B .side-brand,
body.theme-B .solo-clock, body.theme-B .vol-value, body.theme-B .theme-pill.on,
body.theme-B .radio-chip.on, body.theme-B .mode-pill.on, body.theme-B .drawer-title,
body.theme-B .crt-titlebar, body.theme-B .toast { color: #39ff14; border-color: #163a24; }
body.theme-C .menu-chip, body.theme-C .media-btn, body.theme-C .side-brand,
body.theme-C .solo-clock, body.theme-C .vol-value, body.theme-C .theme-pill.on,
body.theme-C .radio-chip.on, body.theme-C .mode-pill.on, body.theme-C .drawer-title,
body.theme-C .crt-titlebar, body.theme-C .toast { color: #00e5ff; border-color: #203048; }
body.theme-D .menu-chip, body.theme-D .media-btn, body.theme-D .side-brand,
body.theme-D .solo-clock, body.theme-D .vol-value, body.theme-D .theme-pill.on,
body.theme-D .radio-chip.on, body.theme-D .mode-pill.on, body.theme-D .drawer-title,
body.theme-D .crt-titlebar, body.theme-D .toast { color: #ffb000; border-color: #3a2e18; }
"""
if "Hard theme colors" not in css:
    css = css.replace("body.theme-D {\n  --bg: #080604;", fallback + "\nbody.theme-D {\n  --bg: #080604;")

# 4) tablet: hide heavy ascii, shrink chrome, force full-width stack
tablet_extra = """
@media screen and (max-width: 1280px) {
  .ascii-banner { display: none !important; }
  .crt-frame { margin: 6px 6px 0; }
  .crt-titlebar { font-size: 11px; padding: 8px; }
  #deckStack { width: 100% !important; height: 100% !important; left: 0 !important; right: 0 !important; }
  .solo-clock { font-size: 56px; }
  .theme-bar { margin-left: 6px; margin-right: 6px; }
  header { padding-top: 4px; }
}
"""
# append if not already (avoid doubling the hide rule messily — replace ascii-banner line in media)
css = css.replace(
    "@media screen and (max-width: 1280px) {\n  .ascii-banner { font-size: 8px; }",
    "@media screen and (max-width: 1280px) {\n  .ascii-banner { display: none !important; }\n  .crt-frame { margin: 6px 6px 0; }\n  .crt-titlebar { font-size: 11px; padding: 8px; }\n  #deckStack { width: 100% !important; height: 100% !important; left: 0 !important; right: 0 !important; top: 0 !important; bottom: 0 !important; }\n  .solo-clock { font-size: 56px; }\n  .theme-bar { margin-left: 6px; margin-right: 6px; }\n  header { padding-top: 4px; }"
)

css_path.write_text(css, encoding="utf-8")

# 5) inline CSS into index.html (old iPad home-screen caches one file more reliably)
html = html_path.read_text(encoding="utf-8")
# simplify ascii banner (unicode box-drawing can explode width on old WebKit)
html = re.sub(
    r'<pre class="ascii-banner"[^>]*>.*?</pre>',
    '<div class="ascii-banner" aria-hidden="true">TMDECK // TEXTMODE OVERLAY</div>',
    html,
    count=1,
    flags=re.S,
)
# bump tip / meta / links to v59
html = html.replace("v58", "v59").replace("v=58", "v=59").replace("BUILD 58", "BUILD 59")
# replace external stylesheet with inline
html = re.sub(
    r'\s*<link rel="stylesheet" href="deck\.css\?v=\d+"\s*/?>',
    "\n  <style>\n" + css + "\n  </style>",
    html,
    count=1,
)
html = html.replace("gadget-core.js?v=58", "gadget-core.js?v=59")
html = html.replace("deck-app.js?v=58", "deck-app.js?v=59")
# if already replaced by v58→v59 sweep:
html = html.replace("gadget-core.js?v=59", "gadget-core.js?v=59")
html_path.write_text(html, encoding="utf-8")

js = js_path.read_text(encoding="utf-8")
js = js.replace("var DRIVE_VER = 58;", "var DRIVE_VER = 59;")
js = js.replace("var APP_VER = 58;", "var APP_VER = 59;")
js = js.replace("var DRIVE_VER = 57;", "var DRIVE_VER = 59;")
js = js.replace("var APP_VER = 57;", "var APP_VER = 59;")
js_path.write_text(js, encoding="utf-8")

# keep deck.css file bumped comment
css_path.write_text("/* v59 ipad-safe */\n" + css, encoding="utf-8")

print("OK: inset fixed, CSS inlined, APP_VER 59")
print("inset left:", "inset:" in css_path.read_text(encoding="utf-8"))
print("inline style:", "<style>" in html_path.read_text(encoding="utf-8"))
print("link css:", "deck.css" in html_path.read_text(encoding="utf-8"))
