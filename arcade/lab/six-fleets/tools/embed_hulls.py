# Copies the Shipyard hulls into the battle pages (engagement.html, skirmish.html) so they run from a plain file
# (file:// pages cannot fetch).
# Run after rebuilding a model in shipyard/assets:  python3 tools/embed_hulls.py   (from battle/)
import base64, json, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent.parent          # battle
ASSETS = HERE.parent / 'shipyard' / 'assets'
FILM = {'sov': 'qin-sovereign.glb', 'rec': 'qin-reclamation.glb'}
# the skirmish carries the whole fleet (keys match MODELS in the film's code and FLEET in src/skirmish_core.js)
FLEET = dict(FILM, pf='antari-pathfinder.glb', sn='bane-sentinel.glb', vg='echtar-vanguard.glb', rp='rayzine-raptor.glb')
PAGES = {HERE / 'engagement.html': FILM, HERE / 'skirmish.html': FLEET}

pat = re.compile(r'<script id="film-hulls" type="application/json">.*?</script>', re.S)
for page, hulls in PAGES.items():
    if not page.exists():
        continue
    data = {k: base64.b64encode((ASSETS / f).read_bytes()).decode('ascii') for k, f in hulls.items()}
    block = '<script id="film-hulls" type="application/json">' + json.dumps(data, separators=(',', ':')) + '</script>'
    html = page.read_text()
    html = pat.sub(lambda m: block, html) if pat.search(html) else html.replace('</body></html>', block + '\n</body></html>')
    if True:   # and their baked occlusion fields (shipkit.bake_occlusion), for the hull shader (js/shiplook.js)
        ao = {k: json.loads((ASSETS / f.replace('.glb', '.ao.json')).read_text()) for k, f in hulls.items()
              if (ASSETS / f.replace('.glb', '.ao.json')).exists()}
        aopat = re.compile(r'<script id="film-ao" type="application/json">.*?</script>', re.S)
        aoblock = '<script id="film-ao" type="application/json">' + json.dumps(ao, separators=(',', ':')) + '</script>'
        html = aopat.sub(lambda m: aoblock, html) if aopat.search(html) else html.replace('</body></html>', aoblock + '\n</body></html>')
        print('embedded', len(ao), 'occlusion fields ->', page.name)
    page.write_text(html)
    print('embedded', len(hulls), 'hulls', f'({sum((ASSETS / f).stat().st_size for f in hulls.values()) // 1024} KB)', '->', page.name, f'{page.stat().st_size // 1024} KB')
