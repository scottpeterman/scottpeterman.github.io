// battle/js/bridge.js
//
// The real-time battle's door into the tactical engine. The battle never decides damage itself:
// every shot is rolled by the engine's weaponShot() and every hit is marked by its resolveVolley()
// (resolveEnveloping() for the Helios Lance, resolveSplash() for the Particle Driver), on the same
// damage state (engine/js/damage_state.js) the tactical game marks. A fight played here leaves
// exactly the record a tactical game would.
//
// The engine thinks in hexes. The battle gives it two things a hex map would:
//   - range: the true distance between the ships, in hexes (UNITS_PER_HEX film units to a hex);
//   - bearing: where the other ship lies relative to a ship's bow, in degrees clockwise from dead
//     ahead (90 = starboard). The bridge stands the ship on a reference hex facing 0 and puts the
//     other ship on the hex of a ring at that bearing, so the engine's own arc test
//     (weaponsBearing) and shield choice (getShieldHit inside resolveVolley) run unchanged.
//
// Depends on: ships.js, hex.js, damage_state.js, dac.js, combat.js, profiles.js (engine/js/), and a
// global gameState with the house rules (the page sets curves for projectors and heavy weapons).

const Bridge = (() => {
  const UNITS_PER_HEX = 4;           // film units to a hex: lance reach (40 hexes) is 160 units
  const C = { q: 20, r: 7 };         // reference hex, mid-board; the ring below stays on the board
  const RING = 6;                    // 36 hexes, one every 10 degrees

  // Hexes of the ring around C with their bearing from C, clockwise from facing 0 (screen up).
  let ring = null;
  function buildRing() {
    ring = [];
    const c = hexToPixel(C.q, C.r);
    for (let q = C.q - RING; q <= C.q + RING; q++) {
      for (let r = C.r - RING - 1; r <= C.r + RING + 1; r++) {
        if (hexDistance(C.q, C.r, q, r) !== RING) continue;
        const p = hexToPixel(q, r);
        const deg = (Math.atan2(p.x - c.x, -(p.y - c.y)) * 180 / Math.PI + 360) % 360;
        ring.push({ q, r, deg });
      }
    }
  }
  /** The ring hex closest to a bearing (degrees clockwise from the bow). */
  function hexAt(bearing) {
    if (!ring) buildRing();
    const b = ((bearing % 360) + 360) % 360;
    let best = ring[0], bd = 1e9;
    for (const h of ring) {
      const d = Math.abs(((h.deg - b + 540) % 360) - 180);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  /** Bearing of `to` from a ship at `from` with orientation `q` (THREE quaternion; bow -z, starboard +x). */
  function bearingOf(from, q, to) {
    const v = to.clone().sub(from).applyQuaternion(q.clone().invert());
    return (Math.atan2(v.x, -v.z) * 180 / Math.PI + 360) % 360;
  }
  const hexRange = units => Math.max(0, Math.round(units / UNITS_PER_HEX));

  function weaponsOf(shipKey) { return Object.entries(SHIPS[shipKey].weapons).flatMap(([cat, ws]) => ws.map(w => ({ category: cat, weapon: w }))); }
  /** Undestroyed weapons whose arc holds a target at this bearing (the engine's own test). */
  function bearingWeapons(shipKey, bearing) {
    const h = hexAt(bearing);
    return weaponsBearing(shipKey, C.q, C.r, 0, h.q, h.r);
  }
  /** Would this weapon reach at this range under the current rules (no dice)? */
  function reaches(shipKey, category, weapon, rangeHex) {
    const effRange = effectiveRange(shipKey, rangeHex);
    return weaponShot(category, weapon, effRange, null, { trueRange: rangeHex, attackerKey: shipKey }).canFire;
  }

  /**
   * Roll these weapons at this range: rollFire's dice, weaponShot's results.
   * Returns { shots, damage, enveloping, splash } exactly as rollFire does.
   */
  function fire(shipKey, picks, rangeHex) {
    const effRange = effectiveRange(shipKey, rangeHex);
    const opts = { trueRange: rangeHex, attackerKey: shipKey };
    const out = { trueRange: rangeHex, effRange, shots: [], damage: 0, enveloping: 0, splash: null };
    for (const { category, weapon } of picks) {
      const shape = weaponShot(category, weapon, effRange, null, opts);
      if (!shape.canFire) { out.shots.push(shape); continue; }
      const nShots = Math.max(1, weapon.shots || 1);
      const rolls = [];
      if (shape.model === 'kill') for (let k = 0; k < nShots; k++) rolls.push(rollDie(10000) - 1);
      else if (shape.model === 'curve') rolls.push(...(heavyCurve(shape.category) ? heavyDraws(shape.pulses) : projectorDraws(nShots)));
      else for (let k = 0; k < nShots * Math.max(1, shape.dice || 1) * Math.max(1, shape.pulses || 1); k++) rolls.push(rollDie(6));
      const shot = weaponShot(category, weapon, effRange, rolls, opts);
      if (shot.enveloping) out.enveloping += shot.damage;
      else if (shot.splashing) {
        if (shot.splash && shot.damage > 0) { out.splash = out.splash || [0, 0, 0]; shot.splash.forEach((v, i) => { out.splash[i] += v; }); }
      }
      else out.damage += shot.damage;
      out.shots.push(shot);
    }
    return out;
  }

  /**
   * Mark a volley on the target. `bearing` is where the shooter lies from the target's bow.
   * Returns the engine's volley records (one per kind of damage that landed).
   */
  function land(targetKey, bearing, volley) {
    const h = hexAt(bearing);
    const geo = { targetKey, targetQ: C.q, targetR: C.r, targetFacing: 0, sourceQ: h.q, sourceR: h.r };
    const recs = [];
    if (volley.damage > 0) recs.push(resolveVolley(Object.assign({ damage: volley.damage }, geo)));
    if (volley.enveloping > 0) recs.push(resolveEnveloping(Object.assign({ damage: volley.enveloping }, geo)));
    if (volley.splash) recs.push(resolveSplash(Object.assign({ splash: volley.splash }, geo)));
    return recs;
  }

  /** Which shield faces a shooter at this bearing (1 forward, clockwise to 6). */
  function shieldFacing(bearing) { const h = hexAt(bearing); return getShieldHit(C.q, C.r, 0, h.q, h.r); }

  function shields(shipKey) {
    const s = SHIPS[shipKey].shields, st = getDamageState(shipKey);
    const out = {};
    for (let i = 1; i <= 6; i++) out[i] = { max: s[i].boxes, left: s[i].boxes - (st.shieldDamage[i] || 0) };
    return out;
  }
  const destroyed = shipKey => !!getDamageState(shipKey).destroyed;
  const weaponLost = (shipKey, id) => !!getDamageState(shipKey).damage[id];
  function reset(keys) { for (const k of keys) shipDamageState[k] = initShipDamage(k); }

  return { UNITS_PER_HEX, hexAt, bearingOf, hexRange, weaponsOf, bearingWeapons, reaches, fire, land, shieldFacing, shields, destroyed, weaponLost, reset };
})();
if (typeof module !== 'undefined') module.exports = Bridge;
