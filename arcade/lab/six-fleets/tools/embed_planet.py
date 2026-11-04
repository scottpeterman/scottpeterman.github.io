# Copies a baked planet (assets/planets/<name>/, from tools/planets/bake_planet.py) into the skirmish as data URIs,
# so the page runs from a plain file (file:// pages cannot fetch).
#   python3 tools/embed_planet.py                 (from battle/; every planet a location uses)
#   python3 tools/embed_planet.py --name veyrath --name caelora
# build_skirmish.py runs it with the default. The embedded block is #planet-maps, keyed by planet name;
# src/skirmish_core.js reads it (LOCATIONS names the planets it uses).
import argparse, base64, json, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent.parent          # battle
PLANETS = HERE / 'assets' / 'planets'
DEFAULT = ['veyrath', 'caelora']                                # Tauri-B I and II
PAGES = [HERE / 'skirmish.html']

pat = re.compile(r'<script id="planet-maps" type="application/json">.*?</script>', re.S)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', action='append', help='folder under assets/planets (repeat for more)')
    a = ap.parse_args()
    names = a.name or DEFAULT
    data, kb = {}, 0
    for name in names:
        src = PLANETS / name
        meta = json.loads((src / 'planet.json').read_text())
        maps = {k: 'data:image/webp;base64,' + base64.b64encode((src / f).read_bytes()).decode('ascii')
                for k, f in meta['maps'].items()}
        data[name] = {'meta': meta, 'maps': maps}
        kb += sum((src / f).stat().st_size for f in meta['maps'].values()) // 1024
    block = ('<script id="planet-maps" type="application/json">'
             + json.dumps(data, separators=(',', ':')) + '</script>')
    for page in PAGES:
        if not page.exists():
            continue
        html = page.read_text()
        html = pat.sub(lambda m: block, html) if pat.search(html) else html.replace('</body></html>', block + '\n</body></html>')
        page.write_text(html)
        print('embedded planets', ', '.join(names), f'({kb} KB)', '->', page.name, f'{page.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
