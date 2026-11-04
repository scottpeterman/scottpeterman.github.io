# Builds dist/: the skirmish as one self-contained page for a static host (the arcade at
# scottpeterman.github.io/arcade), from battle/skirmish.html.
#
#   python3 battle/tools/build_skirmish.py     (first, if src/skirmish_core.js changed)
#   python3 battle/tools/build_dist.py
#   python3 battle/tools/build_dist.py --keep-comments
#
# The page's local scripts (battle/js/bridge.js and the engine files it reads from ../engine/js) are inlined,
# so dist/ is index.html, assets/br10-shrike.glb and thumb.jpg (the arcade card, cropped 16:9 from
# battle/docs/screenshots/skirmish-burning.png). three.js and the fonts still come from their CDNs,
# as in the repo page. Every inlined script, and the page's own, goes through terser with comments dropped and
# nothing renamed or compressed (npx fetches terser the first time): the comments carry the engine's working
# notes, which stay in the repo. The scrub audit then scans the result (--text); its counts print at the end.
import argparse, json, pathlib, re, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
BATTLE = ROOT / 'battle'
DIST = ROOT / 'dist'
PAGE = BATTLE / 'skirmish.html'
ASSETS = ['assets/br10-shrike.glb']          # the page still loads the Tauri Reach player hull, though hidden
THUMB = BATTLE / 'docs' / 'screenshots' / 'skirmish-burning.png'


def strip(js, keep):
    if keep:
        return js
    r = subprocess.run(['npx', '--yes', 'terser@5', '--format', 'comments=false', '--ecma', '2020'],
                       input=js, capture_output=True, text=True)
    if r.returncode:
        sys.exit('terser failed:\n' + r.stderr[-2000:])
    return r.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keep-comments', action='store_true', help='inline the scripts as they are')
    a = ap.parse_args()
    html = PAGE.read_text()

    # local <script src>: inline (relative to battle/)
    n = 0
    def inline(m):
        nonlocal n
        path = (BATTLE / m.group(1)).resolve()
        if not path.is_file():
            sys.exit(f'missing script: {m.group(1)}')
        n += 1
        return '<script>' + strip(path.read_text(), a.keep_comments).replace('</script', '<\\/script') + '</script>'
    html = re.sub(r'<script src="((?!https?:)[^"]+)"></script>', inline, html)
    left = re.findall(r'<script src="((?!https?:)[^"]+)"', html)
    if left:
        sys.exit(f'local scripts not inlined: {left}')

    # the page's own inline scripts (leave the embedded hull data alone)
    def own(m):
        attrs, body = m.group(1), m.group(2)
        if 'type="application/json"' in attrs or not body.strip():
            return m.group(0)
        return f'<script{attrs}>' + strip(body, a.keep_comments).replace('</script', '<\\/script') + '</script>'
    html = re.sub(r'<script((?:\s[^>]*)?)>(.*?)</script>', own, html, flags=re.S)

    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / 'assets').mkdir(parents=True)
    for f in ASSETS:
        shutil.copy2(BATTLE / f, DIST / f)
    (DIST / 'index.html').write_text(html)
    try:
        from PIL import Image
        im = Image.open(THUMB).convert('RGB'); w, h = im.size; cw = min(w, int(h * 16 / 9)); x = (w - cw) // 2
        im.crop((x, 0, x + cw, h)).resize((640, 360), Image.LANCZOS).save(DIST / 'thumb.jpg', quality=88)
    except ImportError:
        print('Pillow not installed: no thumb.jpg (pip install Pillow)')
    size = (DIST / 'index.html').stat().st_size
    print(f'wrote dist/index.html {size // 1024} KB ({n} scripts inlined) + {len(ASSETS)} asset(s)')

    # what a visitor could read: the scrub audit over the page text
    r = subprocess.run([sys.executable, '-I', str(ROOT / 'engine' / 'tools' / 'scrub_audit.py'),
                        '--text', str(DIST / 'index.html')], capture_output=True, text=True, cwd=ROOT / 'engine')
    out = r.stdout or r.stderr
    print('scrub audit over dist/index.html (counts; the embedded hull data adds false product hits):')
    print('\n'.join(l for l in out.splitlines() if not re.match(r'\s+\w+: line \d+ ', l)).strip())


if __name__ == '__main__':
    main()
