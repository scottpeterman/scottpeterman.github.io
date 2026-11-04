# Assembles battle/skirmish.html: the Tauri Reach page (index.html) with the skirmish in place of the sorties.
#   python3 tools/build_skirmish.py        (from battle/)
#
# What goes in:
#   - index.html, unchanged except for two hooks: SK.step() takes over the game's step(), and SK.start()
#     replaces the briefing once the nebula has baked;
#   - the tactical engine's scripts (../engine/js: all six hulls, and power.js and drones.js for the seeking
#     weapons' warheads), the bridge (js/bridge.js) and the ship sheet CSS;
#   - the film's shared ship code from engagement.html (Shipyard hull loading and dressing, the ship builders
#     with their drive, shield and lance data, shields, beams, glows, strikePoint), so both pages draw the
#     ships the same way;
#   - src/skirmish_core.js, the skirmish itself;
#   - the planet backdrop (js/planet.js) and its baked maps (tools/embed_planet.py);
#   - the embedded hulls (tools/embed_hulls.py), so the page runs from a plain file.
import pathlib, re, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent.parent              # battle/
ENGINE_HTML = HERE.parent / 'engine' / 'game2.html'
src = (HERE / 'index.html').read_text()
film = (HERE / 'engagement.html').read_text()
core = (HERE / 'src' / 'skirmish_core.js').read_text()


def cut(text, start, end):
    a = text.index(start)
    return text[a:text.index(end, a)]


# ---- the film's shared ship code
shared = cut(film, '/* ---------- the ships: Shipyard models', '/* ---------- state ---------- */')
shared += cut(film, '// a ray from `from` toward the target ship', '/* ---------- weapons ---------- */')
core = core.replace('/*@@FILM_SHARED@@*/', shared.rstrip())

# ---- hooks
step_hook = 'function step(dt){\n'
assert src.count(step_hook) == 1
src = src.replace(step_hook, step_hook + '  if(window.SK&&SK.on){SK.step(S.rdt);return;}\n')
start_line = "  if(/[?&]lab\\b/.test(location.search))enterLab();else showBrief("
assert src.count(start_line) == 1
src = src.replace(start_line, "  if(window.SK){SK.dom();SK.start();}\n  else " + start_line.lstrip())

# ---- the skirmish closes the game's scope, as the film does
m = re.search(r'\}\)\(\);\s*</script>\s*</body></html>\s*$', src)
assert m, 'index.html no longer ends with the game scope'
src = src[:m.start()] + core.rstrip() + '\n\n})();\n</script>\n</body></html>\n'

# ---- engine scripts before the game's
engine = ['terms.js', 'ships.js', 'damage_state.js', 'profiles.js',
          'hulls/qin_sovereign.js', 'hulls/meer_reclamation.js', 'hulls/antari_pathfinder.js', 'hulls/bane_sentinel.js',
          'hulls/echtar_vanguard.js', 'hulls/rayzine_raptor.js',
          'hex.js', 'dac.js', 'combat.js', 'power.js', 'drones.js', 'sheet.js']
# the tactical game's default house rules, missile speed included (8 hexes a turn)
tags = ("<script>var gameState={rules:{droneSpeed:20,qip:'curve',fire:'curve',pd3:'single',pd:'damage',ws:2}};</script>\n"
        + ''.join(f'<script src="../engine/js/{f}"></script>\n' for f in engine)
        + '<script src="js/bridge.js"></script>\n'
        + '<script src="js/planet.js"></script>\n'
        + '<script src="js/shiplook.js"></script>\n')
loader = '<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js"></script>\n'
assert src.count(loader) == 1
src = src.replace(loader, loader + tags)

# ---- title, CSS, DOM
src = src.replace('<title>Tauri Reach</title>', '<title>Six Fleets · Skirmish at Tauri-B</title>', 1)
eng = ENGINE_HTML.read_text()
sheet_vars = '\n'.join(l for l in eng.splitlines()[30:60] if l.strip().startswith('--sheet-'))
sheet_css = '\n'.join(l for l in eng.splitlines() if l.strip().startswith('.qsheet'))
css = """
/* ---- skirmish ---- */
:root{
%s
}
%s
body.skirmish .hud,body.skirmish #ctl,body.skirmish #tip,body.skirmish #help,body.skirmish #brief,body.skirmish #debrief,body.skirmish #alert,
body.skirmish #pausev,body.skirmish #bracket,body.skirmish canvas#hud2d,body.skirmish #strip{display:none!important}
.sk{display:none}
body.skirmish .sk{display:block}
.skp{position:fixed;z-index:6;background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:8px 10px;font-size:11px;letter-spacing:.06em;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.skp h3{margin:0 0 4px;font-size:11px;letter-spacing:.2em;color:var(--plasma);font-weight:600}
.skp .hex{width:88px;height:80px;display:block;margin:2px auto}
.skp .hex text{font-family:var(--mono);font-size:10px;fill:var(--text)}
#sk-p{top:calc(10px + env(safe-area-inset-top,0px));left:10px;width:200px}
#sk-t{top:calc(10px + env(safe-area-inset-top,0px));right:10px;width:200px}
#sk-pw{margin-top:6px;max-height:42vh;overflow:auto}
.wr{display:grid;grid-template-columns:1fr 34px 54px;gap:4px;align-items:center;font-family:var(--mono);font-size:10.5px;color:var(--dim);padding:1px 0}
.wr.on{color:var(--text)}
.wr.on span::before{content:'◆ ';color:var(--cyan)}
.wr em{font-style:normal;color:var(--dim);font-size:9.5px}
.wr i{display:block;height:4px;border-radius:2px;background:linear-gradient(90deg,#3fb7ff var(--p),rgba(255,255,255,.08) var(--p))}
.wr b{font-weight:400;font-size:9.5px}.wr b.rdy{color:var(--ok)}.wr b.lost{color:var(--hot)}
.skline{font-family:var(--mono);font-size:10.5px;color:var(--dim);margin-top:3px}
.thr{display:block;position:relative;height:5px;margin-top:4px;background:rgba(255,255,255,.08);border-radius:2px}
.thr b{display:block;height:100%%;background:linear-gradient(90deg,#3fb7ff,#6ff3ff);border-radius:2px}
.thr u{position:absolute;top:-2px;width:2px;height:9px;background:#fff;margin-left:-1px}
#sk-log{position:fixed;left:50%%;transform:translateX(-50%%);bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:6;width:min(760px,calc(100vw - 460px));
  font-family:var(--mono);font-size:11px;line-height:1.45;text-shadow:0 1px 3px #000;pointer-events:none}
#sk-log .hit{color:#9fd7ff}#sk-log .hurt{color:#ffb38a}#sk-log .dim{color:var(--dim)}
/* bottom-right column: the missile warning sits on the key strip, and drops to the corner when H hides the strip */
#sk-br{position:fixed;right:10px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:8;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none}
#sk-help{font-family:var(--mono);font-size:10px;color:var(--dim);text-align:right;line-height:1.5}
body.sk-nohelp #sk-help{display:none}
#sk-tools{position:fixed;right:10px;top:calc(190px + env(safe-area-inset-top,0px));z-index:6;display:flex!important;flex-direction:column;gap:6px;align-items:stretch}
body:not(.skirmish) #sk-tools{display:none!important}
#sk-tools button{min-width:118px;text-align:left}
body.sk-rec #sk-rec{color:var(--hot);border-color:rgba(255,90,74,.6)}
#sk-recdot{position:fixed;top:calc(30px + env(safe-area-inset-top,0px));left:50%%;transform:translateX(-50%%);z-index:6;font-family:var(--mono);font-size:12px;letter-spacing:.15em;color:var(--hot);text-shadow:0 0 8px rgba(255,90,74,.6)}
#sk-unclean{position:fixed;right:10px;top:calc(10px + env(safe-area-inset-top,0px));z-index:7;display:none!important;opacity:.45;padding:6px 9px!important}
body.skirmish.sk-clean .sk:not(#sk-end):not(#sk-recdot):not(#sk-unclean){display:none!important}
body.skirmish.sk-clean #sk-unclean{display:block!important}
#sk-clock{position:fixed;top:calc(12px + env(safe-area-inset-top,0px));left:50%%;transform:translateX(-50%%);z-index:6;font-family:var(--mono);color:var(--dim);font-size:12px;letter-spacing:.15em}
#sk-touch{position:fixed;inset:auto 0 calc(70px + env(safe-area-inset-bottom,0px)) 0;z-index:7;pointer-events:none;display:none!important}
body.skirmish.touch #sk-touch{display:flex!important;justify-content:space-between;padding:0 12px}
#sk-touch div{display:flex;gap:8px;pointer-events:auto}
#sk-touch button,#sk-end button,#sk-tools button,#sk-unclean{font-family:var(--display);font-weight:600;font-size:11px;letter-spacing:.14em;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:10px 12px;cursor:pointer;touch-action:none}
#sk-touch button{min-width:56px;min-height:48px}
#sk-end{position:fixed;inset:0;z-index:20;background:rgba(3,3,8,.86);overflow:auto;padding:24px 16px;display:none!important}
body.skirmish.sk-over #sk-end{display:block!important}
#sk-end-title{text-align:center;font-weight:600;font-size:clamp(20px,3vw,34px);letter-spacing:.32em;color:#f1ead8;margin:6px 0 4px}
#sk-end .sub{text-align:center;font-family:var(--mono);color:var(--dim);font-size:12px;letter-spacing:.1em;margin-bottom:16px}
#sk-sheets{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.sk-sheet{background:var(--sheet-bg);border:1px solid var(--sheet-line);border-radius:4px;padding:10px;width:min(440px,92vw)}
.sk-sheet svg{width:100%%;height:auto;max-height:70vh;display:block}
.sk-sheet .sum{font-family:var(--mono);font-size:11px;color:var(--sheet-ink-2);line-height:1.5;margin-bottom:6px}
.sk-sheet .sum b{color:var(--sheet-ink);letter-spacing:.1em}
#sk-end .btns{display:flex;gap:10px;justify-content:center;margin:16px 0}
#sk-pick{position:fixed;inset:0;z-index:20;background:rgba(3,3,8,.72);display:none!important;align-items:center;justify-content:center;padding:16px}
body.skirmish.sk-picking #sk-pick{display:flex!important}
body.skirmish.sk-picking .sk:not(#sk-pick){display:none!important}
#sk-pick .box{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:18px 20px;max-width:760px;width:100%%}
#sk-pick h2{margin:0 0 4px;text-align:center;font-weight:600;font-size:clamp(18px,2.6vw,28px);letter-spacing:.3em;color:#f1ead8}
#sk-pick .sub{text-align:center;font-family:var(--mono);color:var(--dim);font-size:11px;letter-spacing:.1em;margin-bottom:14px}
#sk-pick .lab{font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--plasma);margin:12px 0 6px}
#sk-pick .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px}
#sk-pick .row button{display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left}
#sk-pick .row button b{font-weight:600;letter-spacing:.14em}
#sk-pick .row button span{font-family:var(--mono);font-size:9.5px;color:var(--dim);letter-spacing:.12em}
#sk-pick .row button.on{border-color:var(--plasma);color:var(--plasma)}
#sk-pick .btns{display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap}
#sk-pick button{font-family:var(--display);font-weight:600;font-size:11px;letter-spacing:.14em;color:var(--text);background:rgba(10,20,36,.8);border:1px solid var(--line);border-radius:3px;padding:10px 12px;cursor:pointer}
#sk-pick .box.keys>:not(#sk-keys){display:none}
#sk-keys{display:none}
#sk-pick .box.keys #sk-keys{display:block}
#sk-keys .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 22px;max-height:62vh;overflow:auto}
#sk-keys dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:5px 12px;align-items:baseline;font-family:var(--mono);font-size:11.5px;color:var(--text)}
#sk-keys dt{white-space:nowrap}
#sk-keys dd{margin:0;color:var(--dim)}
#sk-keys kbd{display:inline-block;min-width:16px;text-align:center;padding:1px 5px;border:1px solid var(--line);border-bottom-width:2px;border-radius:3px;background:rgba(10,20,36,.8);color:var(--plasma);font:11px var(--mono)}
#sk-keys .tip{font-family:var(--mono);font-size:10.5px;color:var(--dim);margin-top:12px;line-height:1.5}
#sk-star{position:fixed;top:calc(22%% + env(safe-area-inset-top,0px));left:50%%;transform:translateX(-50%%);z-index:8;display:none!important;pointer-events:none;
  text-align:center;padding:10px 26px;border:2px solid #ff3b30;border-radius:3px;background:rgba(120,8,4,.55);box-shadow:0 0 24px rgba(255,59,48,.45);color:#fff}
#sk-star.on{display:block!important}
#sk-star b{display:block;font-family:var(--display);font-weight:700;font-size:clamp(18px,2.6vw,30px);letter-spacing:.32em;color:#ff5a4a;text-shadow:0 0 12px rgba(255,59,48,.8)}
#sk-star span{display:block;font-family:var(--mono);font-size:12px;letter-spacing:.18em;margin-top:4px}
#sk-star.crit{animation:skstar .5s steps(2,start) infinite;background:rgba(170,10,4,.7)}
#sk-msl{display:none!important;pointer-events:none;text-align:right;padding:6px 16px;border:1px solid rgba(255,174,90,.6);background:rgba(60,30,4,.55);border-radius:3px}
#sk-msl.on{display:block!important}
#sk-msl b{display:block;font-family:var(--display);font-weight:700;font-size:clamp(14px,2vw,22px);letter-spacing:.28em;color:#ffae5a;text-shadow:0 0 10px rgba(255,150,40,.7)}
#sk-msl span{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.16em;margin-top:3px;color:#ffd9b0}
#sk-msl.crit{animation:skstar .5s steps(2,start) infinite;background:rgba(150,70,4,.7)}
@keyframes skstar{to{border-color:transparent;box-shadow:none}}
#sk-endrec{color:var(--hot)!important;border-color:rgba(255,90,74,.6)!important}
#sk-endrec[hidden]{display:none}
#sk-radar{position:fixed;left:10px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:6;width:180px;height:180px;pointer-events:none}
body.skirmish.touch #sk-radar{bottom:calc(130px + env(safe-area-inset-bottom,0px));width:150px;height:150px}
#sk-ptr{position:fixed;left:0;top:0;z-index:6;pointer-events:none;width:0;height:0}
#sk-ptr i{position:absolute;left:-11px;top:-9px;width:0;height:0;border-left:22px solid #ff6a4a;border-top:9px solid transparent;border-bottom:9px solid transparent;filter:drop-shadow(0 0 4px rgba(255,106,74,.8));transform-origin:11px 9px}
#sk-ptr span{position:absolute;left:-30px;top:12px;width:60px;text-align:center;font-family:var(--mono);font-size:10px;color:#ffb38a;text-shadow:0 1px 3px #000}
""" % (sheet_vars, sheet_css)
anchor = '</style>'
src = src.replace(anchor, css + anchor, 1)

dom = """
<div class="sk skp" id="sk-p"><h3 id="sk-pname"></h3><div id="sk-pshield"></div><div class="skline" id="sk-speed"></div><div id="sk-pw"></div></div>
<div class="sk skp" id="sk-t"><h3 id="sk-tname"></h3><div id="sk-tshield"></div><div class="skline" id="sk-range"></div><div class="skline" id="sk-tside"></div></div>
<div class="sk" id="sk-clock"></div>
<div class="sk" id="sk-tools"><button id="sk-cam" type="button">View: Chase</button><button id="sk-rec" type="button">● Rec</button><button id="sk-photo" type="button">Photo</button><button id="sk-clean" type="button">Clean view</button></div>
<button class="sk" id="sk-unclean" type="button" title="Show the HUD (C)">HUD</button>
<div class="sk" id="sk-recdot"></div>
<div class="sk" id="sk-star"><b>STAR PROXIMITY</b><span></span></div>
<div class="sk" id="sk-log"></div>
<canvas class="sk" id="sk-radar"></canvas>
<div class="sk" id="sk-ptr"><i></i><span></span></div>
<div id="sk-br"><div class="sk" id="sk-msl"><b></b><span></span></div>
<div class="sk" id="sk-help">A / D turn · W / S throttle · R / F climb, dive · Q rapid turn · hold X self-destruct<br>1 projectors · 2 heavy weapons · Space all that bear<br>V view (chase, target, fly-by) · drag to look · wheel zoom<br>K record · P photo · C clean view · J computer helm · H hide</div></div>
<div class="sk" id="sk-touch">
  <div><button data-k="tl">◀</button><button data-k="tr">▶</button><button data-k="tu">+</button><button data-k="td">−</button><button data-k="cu">▲</button><button data-k="cd">▼</button><button data-k="sn">↻</button><button data-k="sd">SD</button></div>
  <div><button data-k="f1">QIP</button><button data-k="f2">HVY</button><button data-k="fa">ALL</button></div>
</div>
<div class="sk" id="sk-pick"><div class="box">
  <h2 id="sk-pick-title">SKIRMISH AT TAURI-B</h2><div class="sub">Pick two cruisers and a place to fight. Every hit is resolved by the tactical engine.</div>
  <div class="lab">YOUR SHIP</div><div class="row" id="sk-pick-p"></div>
  <div class="lab">OPPONENT</div><div class="row" id="sk-pick-e"></div>
  <div class="lab">LOCATION</div><div class="row" id="sk-pick-l"></div>
  <div class="btns"><button id="sk-go" type="button">Launch (Enter)</button><button id="sk-watch" type="button">Watch: computer against computer</button><button id="sk-keys-btn" type="button">Control Keys</button></div>
  <div id="sk-keys">
    <h2>CONTROL KEYS</h2><div class="sub">Every hit is rolled by the tactical engine: shields by facing, damage on the ship's sheet.</div>
    <div class="cols">
      <div><div class="lab">HELM</div><dl>
        <dt><kbd>A</kbd> <kbd>D</kbd> / <kbd>◀</kbd> <kbd>▶</kbd></dt><dd>turn left / right</dd>
        <dt><kbd>W</kbd> <kbd>S</kbd> / <kbd>▲</kbd> <kbd>▼</kbd></dt><dd>throttle up / down (it holds where you leave it)</dd>
        <dt><kbd>R</kbd> <kbd>F</kbd></dt><dd>climb / dive</dd>
        <dt><kbd>Q</kbd></dt><dd>rapid speed turn: slow, spin onto the enemy, re-accelerate. Twice a fight; shakes a ship off your tail</dd>
        <dt>hold <kbd>X</kbd></dt><dd>self-destruct (1.5 s). The blast hits anything close</dd>
        <dt><kbd>J</kbd></dt><dd>hand the helm to the computer, and back</dd>
      </dl>
      <div class="lab">WEAPONS</div><dl>
        <dt><kbd>1</kbd></dt><dd>projectors (QIPs) that bear and are charged</dd>
        <dt><kbd>2</kbd></dt><dd>heavy weapons and seekers: torpedoes, lances, missiles</dd>
        <dt><kbd>Space</kbd></dt><dd>everything that bears</dd>
      </dl></div>
      <div><div class="lab">VIEW</div><dl>
        <dt><kbd>V</kbd> / <kbd>Tab</kbd></dt><dd>camera: chase, target, fly-by</dd>
        <dt>drag</dt><dd>look around</dd>
        <dt>wheel</dt><dd>zoom</dd>
        <dt><kbd>C</kbd></dt><dd>clean view (HUD off)</dd>
        <dt><kbd>H</kbd></dt><dd>hide the key strip</dd>
        <dt><kbd>`</kbd></dt><dd>debug readout (frame times, keys, focus) on / off</dd>
      </dl>
      <div class="lab">CAPTURE</div><dl>
        <dt><kbd>K</kbd></dt><dd>start / stop recording a video</dd>
        <dt><kbd>P</kbd></dt><dd>photo</dd>
      </dl>
      <div class="lab">AFTER THE FIGHT</div><dl>
        <dt><kbd>R</kbd></dt><dd>fight again, same pair</dd>
      </dl>
      <div class="lab">TOUCH</div><dl>
        <dt>◀ ▶ + − ▲ ▼</dt><dd>turn, throttle, climb / dive (hold)</dd>
        <dt>↻ · SD</dt><dd>rapid turn · self-destruct (hold)</dd>
        <dt>QIP · HVY · ALL</dt><dd>fire, as 1, 2 and Space</dd>
      </dl></div>
    </div>
    <div class="tip">The radar, bottom left, keeps the enemy's bearing and height through a fly-by; the red pointer marks it when it is off screen. A fight runs on into overtime while the ships are still trading fire. Keep clear of the star: a red banner warns when your course crosses it, and flying into it is the same as a self-destruct.</div>
    <div class="btns"><button id="sk-keys-back" type="button">Back (Esc)</button></div>
  </div>
</div></div>
<div class="sk" id="sk-end">
  <div id="sk-end-title"></div>
  <div class="sub">Damage as the tactical engine marked it, on each ship's sheet</div>
  <div class="btns"><button id="sk-endrec" type="button" hidden>■ Stop &amp; save recording (K)</button><button id="sk-again" type="button">Fight again (R)</button><button id="sk-change" type="button">Change ships</button><button id="sk-save" type="button">Save result</button></div>
  <div id="sk-sheets"></div>
</div>
"""
body_anchor = '<canvas id="hud2d"></canvas>\n'
assert src.count(body_anchor) == 1
src = src.replace(body_anchor, body_anchor + dom, 1)
# touch devices get the button rows
src = src.replace("document.body.classList.add('skirmish');", "document.body.classList.add('skirmish');if(TOUCH)document.body.classList.add('touch');", 1)

out = HERE / 'skirmish.html'
out.write_text(src)
print('wrote', out.name, f'{out.stat().st_size // 1024} KB')
subprocess.run([sys.executable, str(HERE / 'tools' / 'embed_hulls.py')], check=True)
subprocess.run([sys.executable, str(HERE / 'tools' / 'embed_planet.py')], check=True)
