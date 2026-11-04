# Computer-against-computer skirmish sweep: every pairing of the six cruisers, headless, to the end.
#
#   npm install --prefix /tmp/vendor three@0.147.0 @fontsource/chakra-petch @fontsource/share-tech-mono
#   python3 battle/tools/sweep.py --out /tmp/sweep.json
#   python3 battle/tools/sweep.py --pairs sovereign:raptor,raptor:sovereign --runs 3 --query "pdonly=0"
#
# Each fight runs in its own page with ?auto, through SK.simulate() (no drawing). Results print as they come in,
# with an ETA, and a win table at the end. --query adds settings to every page's address (A/B checks).
import argparse, functools, http.server, itertools, json, multiprocessing as mp, pathlib, sys, threading, time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools'))
from shot import vendor_routes, LAUNCH_ARGS  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
FLEET = ['sovereign', 'reclamation', 'pathfinder', 'sentinel', 'vanguard', 'raptor']
SUMMARY = """(()=>{const r=__sk.simulate(%d);const res=__sk.result();
  const boxes=st=>Object.values(st.damage).reduce((n,v)=>n+(Array.isArray(v)?v.filter(Boolean).length:v?1:0),0);
  const sh=st=>Object.values(st.shieldDamage||{}).reduce((a,b)=>a+b,0);
  const side=k=>({boxes:boxes(res.ships[k]),shield:sh(res.ships[k]),dead:!!res.ships[k].destroyed});
  return {over:r.over,t:r.t,pl:side(res.player),ai:side(res.enemy),stats:__sk.stats,log:r.log.slice(0,4)}})()"""


def serve(port):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def worker(args):
    jobs, port, vendor, query, seconds, q = args
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(args=LAUNCH_ARGS)
        ctx = browser.new_context(viewport={'width': 640, 'height': 360})
        vendor_routes(ctx, vendor)
        for (a, b, n) in jobs:
            t0 = time.time()
            page = ctx.new_page()
            try:
                extra = ('&' + query) if query else ''
                page.goto(f'http://127.0.0.1:{port}/battle/skirmish.html?p={a}&e={b}&auto{extra}', timeout=600000)
                page.wait_for_function('window.__sk&&__sk.on', timeout=600000)
                r = page.evaluate(SUMMARY % seconds)
                r.update(p=a, e=b, run=n, wall=round(time.time() - t0, 1))
            except Exception as ex:  # one bad page should not end the sweep
                r = dict(p=a, e=b, run=n, error=str(ex)[:300], wall=round(time.time() - t0, 1))
            finally:
                page.close()
            q.put(r)
        browser.close()
    q.put(None)


def outcome(r):
    if 'error' in r:
        return 'error'
    return r.get('over') or 'running'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pairs', default='', help='a:b,c:d ... (default: all 36, mirror matches included)')
    ap.add_argument('--runs', type=int, default=1)
    ap.add_argument('--workers', type=int, default=2)
    ap.add_argument('--seconds', type=int, default=960)
    ap.add_argument('--query', default='')
    ap.add_argument('--vendor', default='/tmp/vendor')
    ap.add_argument('--port', type=int, default=8790)
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    pairs = [tuple(x.split(':')) for x in a.pairs.split(',') if x] or list(itertools.product(FLEET, FLEET))
    jobs = [(p, e, n) for n in range(a.runs) for (p, e) in pairs]
    srv = serve(a.port)
    q = mp.Manager().Queue()
    split = [jobs[i::a.workers] for i in range(a.workers)]
    procs = [mp.Process(target=worker, args=((s, a.port, a.vendor, a.query, a.seconds, q),)) for s in split if s]
    for pr in procs:
        pr.start()
    results, done, t0 = [], 0, time.time()
    live = len(procs)
    while live:
        r = q.get()
        if r is None:
            live -= 1
            continue
        results.append(r)
        done += 1
        el = time.time() - t0
        eta = el / done * (len(jobs) - done)
        print(f'[{done}/{len(jobs)}] {r["p"]:>11} v {r["e"]:<11} {outcome(r):<11} t={r.get("t", "-"):>6}  '
              f'({r["wall"]}s; elapsed {el/60:.1f} min, ETA {eta/60:.1f} min)', flush=True)
    for pr in procs:
        pr.join()
    srv.shutdown()

    # outcomes are from the player's side (p): victory = p won, defeat = e won
    tally = {}
    for r in results:
        o = outcome(r)
        for ship, won in ((r['p'], o == 'victory'), (r['e'], o == 'defeat')):
            t = tally.setdefault(ship, {'fights': 0, 'wins': 0, 'losses': 0, 'no_kill': 0})
            t['fights'] += 1
            t['wins'] += won
        if o in ('victory', 'defeat'):
            tally[r['e'] if o == 'victory' else r['p']]['losses'] += 1
        elif o in ('time', 'disengaged', 'running'):
            tally[r['p']]['no_kill'] += 1
            tally[r['e']]['no_kill'] += 1
    kinds = {}
    for r in results:
        kinds[outcome(r)] = kinds.get(outcome(r), 0) + 1
    print('\noutcomes:', ', '.join(f'{k} {v}' for k, v in sorted(kinds.items())))
    print(f'{"ship":<12}{"fights":>7}{"wins":>6}{"losses":>8}{"no kill":>9}')
    for s in FLEET:
        if s in tally:
            t = tally[s]
            print(f'{s:<12}{t["fights"]:>7}{t["wins"]:>6}{t["losses"]:>8}{t["no_kill"]:>9}')
    if a.out:
        pathlib.Path(a.out).write_text(json.dumps(results, indent=1))
        print('wrote', a.out)


if __name__ == '__main__':
    main()
