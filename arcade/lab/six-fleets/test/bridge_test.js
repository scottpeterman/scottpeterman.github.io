// battle/test/bridge_test.js — the bridge against the real engine, no browser.
//   node battle/test/bridge_test.js        (from the repo root; engine/ needs no npm install for this)
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), ENG = path.join(ROOT, 'engine', 'js');
const ctx = vm.createContext({ crypto: globalThis.crypto, console, Math, JSON, Object, Array, Set, Map, Number, String, Error });
const load = f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
vm.runInContext("var gameState = { rules: { qip: 'curve', fire: 'curve', pd: 'damage', pd3: 'single', ws: 0 } };", ctx);
for (const f of ['terms.js', 'ships.js', 'damage_state.js', 'profiles.js', 'hulls/qin_sovereign.js', 'hulls/meer_reclamation.js', 'hex.js', 'dac.js', 'combat.js'])
  load(path.join(ENG, f));
load(path.join(ROOT, 'battle', 'js', 'bridge.js'));
const run = code => vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const check = (ok, what) => { ok ? pass++ : fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + what); };

// Shields: a shooter at each bearing meets the shield the sheet names for it.
const want = [[0, 1], [45, 2], [75, 2], [120, 3], [180, 4], [240, 5], [285, 6], [325, 6], [358, 1]];  // sectors are 60 wide, centred on 0, 60 ... 300
for (const [b, s] of want) check(run(`Bridge.shieldFacing(${b})`) === s, `shooter at ${b} deg meets shield #${s}`);

// Arcs: the Reclamation's three Helios Lances (FA) bear dead ahead and not astern; its rear QIP-3s the reverse.
const lancesAt = b => run(`Bridge.bearingWeapons('meer_reclamation', ${b}).filter(x => x.category === 'hellbores').length`);
check(lancesAt(0) === 3 && lancesAt(180) === 0, `three lances bear ahead (${lancesAt(0)}), none astern (${lancesAt(180)})`);
const rearPd = b => run(`Bridge.bearingWeapons('meer_reclamation', ${b}).filter(x => x.weapon.label === 'QIP-3').length`);
check(rearPd(180) > 0 && rearPd(0) === 0, `rear QIP-3s bear astern (${rearPd(180)}), not ahead`);

// Fire and land: Sovereign torpedoes at 8 hexes into the Reclamation's bow, many times; damage must
// reach the forward shield first and only then go internal, and the record must say where.
run(`Bridge.reset(['qin_sovereign', 'meer_reclamation'])`);
let shots = 0, landed = 0, internalSeen = false;
for (let i = 0; i < 30 && !run(`Bridge.destroyed('meer_reclamation')`); i++) {
  const v = run(`(() => { const p = Bridge.bearingWeapons('qin_sovereign', 0).filter(x => x.category === 'photons'); return Bridge.fire('qin_sovereign', p, 8); })()`);
  shots += v.shots.length;
  vm.runInContext('var __v = ' + JSON.stringify(v), ctx);
  const recs = run(`Bridge.land('meer_reclamation', 0, __v)`);
  for (const r of recs) { landed += r.damage; if (r.internal > 0) internalSeen = true; if (r.shield !== 1) check(false, 'volley landed on shield #' + r.shield); }
}
const sh = run(`Bridge.shields('meer_reclamation')`);
check(shots > 0 && landed > 0, `torpedoes fired (${shots} shots, ${landed} points landed)`);
check(sh[1].left === 0 && internalSeen, `shield #1 down (${sh[1].left}/${sh[1].max}) and internal damage marked`);
check(sh[4].left === sh[4].max, `rear shield untouched (${sh[4].left}/${sh[4].max})`);

// The lance envelops: it spreads over every shield, not just the facing one.
run(`Bridge.reset(['qin_sovereign', 'meer_reclamation'])`);
const env = run(`(() => { let e = 0; for (let i = 0; i < 12; i++) { const p = Bridge.bearingWeapons('meer_reclamation', 0).filter(x => x.category === 'hellbores'); const v = Bridge.fire('meer_reclamation', p, 10); e += v.enveloping; Bridge.land('qin_sovereign', 0, v); } return e; })()`);
const s2 = run(`Bridge.shields('qin_sovereign')`);
const touched = Object.values(s2).filter(x => x.left < x.max).length;
check(env > 0 && touched >= 4, `lance damage (${env}) spread over ${touched} shields`);

// Destroyed weapons stop bearing.
run(`Bridge.reset(['qin_sovereign', 'meer_reclamation'])`);
run(`getDamageState('meer_reclamation').damage.hbA = true`);
check(lancesAt(0) === 2, 'a destroyed lance no longer bears');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
