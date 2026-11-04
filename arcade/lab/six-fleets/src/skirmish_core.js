/* ===== skirmish ===== */
/* ================================================================
   SIX FLEETS · SKIRMISH — any two of the six cruisers in real time, on the Tauri Reach engine.
   The nebula, the star, its eruptions and shock fronts, sparks, bloom and interference are the game's.
   The ships are the Shipyard hulls; their weapon mounts are placed from the tactical ship sheets.
   Every shot is rolled and every hit is marked by the tactical engine (engine/js, through
   js/bridge.js), so the fight leaves the same damage record a tactical game would.

   The source of this block is battle/src/skirmish_core.js; tools/build_skirmish.py assembles the page.
   ================================================================ */
(function(){
'use strict';
const V3=THREE.Vector3, Q=THREE.Quaternion;
const sm=(e0,e1,x)=>{const t=Math.min(Math.max((x-e0)/(e1-e0),0),1);return t*t*(3-2*t);};
const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/*@@FILM_SHARED@@*/

/* ---------- rules of the fight ---------- */
const TURN_S=8;                        // seconds of battle per tactical turn
// Arming, in tactical turns (power.js): projectors recharge every turn, a missile rack launches once a turn,
// quantum torpedo tubes, ion shear cannons, particle drivers and lances take two, fusion torpedoes their size's stages.
const ARM_TURNS={phasers:1,drones:1};
const armS=(cat,w)=>(cat==='plasma'&&w&&PLASMA_TYPES[w.size]?PLASMA_TYPES[w.size].arm.length:(ARM_TURNS[cat]||2))*TURN_S;
const START_GAP=260, DISENGAGE=400, TIME_LIMIT=360, STAR_KEEP=70;
// overtime: at the time limit a fight still going (damage landed in the last OT_ACTIVE seconds, ships within
// OT_RANGE units) gets OT_STEP more seconds, again each time, up to OT_MAX. Ships standing off or circling
// without landing anything still run out the clock.
const OT_STEP=60, OT_ACTIVE=30, OT_RANGE=200, OT_MAX=900;
const SEEKERS=new Set(['plasma','drones']);
// climb and dive: the hull pitches up to MAX_PITCH while it changes height and levels out again; it stays within
// ALT_LIMIT of the star's equatorial plane, inside the nebula and clear of the jets' cores
const MAX_PITCH=0.52, ALT_LIMIT=110;
/* rapid speed turn: the ship throws away its speed and spins on the spot, then accelerates out on its new heading.
   SNAP_USES a fight per ship, any time. Over SNAP_S seconds the speed bleeds to SNAP_FLOOR and the turn rate
   climbs to SNAP_RATE (rad/s) as the ship slows: about 170° in all, so a ship can come round on a pursuer that has
   sat on its tail. ?nosnap takes it away (A/B sweeps), ?snaps=N sets the count.
   The computer captain uses it when the enemy has sat aft of it (beyond SNAP_AFT° off the bow, inside 30 hexes) for
   SNAP_TAIL seconds without the range opening, and its guns would rather have the enemy somewhere else. */
const _sq=new URLSearchParams(location.search);
/* The star: inside STAR_KEEP (from the star's axis, any height) a ship is lost, its reactor going up as in a
   self-destruct, the blast reaching the other ship by range. At full speed a cruiser turns on a radius of 60-85,
   so a bow-on approach must start turning about 125 out: the warning starts at STAR_WARN when the ship's course
   would cross STAR_KEEP (+ STAR_PAD), and goes critical at STAR_CRIT. ?nostar keeps the old wall instead. */
const STAR_ON=!_sq.has('nostar'), STAR_WARN=210, STAR_CRIT=135, STAR_PAD=12;
/* ---------- engagement locations ----------
   Tauri-B: in the nebula, by the young star (the game's own scene). Veyrath and Caelora are Tauri-B's own worlds: the
   fight is in high orbit, the planet takes the star's place as the hazard, and Tauri-B is a distant sun. ?loc= picks
   one; the picker offers them; the result records it.
   The hazard is the star's rule generalised: inside its edge a ship is lost. The star's edge is STAR_KEEP from its
   axis at any height; a planet's is the sphere's cross-section at the ship's height (its centre sits below the fight,
   so the edge is nearer the deeper a ship dives). Warnings run off the distance to the edge, as the star's always did. */
const PLANET_R=1000;
// the planet's centre: 850 below the fight, ahead and to the right of the opening line of sight (the ships start on
// the +z side, facing +z), so its horizon slants across the lower right and the surface is nearer the deeper a ship
// dives. The sun stands high on the left: the day side faces up, and the terminator shows from the fight.
const ORBIT_AT=new V3(-803,-850,363), ORBIT_SUN=new V3(0.5,0.75,0.43).normalize().multiplyScalar(3000);
const LOCATIONS={
  tauri:{name:'Tauri-B',sub:'In the nebula, by the young star',hazard:'STAR'},
  veyrath:{name:'Veyrath',sub:'Tauri-B I · volcanic world',planet:'veyrath',hazard:'VEYRATH',
    at:ORBIT_AT,sun:ORBIT_SUN,spin:0.0015,tilt:0.3},
  caelora:{name:'Caelora',sub:'Tauri-B II · oceanic world',planet:'caelora',hazard:'CAELORA',
    at:ORBIT_AT,sun:ORBIT_SUN,spin:0.0015,tilt:0.41},
};
const LOC_IDS=Object.keys(LOCATIONS);
let LOC=LOCATIONS.tauri;
const WARN_D=STAR_WARN-STAR_KEEP, CRIT_D=STAR_CRIT-STAR_KEEP;      // 140 and 65 from the edge
const HZ={x:0,y:0,z:0,R:0};                                       // R 0: the star's fixed edge
/** The hazard's edge, measured from its axis, at height y. */
function hzKeep(y){if(!HZ.R)return STAR_KEEP;const dy=y-HZ.y;return dy>=HZ.R?0:Math.sqrt(HZ.R*HZ.R-dy*dy);}
const SNAP_USES=_sq.has('nosnap')?0:_sq.has('snaps')?Math.max(0,+_sq.get('snaps')||0):2;
const SNAP_S=2.4, SNAP_FLOOR=0.6, SNAP_RATE=1.5, SNAP_TAIL=6, SNAP_AFT=110;
/* self-destruct: the ship blows itself up and the blast hits the enemy if it is close, as one volley of SD_DMG on
   the shield facing the wreck, falling off by range (SD_FALL, by hexes 0..4; nothing past 4). The player holds X
   (touch: SD) for SD_HOLD seconds; letting go cancels. A computer captain does it when it is beaten (half its boxes
   marked, or every weapon but point defence lost), the shield facing the enemy is down and the enemy is within
   SD_AI_RH hexes. ?nosd takes it away. */
const SD_ON=!_sq.has('nosd'), SD_HOLD=1.5, SD_DMG=36, SD_FALL=[1,1,1,0.5,0.25], SD_AI_RH=2, SD_AI_FRAC=0.5;
// the engine sees a flat map. Bearings drop the height difference (in the ship's level frame); a ship or seeker
// within DEAD_ZONE of straight above or below keeps the bearing it had as it crossed into that cone
const DEAD_ZONE=Math.cos(15*Math.PI/180);
const HEX_U=Bridge.UNITS_PER_HEX;
// seeking weapons (power.js, drones.js): speeds in hexes a turn, flown in real time
// Missiles: their tactical speed (20 hexes a turn) comes out at 10 units/s here, slower than every cruiser
// (11-13 units/s), so a missile could only hit a ship flying at it. They fly at ASM_SPEED instead, just faster
// than the fastest ship, and keep the tactical reach (speed x endurance, 60 hexes) by burning out sooner: ASM_LIFE.
// The Raptor's sixteen missiles are 192 points of warhead, so the speed is steep: in Raptor sweeps 14 hit about half
// and fought even, 17 hit 84% and won every fight inside a minute. ?asmspeed=N sets it (10 is the straight conversion).
const FT_SPEED=PLASMA_SPEED/TURN_S*HEX_U;
const ASM=DRONE_TYPES.I, ASM_REACH=(gameState.rules.droneSpeed||20)*ASM.endurance*HEX_U;
const ASM_SPEED=+new URLSearchParams(location.search).get('asmspeed')||14, ASM_LIFE=ASM_REACH/ASM_SPEED;
// warhead: 8, two-thirds of the tactical Type-I's 12 (?asmdmg=N sets it). Once missiles can catch a ship about half of
// them land; the Raptor's four racks at 12 won its sweeps 7-1 with kills inside 40 s, so it carries fewer racks
// (RAPTOR_RACKS of its four loaded, the rest empty; ?raptorracks=N, 1-4; the Vanguard keeps its two). Three racks at
// 12 still wiped a human player out, who had no cue to dodge as the computer does (the missile banner gives one now),
// so the warhead came down as well. Computer against computer, the Raptor's missile pairings went 12-11 at 12,
// 5-22 at 8 and 2-19 at 6 (3 runs each).
const ASM_WARHEAD=+new URLSearchParams(location.search).get('asmdmg')||8;
const RAPTOR_RACKS=clamp(+new URLSearchParams(location.search).get('raptorracks')||3,1,4);
const ftReach=size=>{const b=PLASMA_TYPES[size].bands;return b[b.length-1][0];};

/* ---------- the fleet ----------
   The Sovereign and the Reclamation use the film's builders (hand-placed mounts, the Reclamation's lance emitters).
   The other four are dressed from their Shipyard models: shields and hull extents from the model's bounds, drives
   at the Shipyard's drive discs (x, y, z, r in model units, as in shipyard/index.html). Speeds and turn rates
   follow each class's turn mode on the tactical sheet. */
const FLEET={
  sovereign:  {hull:'qin_sovereign',    race:'QIN',     cls:'SOVEREIGN',  model:'sov', build:()=>buildSovereign(),  maxSpeed:12,turnRate:0.17,beam:'qin'},
  reclamation:{hull:'meer_reclamation', race:'MEER',    cls:'RECLAMATION',model:'rec', build:()=>buildReclamation(),maxSpeed:12,turnRate:0.15,beam:'meer'},
  pathfinder: {hull:'antari_pathfinder',race:'ANTARI',  cls:'PATHFINDER', model:'pf', file:'antari-pathfinder.glb',maxSpeed:12,turnRate:0.17,beam:'antari',
               glows:[[1.05,.08,4.4,.36],[-1.05,.08,4.4,.36],[0,-.3,4.45,.36]]},
  sentinel:   {hull:'bane_sentinel',    race:'BANE',    cls:'SENTINEL',   model:'sn', file:'bane-sentinel.glb',maxSpeed:11,turnRate:0.19,beam:'bane',
               glows:[[0,0,4.1,.6],[1.26,-.02,4.03,.24],[-1.26,-.02,4.03,.24]]},
  vanguard:   {hull:'echtar_vanguard',  race:'ECHTAR',  cls:'VANGUARD',   model:'vg', file:'echtar-vanguard.glb',maxSpeed:12,turnRate:0.19,beam:'echtar',
               glows:[[0,-.02,4.06,.34],[.78,.02,3.84,.27],[-.78,.02,3.84,.27]]},
  raptor:     {hull:'rayzine_raptor',   race:'RAYZINE', cls:'RAPTOR',     model:'rp', file:'rayzine-raptor.glb',maxSpeed:13,turnRate:0.18,beam:'rayzine',
               glows:[[.42,.02,4.15,.3],[-.42,.02,4.15,.3],[1.62,.3,4.07,.22],[-1.62,.3,4.07,.22]]},
};
const FLEET_IDS=Object.keys(FLEET);
for(const D of Object.values(FLEET))if(D.file)MODELS[D.model]='../shipyard/assets/'+D.file;
// drive, deck-light and shield colours per race (the film's two keep theirs)
Object.assign(LOOK,{
  pf:{eng:[1.0,2.8,4.8],core:[3.0,4.0,5.0],win:{vertexColors:true,color:new THREE.Color(2.6,2.7,2.9)},engPt:[1.0,2.5,4.6],shield:[0.4,1.4,2.6]},
  sn:{eng:[0.8,3.6,2.4],core:[2.6,4.6,3.6],win:{vertexColors:true,color:new THREE.Color(2.4,2.8,2.6)},engPt:[0.9,3.0,2.2],shield:[0.45,2.2,1.3]},
  vg:{eng:[2.6,1.3,4.8],core:[4.2,3.4,5.0],win:{color:new THREE.Color(3.2,2.0,0.8)},engPt:[2.4,1.3,4.4],shield:[1.6,0.9,2.8]},
  rp:{eng:[1.2,2.6,5.0],core:[3.4,3.9,5.0],win:{vertexColors:true,color:new THREE.Color(2.8,2.6,2.6)},engPt:[1.1,2.3,4.6],shield:[2.6,1.0,0.6]},
});
/* Wingtip strobes go on the real wingtips: the mean of the hull's vertices within 2% of the span of its outermost point on
   each side. The bounding box's mid-length put them in empty
   space beside any hull that isn't widest amidships (the Vanguard's swept wings). */
function wingtips(m){
  const v=new V3(), side=[{lim:Infinity,s:new V3(),k:0},{lim:-Infinity,s:new V3(),k:0}], pts=[];
  m.traverse(o=>{if(!o.isMesh||!o.geometry.attributes.position||/^engine_glow/.test(o.name))return;const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);pts.push(v.x,v.y,v.z);
      if(v.x<side[0].lim)side[0].lim=v.x;if(v.x>side[1].lim)side[1].lim=v.x;}});
  const tol=(side[1].lim-side[0].lim)*0.02;
  for(let i=0;i<pts.length;i+=3){const x=pts[i];
    if(x<=side[0].lim+tol){side[0].s.add(v.set(x,pts[i+1],pts[i+2]));side[0].k++;}
    if(x>=side[1].lim-tol){side[1].s.add(v.set(x,pts[i+1],pts[i+2]));side[1].k++;}}
  return side.map(e=>e.s.divideScalar(e.k||1));
}
function buildFromShipyard(D){
  const g=new THREE.Group(), m=dressModel(MODEL[D.model],D.model);g.add(m);
  m.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(m), c=box.getCenter(new V3()), h=box.getSize(new V3()).multiplyScalar(0.5), L=LOOK[D.model];
  g.userData={
    mounts:{},
    eng:D.glows.map(([x,y,z])=>mv(x,y,z)),engCol:L.engPt,
    shield:{c,ax:new V3(h.x*1.25+2,h.y*1.4+1.5,h.z*1.12),col:new THREE.Color(...L.shield)},
    hullAx:new V3(h.x*0.85,h.y*0.7,h.z*0.95),navs:wingtips(m)
  };
  return g;
}
const SIDE={player:{seed:1.3,y:18},enemy:{seed:4.1,y:24}};
const SEL={player:'sovereign',enemy:'reclamation',loc:'tauri'};

/* ---------- state ---------- */
const SK={on:false,t:0,over:null,overT:0,fast:false,auto:false,cam:'chase',log:[],farT:0};
window.SK=SK;
let PL,AI,ships=[],beams=[],sprites=[],torps=[],vents=[],eruptAt=25,lastStatic=0,hudT=0;
const _t1=new V3(),_t2=new V3(),_t3=new V3(),_qq=new Q(),_m=new THREE.Matrix4();
const keyDown={}, want={qip:false,heavy:false,all:false,snap:false};

function world(S,local,out){return out.copy(local).applyQuaternion(S.g.quaternion).add(S.g.position);}
const yawQ=S=>new Q().setFromAxisAngle(AX.y,S.yaw);
const fwd=(S,out)=>(out||new V3()).set(-Math.sin(S.yaw),0,-Math.cos(S.yaw));

/* ---------- weapon mounts from the tactical sheets ----------
   A sheet is the ship seen from above, bow up, traced from the same blueprint as the model. Each weapon box
   sits at its group's grid position; scaled bow-to-stern onto the model's main hull it lands on the matching
   spot of the top view, and a ray straight down puts it on the hull's upper surface. */
const RAY=new THREE.Raycaster();
function sheetMounts(S){
  const L=SSD_LAYOUTS[S.key], ship=SHIPS[S.key];
  const n=L.shapes[0].d.replace(/[MLZ]/g,' ').trim().split(/\s+/).map(Number);
  let y0=1e9,y1=-1e9;for(let i=1;i<n.length;i+=2){y0=Math.min(y0,n[i]);y1=Math.max(y1,n[i]);}
  S.g.position.set(0,0,0);S.g.quaternion.identity();S.g.updateMatrixWorld(true);
  const solids=[];let hull=null;
  S.g.traverse(o=>{if(!o.isMesh)return;const b=o.name.replace(/_\d+$/,'');if(b==='main_hull')hull=o;
    if(!/antenna|window|nav_light|glow|hangar|lance|panel_seam/.test(b))solids.push(o);});
  // a hull with no single main body (the Vanguard's V) maps onto the bounds of all of it
  const hb=new THREE.Box3();if(hull)hb.setFromObject(hull);else for(const o of solids)hb.expandByObject(o);
  const zB=hb.min.z, k=(hb.max.z-hb.min.z)/(y1-y0);
  const ids=new Set(Object.values(ship.weapons).flat().map(w=>w.id)), out={};
  const down=new V3(0,-1,0), o=new V3();
  for(const g of L.groups){
    const cols=g.cols||1;
    (g.ids||[]).forEach((id,i)=>{
      if(!ids.has(id))return;
      const sx=g.x+(i%cols)*L.grid+L.box/2, sy=g.y+Math.floor(i/cols)*L.grid+L.box/2;
      const x=(sx-L.centerX)*k, z=zB+(sy-y0)*k;
      let hit=null;
      for(let s=0;s<=12&&!hit;s++){RAY.set(o.set(x*(1-s/12),80,z),down);hit=RAY.intersectObjects(solids,false)[0];}
      out[id]=hit?hit.point.clone().add(_t1.set(0,0.3,0)):new V3(x,1.5,z);
    });
  }
  return out;
}

/* ---------- ships ---------- */
function makeShip(side,id,key){
  const D=FLEET[id], P=SIDE[side], g=D.build?D.build():buildFromShipyard(D);scene.add(g);
  const S={side,id,key,name:D.race+' '+D.cls,cls:D.cls,g,pos:new V3(),yaw:0,speed:0,throttle:0.7,maxSpeed:D.maxSpeed,turnRate:D.turnRate,
    turnIn:0,bank:0,climb:0,vy:0,pitch:0,bearMemo:new Map(),off:new V3(),offV:new V3(),shake:0,roll:0,seed:P.seed,y:P.y,beam:D.beam,
    shieldUp:1,flareHit:0,charge:{},cat:{},dead:false,deadT:0,ai:{mode:'close'},snaps:SNAP_USES,snapT:0};
  S.mounts=sheetMounts(S);
  const lance=g.userData.mounts.lance;                       // the Reclamation's lances fire from its emitters
  if(lance)['hbA','hbB','hbC'].forEach((id,i)=>{if(lance[i])S.mounts[id]=lance[i].local.clone();});
  for(const {category,weapon} of Bridge.weaponsOf(S.key)){S.charge[weapon.id]=0;S.cat[weapon.id]=category;}  // weapons start armed
  // a missile rack carries what its spaces hold (drones.js DRONE_RACKS); reloads are not modelled
  S.ammo={};(SHIPS[S.key].weapons.drones||[]).forEach((w,i)=>{
    S.ammo[w.id]=S.key.replace(/_2$/,'')==='rayzine_raptor'&&i>=RAPTOR_RACKS?0:Math.floor((DRONE_RACKS[w.rack]||DRONE_RACKS.A).spaces/ASM.space);});
  S.shieldMesh=shieldMesh(g.userData.shield);scene.add(S.shieldMesh);
  return S;
}
function placeShip(S){
  S.g.position.copy(S.pos).add(S.off);
  S.g.quaternion.setFromEuler(new THREE.Euler(S.pitch,S.yaw,S.bank+S.roll,'YXZ'));
}
/** Bearing of point P from ship A for the engine (degrees clockwise from the bow, height ignored). `who` names
    what is at P (a ship, a seeker); near top or bottom dead centre the bearing it last had is kept. */
function bear(A,P,who){
  const v=_bv.subVectors(P,A.pos), d=v.length();
  const last=A.bearMemo.get(who);
  if(d>0&&Math.abs(v.y)/d>DEAD_ZONE&&last!=null)return last;
  const b=Bridge.bearingOf(A.pos,yawQ(A),P);
  A.bearMemo.set(who,b);return b;
}
const _bv=new V3();

/* ---------- helm ---------- */
function helm(S,dt){
  if(S.dead){S.speed*=Math.exp(-0.4*dt);S.turnIn=0;}
  let rate=S.turnRate;
  if(S.snapT>0){                                             // rapid speed turn: bleed the speed, spin as it goes
    S.snapT=Math.max(0,S.snapT-dt);
    S.speed+=(SNAP_FLOOR-S.speed)*Math.min(1,dt*3);
    rate=lerp(S.turnRate,SNAP_RATE,sm(0.6,0.15,S.speed/S.maxSpeed));
  }else S.speed+=(S.throttle*S.maxSpeed-S.speed)*Math.min(1,dt*0.9);   // about a second to answer the throttle
  S.yaw+=S.turnIn*rate*dt;
  S.bank+=(-S.turnIn*0.16-S.bank)*Math.min(1,dt*1.5);
  S.pos.addScaledVector(fwd(S,_t1),S.speed*dt);
  // the star's corona (or a planet's surface) is no place for a cruiser
  const hx=S.pos.x-HZ.x, hz=S.pos.z-HZ.z, r=Math.hypot(hx,hz), k=hzKeep(S.pos.y);
  if(r<k){S.pos.x=HZ.x+hx*k/r;S.pos.z=HZ.z+hz*k/r;if(STAR_ON&&!S.dead&&!SK.over)starHit(S);}
  // climb and dive: vertical speed follows the stick, up to the speed the pitch limit allows; the hull pitches
  // to match its flight path and levels when it holds height
  let c=S.dead?0:S.climb;
  if(S.pos.y>ALT_LIMIT-15&&c>0)c*=Math.max(0,(ALT_LIMIT-S.pos.y)/15);
  if(S.pos.y<-ALT_LIMIT+15&&c<0)c*=Math.max(0,(S.pos.y+ALT_LIMIT)/15);
  S.vy+=(c*Math.tan(MAX_PITCH)*Math.max(S.speed,2)-S.vy)*Math.min(1,dt*0.8);
  S.pos.y=clamp(S.pos.y+S.vy*dt,-ALT_LIMIT,ALT_LIMIT);
  S.pitch+=(Math.atan2(S.vy,Math.max(S.speed,2))-S.pitch)*Math.min(1,dt*2);
}

function selfDestruct(S,T){
  if(!SD_ON||S.dead||SK.over)return;
  note(`${S.name} SELF-DESTRUCTS`,S.side==='player'?'hurt':'hit');stat(S,'self_destruct');
  reactorBlast(S,T);
}
function starHit(S){
  note(LOC.planet?`${S.name} GOES DOWN ON ${LOC.name.toUpperCase()}`:`${S.name} FLIES INTO THE STAR`,S.side==='player'?'hurt':'hit');
  stat(S,LOC.planet?'planet':'star');
  reactorBlast(S,ships.find(x=>x!==S));
}
/** Where the hazard lies from S: distance from its axis (r), its edge there (k), the distance to that edge (d), its
    bearing (clockwise from the bow) and whether the course held now would cross the edge (+ STAR_PAD). */
function starThreat(S){
  const r=Math.hypot(S.pos.x-HZ.x,S.pos.z-HZ.z), k=hzKeep(S.pos.y);
  const b=Bridge.bearingOf(S.pos,yawQ(S),_t3.set(HZ.x,S.pos.y,HZ.z)), rel=b>180?b-360:b;
  const ahead=Math.abs(rel)<90, miss=r*Math.sin(Math.abs(rel)*Math.PI/180);
  return {r,k,d:r-k,rel,course:STAR_ON&&ahead&&miss<k+STAR_PAD};
}
// the reactor going: the ship is lost and the blast reaches the other ship by range
function reactorBlast(S,T){
  const rh=Bridge.hexRange(S.pos.distanceTo(T.pos)), dmg=Math.round(SD_DMG*(SD_FALL[rh]||0));
  kill(S);S.deadT=3.19;                                     // straight to the reactor going
  if(T.dead)return;
  if(dmg>0){stat(S,'dmg_blast',dmg);landOn(T,S,{damage:dmg},[{label:'Blast',damage:dmg}]);}
  else note(`${T.name} is clear of the blast (${rh} hexes)`,'dim');
}
function beaten(S,T){
  if(damageFrac(S)>=SD_AI_FRAC)return true;
  return Bridge.weaponsOf(S.key).every(p=>pdHeld(S.key,p)||Bridge.weaponLost(S.key,p.weapon.id)||S.ammo[p.weapon.id]===0);
}
function snapTurn(S){
  if(S.dead||SK.over||S.snapT>0||S.snaps<=0)return false;
  S.snaps--;S.snapT=SNAP_S;stat(S,'snaps');
  note(`${S.name}: rapid speed turn${S.snaps?` (${S.snaps} left)`:' (last one)'}`,S.side==='player'?'hit':'hurt');
  return true;
}

/* ---------- the computer captain: fight at the range your weapons win ----------
   Each ship's damage per second at a range is read off the engine: every weapon that fires on ships (point defence
   is left out), its expected damage at that range from weaponShot() (a fusion torpedo's warhead as it fades, a
   missile's warhead while it can reach), over its arming time. Arcs are ignored there; they decide the angle below.
   A captain's preferred range against this enemy is where its own rate beats the enemy's by the most, no closer
   than MIN_PREF hexes. So brawlers (heavy weapons that hit hardest close in) press in and standoff ships (missiles,
   flat-curved guns) hang back; when the two meet, speed and turn rate decide who gets the range they want.
   Too far: close, bow on. Too close: open, the enemy on a rear quarter. In the band: turn to the angle where the
   armed weapons that bear do the most damage at this range. Height: a brawler fights at the enemy's height (height
   is range); a standoff ship picks heights as before and opens in height too. Seekers coming in: change height
   away from them. Plans are re-read every half second, so damage to weapons changes them. */
const MIN_PREF=6, PREF_RS=[6,7,8,10,12,15,18,22,26,30,35];
const TRY_BEARINGS=[0,30,60,90,120,150,180,210,240,270,300,330];
function weaponRate(key,c,w,r){
  if(pdHeld(key,{category:c,weapon:w}))return 0;
  let e=0;
  if(c==='plasma'){if(r<=ftReach(w.size)*0.7)e=plasmaWarhead(w.size,r,false)*0.85;}
  else if(c==='drones'){if(r<=ASM_SPEED*ASM_LIFE/HEX_U*0.6)e=ASM_WARHEAD*0.5;}
  else{const sh=weaponShot(c,w,effectiveRange(key,r),null,{trueRange:r,attackerKey:key});if(sh.canFire)e=sh.expected||0;}
  return e/armS(c,w);
}
// a rack that is empty plans for nothing (a captain used to keep standing off for missiles it had already fired)
const shipRate=(key,r)=>{const S=ships.find(x=>x.key===key);return Bridge.weaponsOf(key).filter(p=>!Bridge.weaponLost(key,p.weapon.id)&&!(S&&S.ammo[p.weapon.id]===0)).reduce((a,p)=>a+weaponRate(key,p.category,p.weapon,r),0);};
function preferredRange(S,T){
  let best=MIN_PREF,bv=-1e9;
  for(const r of PREF_RS){const v=shipRate(S.key,r)-shipRate(T.key,r);if(v>bv+1e-6){bv=v;best=r;}}
  return best;
}
function bestBearing(S,rh){
  let best=0,bv=-1;
  for(const b of TRY_BEARINGS){
    let v=0;
    for(const p of Bridge.bearingWeapons(S.key,b))v+=weaponRate(S.key,p.category,p.weapon,rh)*(S.charge[p.weapon.id]<=0?1:0.4);
    const off=Math.min(b,360-b);
    if(v>bv+1e-6||(Math.abs(v-bv)<=1e-6&&off<Math.min(best,360-best))){bv=v;best=b;}
  }
  return best>180?best-360:best;
}
function captain(S,T,dt){
  if(S.dead||T.dead){S.turnIn=0;S.climb=0;return;}
  const b=bear(S,T.pos,T), rel=b>180?b-360:b, range=S.pos.distanceTo(T.pos), rh=Bridge.hexRange(range);
  S.ai.planT=(S.ai.planT||0)-dt;
  if(S.ai.planT<=0){S.ai.planT=0.5;S.ai.pref=preferredRange(S,T);S.ai.angle=bestBearing(S,rh);}
  // pinned: the enemy aft and the range not opening. Its guns want it elsewhere: rapid speed turn
  if(Math.abs(rel)>SNAP_AFT&&rh<=30&&S.snapT<=0){
    if(!(S.ai.tailT>0))S.ai.tailR=range;
    S.ai.tailT=(S.ai.tailT||0)+dt;
    if(range>S.ai.tailR+3*HEX_U){S.ai.tailT=dt;S.ai.tailR=range;}
  }else S.ai.tailT=0;
  if(S.ai.tailT>SNAP_TAIL&&Math.abs(S.ai.angle)<SNAP_AFT&&snapTurn(S))S.ai.tailT=0;
  const pref=S.ai.pref*HEX_U, lo=Math.max(MIN_PREF*HEX_U*0.8,pref*0.75), hi=pref*1.25+8, brawler=S.ai.pref<=12;
  S.ai.altT=(S.ai.altT||0)-dt;
  if(S.ai.altT<=0){S.ai.altT=14+Math.random()*16;S.ai.alt=(Math.random()*2-1)*60;}
  let wantY=brawler&&range<hi+80?clamp(T.pos.y+(S.pos.y>=T.pos.y?6:-6),-90,90):S.ai.alt;
  if(range<lo&&!brawler)wantY=clamp(T.pos.y+(S.pos.y>=T.pos.y?40:-40),-90,90);
  const inbound=seekers.find(x=>x.on&&x.T===S&&x.p.distanceTo(S.pos)<60);
  if(inbound)wantY=S.pos.y+(inbound.p.y>S.pos.y?-30:30);
  S.climb=clamp((wantY-S.pos.y)/18,-1,1);
  let aim;
  if(range>hi){aim=rel;S.throttle=1;}                                  // close, bow on
  else if(range<lo){aim=rel>=0?rel-150:rel+150;S.throttle=1;}          // open: the enemy on a rear quarter
  else{aim=rel-S.ai.angle;S.throttle=0.6;}                            // in the band: bring the guns to bear
  if(S.snapT>0){aim=rel-S.ai.angle;S.throttle=1;}                      // spinning: come round to the guns, then go
  aim=((aim+540)%360)-180;
  // the star comes first, but only as a limit on the course: the heading it wants may not bring the star nearer
  // the bow than the angle that clears it by half a turning circle at this distance; close in, slow to turn tighter
  if(STAR_ON){
    const st=starThreat(S);
    if(st.d<WARN_D){
      const clear=st.k+STAR_PAD+0.5*S.speed/S.turnRate;        // half a turning circle of margin
      const need=st.r>clear?Math.asin(clear/st.r)*180/Math.PI+4:100;
      const after=((st.rel-aim+540)%360)-180;                  // where the star would bear on the new heading
      if(Math.abs(after)<need){const side=st.rel!==0?Math.sign(st.rel):(aim<=0?1:-1);aim=st.rel-side*need;}   // away from the side it is on now: never swing the bow across it
      if(st.course&&st.d<CRIT_D)S.throttle=Math.min(S.throttle,0.5);
    }
  }
  S.turnIn=clamp(-aim/25,-1,1);
  tryFire(S,T,lanceHold(S,T)?p=>p.category!=='hellbores':null);
  // beaten, a shield down toward the enemy and the enemy in close: take it with you
  if(SD_ON&&S.ai.planT===0.5&&rh<=SD_AI_RH&&!S.dead&&!T.dead){
    const f=Bridge.shields(S.key)[Bridge.shieldFacing(bear(S,T.pos,T))];
    if(f.left<=0&&beaten(S,T))selfDestruct(S,T);
  }
}
/* A lance ship's computer captain holds its Helios Lances until its other direct-fire weapons that bear have
   fired and the target has a weak shield to exploit: the shield facing it at half or less, or any shield at a
   quarter or less (lance damage envelops all six). Inside 6 hexes it fires regardless: that is the range it
   fought to reach. The player fires as they choose. */
function lanceHold(S,T){
  if(!S.cat||!Object.values(S.cat).includes('hellbores'))return false;
  const b=bear(S,T.pos,T), rh=Bridge.hexRange(S.pos.distanceTo(T.pos));
  const sh=Bridge.shields(T.key), face=sh[Bridge.shieldFacing(bear(T,S.pos,S))];
  if(rh<=6)return false;
  const weak=face.left<=face.max*0.5||Object.values(sh).some(x=>x.left<=x.max*0.25);
  const others=Bridge.bearingWeapons(S.key,b).filter(p=>p.category!=='hellbores'&&!SEEKERS.has(p.category)&&!pdHeld(S.key,p)&&Bridge.reaches(S.key,p.category,p.weapon,rh));
  const spent=others.every(p=>S.charge[p.weapon.id]>0);
  return !(weak&&spent);
}

/* ---------- firing: the engine rolls, the battle draws ---------- */
// seeking weapons launch when the target is well inside what they can reach: a fusion torpedo's warhead
// fades with the hexes it flies, a missile has its endurance
function seekerReaches(p,rh){return p.category==='plasma'?rh<=ftReach(p.weapon.size)*0.7:rh<=ASM_SPEED*ASM_LIFE/HEX_U*0.6;}
/* Point defence is automatic: the type-3 projectors (QIP-3, and the multi-shot QIP-R and QIP-T mounts) are held
   for seekers and fire on them by themselves (pointDefence); they never fire on a ship. ?pdfire in the address
   lets them fire on ships as well, as the tactical game does. */
const PD_ONLY=!new URLSearchParams(location.search).has('pdfire');
// The Raptor's ten QIP-3s are its close-in punch: they fire on ships as well as defending against seekers.
// ?raptorpd holds them for point defence like everyone else's.
const PD_FIRE_HULLS=new URLSearchParams(location.search).has('raptorpd')?new Set():new Set(['rayzine_raptor']);
const pdHeld=(key,p)=>PD_ONLY&&isPD(p)&&!PD_FIRE_HULLS.has(key.replace(/_2$/,''));
// balance counters per side (headless sweeps read them through SK.info().stats)
const STATS={};
function stat(S,k,v){const o=STATS[S.side]||(STATS[S.side]={});o[k]=(o[k]||0)+(v==null?1:v);}
const isPD=p=>p.category==='phasers'&&String(p.weapon.type)==='3';
function tryFire(S,T,filter){
  if(S.dead||T.dead)return 0;
  const bearing=bear(S,T.pos,T), rangeU=S.pos.distanceTo(T.pos), rh=Bridge.hexRange(rangeU);
  const all=Bridge.bearingWeapons(S.key,bearing).filter(p=>(!filter||filter(p))&&!pdHeld(S.key,p)&&S.charge[p.weapon.id]<=0&&S.ammo[p.weapon.id]!==0);
  const seek=all.filter(p=>SEEKERS.has(p.category)&&seekerReaches(p,rh));
  for(const p of seek){stat(S,'launched_'+p.category);S.charge[p.weapon.id]=armS(p.category,p.weapon);if(S.ammo[p.weapon.id]>0)S.ammo[p.weapon.id]--;launchSeeker(S,T,S.mounts[p.weapon.id]||new V3(0,1,0),p);}
  const picks=all.filter(p=>!SEEKERS.has(p.category)&&Bridge.reaches(S.key,p.category,p.weapon,rh));
  if(!picks.length)return seek.length;
  const volley=Bridge.fire(S.key,picks,rh);
  for(const p of picks){S.charge[p.weapon.id]=armS(p.category,p.weapon);stat(S,'fired_'+p.category);stat(S,'fired_range',rh);stat(S,'fired_n');}
  const now={damage:0,enveloping:0,splash:null}, landed=[];
  for(const shot of volley.shots){
    if(!shot.canFire)continue;
    const mount=S.mounts[shot.id]||new V3(0,1,0);
    if(shot.category==='photons'){launchTorp(S,T,mount,shot);continue;}
    if(shot.category!=='photons')stat(S,'dmg_'+shot.category,shot.splashing&&shot.splash?shot.splash.reduce((a,b)=>a+b,0):shot.damage);
    if(shot.enveloping)now.enveloping+=shot.damage;else if(!shot.splashing)now.damage+=shot.damage;
    if(shot.splashing&&shot.splash&&shot.damage>0){now.splash=now.splash||[0,0,0];shot.splash.forEach((v,i)=>now.splash[i]+=v);}
    landed.push(shot);
    beamFx(shot.category==='hellbores'?'lance':S.beam,S,T,mount,shot.damage>0,shot.category!=='phasers');
  }
  if(landed.length){
    if(now.damage>0||now.enveloping>0||now.splash)landOn(T,S,now,landed);
    else note(`${S.name}: ${short(tq(labelsOf(landed)))} — miss`,'dim');
  }
  return picks.length+seek.length;
}
function labelsOf(shots){const c={};for(const s of shots)c[s.label]=(c[s.label]||0)+1;return Object.entries(c).map(([k,v])=>v>1?v+'× '+k:k).join(', ');}
const tq=s=>(typeof qtText==='function'?qtText(s):s);
const short=s=>s.replace(/Quantum Torpedo/g,'QT').replace(/Helios Lance/g,'HL').replace(/Fusion Torpedo/g,'FT').replace(/Ion Shear Cannon/g,'ISH').replace(/Particle Driver/g,'PD');

// land a volley on T from S: the engine marks shields and boxes, the battle shows where
function landOn(T,S,volley,shots){
  if(T.dead)return;
  const from=bear(T,S.pos,S);
  const recs=Bridge.land(T.key,from,volley);
  // the bridge returns the direct volley first, then the enveloping one: name the weapons behind each
  const direct=shots.filter(x=>!x.enveloping&&!x.splashing), env=shots.filter(x=>x.enveloping||x.splashing);
  for(const r of recs){
    const by=r.split?env:direct;
    const absorbed=r.split?r.split.reduce((a,x)=>a+x.absorbed,0):r.shieldAbsorbed;
    if(absorbed>0){T.shieldUp=1;const dir=strikePoint(T,S.pos,null,_t2);shieldHit(T,dir,1.4);T.flareHit=Math.min(0.9,T.flareHit+0.35);
      if(r.split)for(let i=0;i<4;i++){const a=Math.random()*6.283;shieldHit(T,dir.clone().add(_t1.set(Math.cos(a),0.4*Math.sin(a*1.7),Math.sin(a))).normalize(),0.6);}
      impactFx(T,_t2,S.side==='player'?[1.4,2.4,4]:[4,2,0.7],absorbed>=10);}
    if(r.internal>0){T.shieldUp=0;strikePoint(T,S.pos,null,_t2);hullBlast(T,_t2,r.internal>=8);T.shieldUp=1;}
    const what=r.split?`${absorbed} on the shields`:`${absorbed} on shield #${r.shield}`;
    const thru=r.internal>0?` · ${r.internal} through: ${tq(r.hits.map(h=>h.label).join(', '))}`:'';
    note(`${S.name} ${short(tq(labelsOf(by.length?by:shots)))} → ${what}${thru}`,S.side==='player'?'hit':'hurt');
    if((r.shieldAbsorbed||0)+(r.internal||0)>0||r.split)SK.lastDmg=SK.t;
    if(r.destroyed||Bridge.destroyed(T.key))kill(T);
  }
  if(!recs.length)note(`${S.name}: ${tq(labelsOf(shots))} — no damage`,'dim');
}

/* ---------- visuals for shots ---------- */
// beam colours, glow then core, per race (the Helios Lance has its own)
const BEAM={qin:[[0.6,1.5,3.4],[2.4,3.4,4.6]],meer:[[3.4,1.3,0.4],[4.6,3.4,2.0]],antari:[[0.5,2.0,3.2],[2.6,4.0,4.6]],
  bane:[[0.5,2.8,1.4],[2.6,4.6,3.2]],echtar:[[2.2,0.9,3.6],[4.0,3.0,4.8]],rayzine:[[3.6,0.9,0.6],[4.8,3.0,2.4]],lance:[[3.6,1.9,0.5],[5.5,4.6,3.0]]};
// a beam from S's mount to T (a hit, or past it for a miss), or to a point (point defence on a seeker)
function beamFx(kind,S,T,mount,hit,heavy,pt){
  const b=beams.find(x=>!x.on)||beams[0];
  const pal=BEAM[kind]||BEAM.qin, lance=kind==='lance';
  b.mat.uniforms.uCol.value.setRGB(...pal[0]);b.mat.uniforms.uCore.value.setRGB(...pal[1]);
  b.mat.uniforms.uKind.value=lance?1:0;b.mat.uniforms.uSeed.value=Math.random()*20;
  const sh=T?T.g.userData.shield:null;
  // a miss is aimed past the shield, off to one side
  const aim=hit||pt?null:sh.c.clone().add(_t1.set((Math.random()<0.5?-1:1)*sh.ax.x*(1.4+Math.random()),(Math.random()-0.5)*sh.ax.y,(Math.random()-0.5)*sh.ax.z));
  Object.assign(b,{on:true,kind,S,T,pt:pt||null,mount:mount.clone(),t:0,dur:lance?1.3:heavy?0.45:pt?0.2:0.32,w:lance?1.6:heavy?0.6:pt?0.25:0.38,aim,hit,tick:0});
  world(S,mount,_t1);
  const fc=pal[0].map(v=>v*1.1);
  flash(_t1.x,_t1.y,_t1.z,lance?3:heavy?1.8:1.2,lance?11:heavy?6:4,lance?0.6:0.25,...fc);
}
function beamTick(b,dt,t){
  b.t+=dt;if(b.t>=b.dur){b.on=false;b.m.visible=false;return;}
  const from=world(b.S,b.mount,new V3());
  let end;
  if(b.pt){end=_t2.copy(b.pt);}
  else if(b.hit){strikePoint(b.T,from,null,_t2);end=_t2;}
  else{end=world(b.T,b.aim,_t2);end.sub(from).multiplyScalar(1.6).add(from);}
  const u=b.mat.uniforms;u.uA.value.copy(from);u.uB.value.copy(end);
  const env=b.kind==='lance'?sm(0,0.12,b.t)*(1-sm(b.dur-0.35,b.dur,b.t)):sm(0,0.03,b.t)*(1-sm(b.dur-0.1,b.dur,b.t));
  u.uI.value=env*(b.kind==='lance'?1.25:1);u.uW.value=b.w*(b.kind==='lance'?(0.85+0.15*Math.sin(t*41)):1);b.m.visible=true;
  if(b.hit&&b.kind==='lance'){b.tick-=dt;if(b.tick<=0){b.tick=0.12;impactFx(b.T,end,[3.6,2.2,0.8],Math.random()<0.2);}}
}
function launchTorp(S,T,mount,shot){
  world(S,mount,_t1);
  const v=fwd(S,_t2).multiplyScalar(28);
  const sh=T.g.userData.shield;
  const aim=shot.hit&&shot.damage>0?null:sh.c.clone().add(new V3((Math.random()<0.5?-1:1)*sh.ax.x*1.8,(Math.random()-0.5)*sh.ax.y,0));
  const b={on:true,S,T,shot,p:_t1.clone(),v:v.clone(),aim,age:0,trail:[],head:sprites.pop()||glowSprite(),tr:[]};
  for(let i=0;i<7;i++)b.tr.push(sprites.pop()||glowSprite());
  torps.push(b);
  flash(_t1.x,_t1.y,_t1.z,2,9,0.4,1.8,3,5);
  burst(_t1.x,_t1.y,_t1.z,14,[1.2,2.2,4],[6,20],[0.2,0.5],v.x*0.4,v.y*0.4,v.z*0.4);
}
function torpTick(b,dt){
  b.age+=dt;
  const T=b.T, sh=T.g.userData.shield;world(T,b.aim||sh.c,_t1);
  const want=_t2.subVectors(_t1,b.p).normalize().multiplyScalar(Math.min(70,28+b.age*50));
  b.v.lerp(want,Math.min(1,dt*(1.2+b.age*3)));b.p.addScaledVector(b.v,dt);
  b.trail.unshift(b.p.clone());if(b.trail.length>22)b.trail.length=22;
  if(!SK.fast){
    const fl=0.85+Math.random()*0.3;
    b.head.visible=true;b.head.position.copy(b.p);b.head.scale.setScalar(1.9*fl);b.head.material.color.setRGB(3.0*fl,4.2*fl,6.5*fl);
    b.tr.forEach((s,i)=>{const p=b.trail[Math.min(b.trail.length-1,(i+1)*3)];s.visible=!!p;if(p){s.position.copy(p);const k=1-i/b.tr.length;s.scale.setScalar(1.3*k+0.3);s.material.color.setRGB(0.5*k,1.1*k,2.8*k);}});
  }
  _qq.copy(T.g.quaternion).invert();
  const Lp=_t3.copy(b.p).sub(T.g.position).applyQuaternion(_qq).sub(sh.c).divide(sh.ax);
  const arrived=!b.aim&&Lp.length()<=1, gone=b.age>(b.aim?3.2:6);
  if(arrived){stat(b.S,'dmg_photons',b.shot.damage);landOn(T,b.S,{damage:b.shot.damage},[b.shot]);done(b);}
  else if(gone){if(b.aim)note(`${b.S.name} QT — miss`,'dim');flash(b.p.x,b.p.y,b.p.z,1,4,0.3,1.2,2,3.5);done(b);}
  function done(b){b.on=false;b.head.visible=false;b.tr.forEach(s=>s.visible=false);sprites.push(b.head,...b.tr);}
}
/* ---------- seeking weapons: fusion torpedoes and missiles ----------
   They fly at their tactical speeds (hexes a turn) and steer for the target. A fusion torpedo's warhead is the
   engine's plasmaWarhead() for the hexes it has flown, less half the damage point defence has done to it; a missile
   carries its type's warhead and dies to its damage rating. On reaching the shield the warhead is marked by the
   engine (resolveVolley) on the facing it comes in on. The target's short-range projectors (QIP-3) fire on a seeker
   inside their reach, if armed. */
const SEEK_COL={plasma:{head:[4.5,2.6,1.0],trail:[2.6,1.0,0.3]},drones:{head:[3.8,3.4,2.6],trail:[0.9,0.95,1.1]}};
/* A missile is a body you can see: a slim hull with a pointed nose and four tail fins, about 2.2 units long,
   flying nose-first, with a small white drive flame at the tail and a long thin pale exhaust trail. A fusion
   torpedo stays a ball of orange plasma with a short fat trail and no body. */
let MISSILE_GEO=null;const MISSILE_POOL=[];
function missileMesh(){
  if(MISSILE_POOL.length)return MISSILE_POOL.pop();
  if(!MISSILE_GEO){
    const parts=[];
    const body=new THREE.CylinderGeometry(0.13,0.15,1.6,10);body.rotateX(Math.PI/2);parts.push(body);
    const nose=new THREE.ConeGeometry(0.13,0.55,10);nose.rotateX(Math.PI/2);nose.translate(0,0,1.075);parts.push(nose);
    for(let i=0;i<4;i++){const f=new THREE.BoxGeometry(0.03,0.32,0.4);f.translate(0,0.27,-0.62);f.rotateZ(i*Math.PI/2);parts.push(f);}
    const merged=new THREE.BufferGeometry(), pos=[], nrm=[];
    for(const g of parts){const q=g.toNonIndexed();pos.push(...q.attributes.position.array);nrm.push(...q.attributes.normal.array);}
    merged.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));merged.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));
    MISSILE_GEO=merged;
  }
  const m=new THREE.Mesh(MISSILE_GEO,new THREE.MeshStandardMaterial({color:0x9aa3ad,metalness:0.6,roughness:0.45,emissive:new THREE.Color(0.05,0.05,0.06)}));
  m.visible=false;scene.add(m);return m;
}
const _mz=new V3(0,0,1);
const seekers=[];
function seekerWarhead(b){return b.category==='plasma'?Math.max(0,plasmaWarhead(b.size,Math.round(b.flown/HEX_U),false)-Math.floor(b.taken/2)):ASM_WARHEAD;}
function launchSeeker(S,T,mount,p){
  world(S,mount,_t1);
  const ft=p.category==='plasma', dir=_t2.subVectors(T.pos,_t1).normalize();
  const b={on:true,S,T,category:p.category,id:p.weapon.id,label:p.weapon.label,size:p.weapon.size,p:_t1.clone(),
    v:dir.clone().multiplyScalar(ft?FT_SPEED:ASM_SPEED).addScaledVector(fwd(S,_t3),S.speed*0.5),age:0,flown:0,taken:0,
    trail:[],head:sprites.pop()||glowSprite(),tr:[]};
  for(let i=0;i<(ft?7:10);i++)b.tr.push(sprites.pop()||glowSprite());
  if(!ft)b.mesh=missileMesh();
  seekers.push(b);
  const c=SEEK_COL[p.category].head;
  flash(_t1.x,_t1.y,_t1.z,ft?2:1.2,ft?8:4,0.35,...c);
  note(`${S.name} launches ${short(tq(p.weapon.label))}`,S.side==='player'?'hit':'hurt');
}
function seekerTick(b,dt){
  const T=b.T, sh=T.g.userData.shield, ft=b.category==='plasma', spd=ft?FT_SPEED:ASM_SPEED;
  b.age+=dt;
  if(T.dead){seekerDone(b,true);return;}
  world(T,sh.c,_t1);
  const want=_t2.subVectors(_t1,b.p).normalize().multiplyScalar(spd);
  b.v.lerp(want,Math.min(1,dt*(ft?1.6:2.4)));b.v.setLength(spd);
  b.p.addScaledVector(b.v,dt);b.flown+=spd*dt;
  b.trail.unshift(b.p.clone());if(b.trail.length>22)b.trail.length=22;
  if(!SK.fast){
    const fl=0.85+Math.random()*0.3, c=SEEK_COL[b.category];
    if(ft){b.head.visible=true;b.head.position.copy(b.p);b.head.scale.setScalar(2.2*fl);}
    else{                                                  // the body, nose along its flight; the drive flame at its tail
      const d=_t3.copy(b.v).normalize();
      b.mesh.visible=true;b.mesh.position.copy(b.p);b.mesh.quaternion.setFromUnitVectors(_mz,d);
      b.head.visible=true;b.head.position.copy(b.p).addScaledVector(d,-0.95);b.head.scale.setScalar(0.85*fl);
    }
    b.head.material.color.setRGB(c.head[0]*fl,c.head[1]*fl,c.head[2]*fl);
    b.tr.forEach((s,i)=>{const p=b.trail[Math.min(b.trail.length-1,(i+1)*(ft?3:2))];s.visible=!!p;if(p){s.position.copy(p);const k=1-i/b.tr.length;s.scale.setScalar(ft?1.5*k+0.3:0.45*k+0.15);s.material.color.setRGB(c.trail[0]*k,c.trail[1]*k,c.trail[2]*k);}});
  }
  pointDefence(T,b);
  if(!b.on)return;
  const warhead=seekerWarhead(b);
  if(ft&&warhead<=0){note(`${b.S.name} ${short(tq(b.label))} — spent`,'dim');seekerDone(b,true);return;}
  if(!ft&&b.age>ASM_LIFE){note(`${b.S.name} ${short(tq(b.label))} — out of fuel`,'dim');seekerDone(b,true);return;}
  _qq.copy(T.g.quaternion).invert();
  const Lp=_t3.copy(b.p).sub(T.g.position).applyQuaternion(_qq).sub(sh.c).divide(sh.ax);
  if(Lp.length()<=1){
    stat(b.S,'seeker_hits');stat(b.S,'dmg_'+b.category,warhead);
    const recs=Bridge.land(T.key,bear(T,b.p,b),{damage:warhead});
    for(const r of recs){
      if(r.shieldAbsorbed>0){const dir=strikePoint(T,b.p,null,_t2);shieldHit(T,dir,1.4);T.flareHit=Math.min(0.9,T.flareHit+0.35);impactFx(T,_t2,SEEK_COL[b.category].head,warhead>=10);}
      if(r.internal>0){T.shieldUp=0;strikePoint(T,b.p,null,_t2);hullBlast(T,_t2,r.internal>=8);T.shieldUp=1;}
      const thru=r.internal>0?` · ${r.internal} through: ${tq(r.hits.map(h=>h.label).join(', '))}`:'';
      note(`${b.S.name} ${short(tq(b.label))} → ${r.shieldAbsorbed} on shield #${r.shield}${thru}`,b.S.side==='player'?'hit':'hurt');
      if((r.shieldAbsorbed||0)+(r.internal||0)>0||r.split)SK.lastDmg=SK.t;
      if(r.destroyed||Bridge.destroyed(T.key))kill(T);
    }
    seekerDone(b,false);
  }
}
function pointDefence(T,b){
  if(T.dead)return;
  const d=T.pos.distanceTo(b.p), rh=Bridge.hexRange(d);
  if(rh>3)return;
  for(const p of Bridge.bearingWeapons(T.key,bear(T,b.p,b))){
    if(p.category!=='phasers'||String(p.weapon.type)!=='3'||T.charge[p.weapon.id]>0)continue;
    if(!Bridge.reaches(T.key,'phasers',p.weapon,rh))continue;
    const v=Bridge.fire(T.key,[p],rh);T.charge[p.weapon.id]=armS('phasers');
    b.taken+=v.damage;stat(T,'pd_shots');
    beamFx(T.beam,T,null,T.mounts[p.weapon.id]||new V3(0,1,0),true,false,b.p);
    const killed=b.category==='plasma'?seekerWarhead(b)<=0:b.taken>=ASM.damage;
    if(v.damage>0)burst(b.p.x,b.p.y,b.p.z,8,[3,2.4,1.6],[6,24],[0.15,0.4]);
    if(killed){stat(T,'pd_kills');note(`${T.name} point defence destroys ${short(tq(b.label))}`,T.side==='player'?'hit':'hurt');
      flash(b.p.x,b.p.y,b.p.z,2,10,0.4,4,3,1.6);burst(b.p.x,b.p.y,b.p.z,30,[4,2.6,1.2],[10,50],[0.2,0.6]);seekerDone(b,true);return;}
  }
}
function seekerDone(b,fizzle){
  b.on=false;b.head.visible=false;b.tr.forEach(s=>s.visible=false);sprites.push(b.head,...b.tr);
  if(b.mesh){b.mesh.visible=false;MISSILE_POOL.push(b.mesh);b.mesh=null;}
  if(fizzle)flash(b.p.x,b.p.y,b.p.z,1,4,0.3,...SEEK_COL[b.category].trail);
}
function impactFx(T,p,col,big){
  flash(p.x,p.y,p.z,big?3:1.4,big?18:7,big?0.55:0.3,...col);
  burst(p.x,p.y,p.z,big?40:10,col,[8,big?60:30],[0.2,big?0.9:0.45]);
}
function hullBlast(T,p,big){
  explode(p,T,big?'big':'small');
  flash(p.x,p.y,p.z,4,big?26:12,big?0.7:0.4,3.4,1.9,0.8);
  burst(p.x,p.y,p.z,big?90:30,[3.5,1.6,0.45],[10,big?70:40],[0.5,1.6]);
  burst(p.x,p.y,p.z,big?40:12,[4,3.6,2.8],[30,120],[0.12,0.35]);
  burst(p.x,p.y,p.z,big?30:10,[1.2,0.55,0.25],[4,20],[1.5,3.2]);
  const L=_t1.copy(p).sub(T.g.position).applyQuaternion(_qq.copy(T.g.quaternion).invert()).clone();
  vents.push({T,local:L,t:0,life:big?40:14,rate:big?60:25});
  addBreach(T,L,big);
  T.shake=Math.max(T.shake,big?1:0.5);
}
function ventTick(v,dt){
  v.t+=dt;if(v.t>v.life)return false;
  world(v.T,v.local,_t1);const k=1-v.t/v.life;
  if(Math.random()<dt*v.rate*k)burst(_t1.x,_t1.y,_t1.z,2,[3.2,1.4,0.4],[3,14],[0.6,1.4]);
  if(Math.random()<dt*v.rate*0.35*k)burst(_t1.x,_t1.y,_t1.z,1,[1.0,0.5,0.25],[2,8],[1.5,3]);
  if(Math.random()<dt*7*k)flash(_t1.x+(Math.random()-0.5)*1.5,_t1.y+(Math.random()-0.5)*1.5,_t1.z+(Math.random()-0.5)*1.5,1.5,4+Math.random()*4,0.35,3.2,1.5,0.45);
  return true;
}
/* ---------- burning breaches ----------
   A hull hit that goes internal leaves a breach that keeps burning: a plume of the explosions' fire, tapered and
   trailing aft and outward like venting gas. It flares when the ship is hit again and gutters in between. How hard
   every breach burns follows the ship's damage on its tactical sheet (boxes marked out of all its boxes), so a ship
   near the end of its sheet visibly burns. A hit close to a breach feeds it instead of starting another, and a
   ship carries at most BREACH_MAX. A breach is open flame for FLAME_S seconds after the hit that started or fed
   it, dies back over FLAME_FADE, then smoulders: sparks and a flicker of embers, more of both on a badly damaged
   ship. Another hit on it lights it again. Drawn only; the engine's damage state is the record. */
const BREACH_MAX=8, FLAMES=[], _Z=new V3(0,0,1), _bq=new Q(), FLAME_S=6, FLAME_FADE=1.5;
const FLAME_VERT=NOISE+`uniform float uAge,uSeed,uAmp;varying vec3 vN,vO,vV;
  void main(){vec3 n=normalize(position);
    float d=fbm(n*1.6+vec3(uSeed,uSeed*0.7,uAge*1.4));
    vec3 p=position*(1.0+uAmp*d);
    float k=smoothstep(-0.7,1.0,p.z);                       // the plume narrows toward its tail (+z)
    p.xy*=mix(1.0,0.22,k);
    p.xy+=0.3*k*vec2(snoise(vec3(p.z*2.0-uAge*3.0,uSeed,0.0)),snoise(vec3(uSeed,p.z*2.0-uAge*3.0,1.0)));
    vec4 mv=modelViewMatrix*vec4(p,1.0);
    vO=n;vV=normalize(-mv.xyz);vN=normalize(normalMatrix*n);gl_Position=projectionMatrix*mv;}`;
function damageFrac(S){
  const d=getDamageState(S.key).damage;let n=0,m=0;
  for(const v of Object.values(d)){if(Array.isArray(v)){n+=v.length;for(const x of v)if(x)m++;}else{n++;if(v)m++;}}
  return n?m/n:0;
}
function addBreach(T,L,big){
  T.breaches=T.breaches||[];
  let near=null,nd=1e9;for(const b of T.breaches){const d=b.local.distanceTo(L);if(d<nd){nd=d;near=b;}}
  if(near&&(nd<3||T.breaches.length>=BREACH_MAX)){near.size=Math.min(2.2,near.size+(big?0.45:0.2));near.flare=1;near.lit=FLAME_S;return;}
  const f=FLAMES.find(x=>!x.busy);if(!f)return;f.busy=true;
  const out=new V3(L.x,L.y,0);if(out.lengthSq()<0.04)out.set(0,1,0);out.normalize();
  T.breaches.push({local:L.clone(),out,size:big?1.3:0.8,flare:1,lit:FLAME_S,seed:Math.random()*50,f});
}
function breachTick(S,dt,t){
  if(!S.breaches||!S.breaches.length)return;
  if(!S.g.visible){for(const b of S.breaches){b.f.m.visible=false;b.f.busy=false;}S.breaches=[];return;}
  S.fracT=(S.fracT||0)-dt;if(S.fracT<=0){S.fracT=0.5;S.frac=damageFrac(S);}
  const base=0.45+1.3*Math.min(1,S.frac/0.45)+(S.dead?0.6:0);
  const aft=_t3.copy(_Z).applyQuaternion(S.g.quaternion), sp=0.5+S.speed/S.maxSpeed;
  for(const b of S.breaches){
    b.flare*=Math.exp(-1.5*dt);b.lit=Math.max(0,b.lit-dt);
    if(SK.fast)continue;
    const lit=sm(0,FLAME_FADE,b.lit);
    if(lit<=0.01){                                           // out: the breach smoulders
      b.f.m.visible=false;
      const at=world(S,b.local,_t1);
      if(Math.random()<dt*(2+5*base*b.size))burst(at.x,at.y,at.z,1,[3.4,1.6,0.5],[4,16],[0.25,0.7]);
      if(Math.random()<dt*(0.6+1.4*base))flash(at.x+(Math.random()-0.5),at.y+(Math.random()-0.5),at.z+(Math.random()-0.5),1,2+Math.random()*2,0.25,3,1.4,0.45);
      continue;
    }
    const flick=0.78+0.22*Math.sin(t*7.3+b.seed)*Math.sin(t*3.1+b.seed*2.0)+(Math.random()-0.5)*0.08;
    const heat=base*flick*(1+0.8*b.flare);
    const len=Math.min(7.5,b.size*(2.6+1.7*heat))*(0.35+0.65*lit), r=b.size*0.72*(0.85+0.35*b.flare)*(0.4+0.6*lit);
    const dir=_t2.copy(b.out).applyQuaternion(S.g.quaternion).multiplyScalar(0.7).addScaledVector(aft,sp).normalize();
    const m=b.f.m, at=world(S,b.local,_t1);
    m.visible=true;m.position.copy(at).addScaledVector(dir,len*0.42);
    m.quaternion.copy(_bq.setFromUnitVectors(_Z,dir));m.scale.set(r,r,len*0.5);
    const u=m.material.uniforms;u.uAge.value=t+b.seed;u.uSeed.value=b.seed;u.uAmp.value=0.35;
    u.uHeat.value=clamp(0.75*heat,0.45,1.4);u.uFade.value=clamp(0.22-0.2*b.flare-0.08*base,0.0,0.22)+0.6*(1-lit);
    if(Math.random()<dt*(1.5+5*heat*b.size)){const e=_t1.copy(at).addScaledVector(dir,len*0.8);burst(e.x,e.y,e.z,1,[3,1.4,0.4],[2,8],[0.4,1.0]);}
  }
}

function kill(T){
  if(T.dead)return;stat(T,'frac_at_death',damageFrac(T));{const O=ships.find(x=>x!==T);if(O)stat(T,'rh_at_death',Bridge.hexRange(T.pos.distanceTo(O.pos)));}T.dead=true;T.deadT=0;T.throttle=0;T.snapT=0;
  note(`${T.name} DESTROYED`,T.side==='player'?'hurt':'hit');
}
function deathTick(T,dt){
  T.deadT+=dt;
  if(T.g.visible&&Math.random()<dt*6){const p=world(T,_t1.set((Math.random()-0.5)*5,(Math.random()-0.2)*3,(Math.random()-0.5)*22),new V3());hullBlast(T,p,Math.random()<0.35);}
  if(T.g.visible&&T.deadT>3.2){
    const p=T.g.position;explode(p,T,'death');flash(p.x,p.y,p.z,8,70,1.2,4,3,2);
    burst(p.x,p.y,p.z,260,[4,2.4,1],[20,140],[0.6,2.6]);burst(p.x,p.y,p.z,120,[1.2,0.6,0.3],[6,40],[2,5]);
    T.g.visible=false;T.shieldMesh.visible=false;vents=vents.filter(v=>v.T!==T);
  }
}

/* ---------- explosions: the star's eruption in miniature ----------
   A hull explosion is a churning ball of plasma that cools from white through orange to red and leaves smoke
   behind, drawn with the same noise as the star's corona. Big hits throw a shock shell. A ship's death adds a
   flat shock ring and plasma tendrils, as the star's eruptions do. Everything is pooled and capped, and the
   shaders are compiled at the start of the battle, so the first explosion doesn't stall a phone. */
const FX_VERT=NOISE+`uniform float uAge,uSeed,uAmp;varying vec3 vN,vO,vV;
  void main(){vec3 n=normalize(position);
    float d=fbm(n*1.6+vec3(uSeed,uSeed*0.7,uAge*0.6));
    vec4 mv=modelViewMatrix*vec4(position*(1.0+uAmp*d),1.0);
    vO=n;vV=normalize(-mv.xyz);vN=normalize(normalMatrix*n);gl_Position=projectionMatrix*mv;}`;
const FIRE_FRAG=NOISE+`uniform float uAge,uSeed,uHeat,uFade;varying vec3 vN,vO,vV;
  vec3 ramp(float t){
    vec3 c=mix(vec3(0.18,0.02,0.0),vec3(1.4,0.28,0.03),smoothstep(0.0,0.3,t));
    c=mix(c,vec3(3.0,1.3,0.28),smoothstep(0.3,0.7,t));
    return mix(c,vec3(4.2,3.7,3.0),smoothstep(0.8,1.25,t));}
  void main(){
    vec3 q=vO*2.2+vec3(uSeed,0.0,-uAge*1.2);
    float n=fbm(q+0.6*vec3(fbm(q*0.7+3.1),fbm(q*0.7+7.7),0.0)), n2=snoise(vO*7.5+vec3(0.0,uAge*2.5,uSeed));
    float mu=clamp(dot(normalize(vN),normalize(vV)),0.0,1.0), core=pow(mu,0.8), limb=smoothstep(0.0,0.6,mu);
    float t=clamp(uHeat*(0.35+0.65*core)*(0.5+1.0*n+0.15*n2),0.0,1.4);   // dark lanes between hot cells
    float a=smoothstep(-0.3,0.3,n*1.2+0.35*core-uFade*1.5)*limb;          // soft edge; breaks up as it burns out
    gl_FragColor=vec4(ramp(t)*a*(1.0-uFade*0.6),1.0);}`;
const SMOKE_FRAG=NOISE+`uniform float uAge,uSeed,uHeat,uFade;varying vec3 vN,vO,vV;
  void main(){
    float n=fbm(vO*2.0+vec3(uSeed,uAge*0.2,0.0));
    float mu=clamp(dot(normalize(vN),normalize(vV)),0.0,1.0);
    float a=smoothstep(-0.2,0.4,n+0.15)*pow(mu,1.3)*uFade;
    vec3 c=mix(vec3(0.13,0.10,0.085),vec3(0.38,0.30,0.24),n*0.5+0.5)+vec3(1.1,0.35,0.06)*uHeat*max(n+0.4,0.0);
    gl_FragColor=vec4(c,a*0.9);}`;
const SHELL_FRAG=NOISE+`uniform float uAge,uSeed,uFade;uniform vec3 uCol;varying vec3 vN,vO,vV;
  void main(){
    float mu=abs(dot(normalize(vN),normalize(vV))), rim=pow(1.0-mu,5.0)*1.8;
    float n=fbm(vO*3.0+vec3(uSeed,uAge*2.0,0.0));
    gl_FragColor=vec4(uCol*rim*(0.55+0.7*n)*uFade,1.0);}`;
const RING_FRAG=NOISE+`uniform float uAge,uSeed,uFade;uniform vec3 uCol;varying vec2 vP;
  void main(){
    float r=length(vP), a=atan(vP.y,vP.x);
    float band=smoothstep(0.55,0.97,r)*smoothstep(1.0,0.97,r);
    float n=fbm(vec3(cos(a)*3.0,sin(a)*3.0,uAge*1.5+uSeed)+vec3(r*4.0));
    gl_FragColor=vec4(uCol*band*band*(0.4+0.9*max(n+0.3,0.0))*uFade,1.0);}`;
const TEND_FRAG=NOISE+`uniform float uAge,uSeed,uFade,uGrow;varying vec2 vUv;
  void main(){
    float x=vUv.x; if(x>uGrow)discard;
    float tip=smoothstep(uGrow,uGrow-0.12,x), n=fbm(vec3(x*9.0-uAge*3.0,vUv.y*6.283,uSeed));
    float hot=(1.0-x*0.75)*(0.55+0.8*max(n+0.2,0.0));
    vec3 c=mix(vec3(2.2,0.5,0.08),vec3(4.2,3.0,1.6),smoothstep(0.45,1.0,hot));
    gl_FragColor=vec4(c*hot*tip*uFade,1.0);}`;

const FX={fire:[],shell:[],ring:null,tend:[],live:[]};
const FB_GEO=new THREE.IcosahedronGeometry(1,4), SHELL_GEO=new THREE.IcosahedronGeometry(1,5);
function fxMat(frag,blend,extra,vert){
  return new THREE.ShaderMaterial({
    uniforms:Object.assign({uAge:{value:0},uSeed:{value:0},uAmp:{value:0.3},uHeat:{value:1},uFade:{value:1}},extra||{}),
    vertexShader:vert||FX_VERT,fragmentShader:frag,transparent:true,depthWrite:false,
    blending:blend,side:blend===THREE.NormalBlending?THREE.FrontSide:THREE.DoubleSide});
}
function fxMesh(geo,mat,order){const m=new THREE.Mesh(geo,mat);m.visible=false;m.frustumCulled=false;m.renderOrder=order;scene.add(m);return m;}
function buildExplosions(){
  if(FX.fire.length)return;
  for(let i=0;i<12;i++)FX.fire.push({fire:fxMesh(FB_GEO,fxMat(FIRE_FRAG,THREE.AdditiveBlending),7),
                                     smoke:fxMesh(FB_GEO,fxMat(SMOKE_FRAG,THREE.NormalBlending),6),busy:false});
  for(let i=0;i<6;i++)FX.shell.push({m:fxMesh(SHELL_GEO,fxMat(SHELL_FRAG,THREE.AdditiveBlending,{uCol:{value:new THREE.Color(2.6,2.0,1.3)}}),8),busy:false});
  FX.ring={m:fxMesh(new THREE.RingGeometry(0.5,1,128,1),fxMat(RING_FRAG,THREE.AdditiveBlending,{uCol:{value:new THREE.Color(2.6,1.6,0.75)}},
    `varying vec2 vP;void main(){vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`),8),busy:false};
  for(let i=0;i<6;i++)FX.tend.push({m:fxMesh(new THREE.BufferGeometry(),fxMat(TEND_FRAG,THREE.AdditiveBlending,{uGrow:{value:0}},
    `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`),8),busy:false});
  for(let i=0;i<BREACH_MAX*2;i++)FLAMES.push({m:fxMesh(FB_GEO,fxMat(FIRE_FRAG,THREE.AdditiveBlending,null,FLAME_VERT),7),busy:false});
  // compile every effect now: a first explosion that waits on a shader compile is a visible hitch
  const all=[...FLAMES.map(f=>f.m),...FX.fire.flatMap(f=>[f.fire,f.smoke]),...FX.shell.map(s=>s.m),FX.ring.m,...FX.tend.map(t=>t.m)];
  for(const m of all)m.visible=true;
  FX.tend.forEach(t=>t.m.visible=false);   // empty geometry: the shared program compiles with the ring's
  try{renderer.compile(scene,camera);}catch(e){}
  for(const m of all)m.visible=false;
}
function take(pool){let f=pool.find(x=>!x.busy);if(!f){f=pool.reduce((a,b)=>(a.fx.t/a.fx.life>b.fx.t/b.fx.life?a:b));f.fx.done=true;}f.busy=true;return f;}
function shipVel(T,k){return T?fwd(T,new V3()).multiplyScalar(T.speed*k):new V3();}

// a fireball: R its full radius, life its burn time; smoke lingers about twice as long and grows past it
function fireball(p,R,life,vel,heat){
  const f=take(FX.fire),seed=Math.random()*50;
  for(const m of[f.fire,f.smoke]){m.position.copy(p);m.visible=true;m.material.uniforms.uSeed.value=seed;m.rotation.set(Math.random()*6,Math.random()*6,0);}
  f.fire.material.uniforms.uAmp.value=0.18;f.smoke.material.uniforms.uAmp.value=0.4;
  const fx={kind:'fire',f,p:p.clone(),vel:vel.clone(),R,life,smokeLife:life*2.4,heat:heat||1.25,t:0};f.fx=fx;FX.live.push(fx);
}
function shell(p,R,life,vel){
  const s=take(FX.shell);s.m.position.copy(p);s.m.visible=true;s.m.material.uniforms.uSeed.value=Math.random()*50;s.m.material.uniforms.uAmp.value=0.0;
  const fx={kind:'shell',f:s,p:p.clone(),vel:vel.clone(),R,life,t:0};s.fx=fx;FX.live.push(fx);
}
function ring(p,R,life,vel,q){
  const r=FX.ring;if(r.busy)r.fx.done=true;r.busy=true;r.m.position.copy(p);r.m.quaternion.copy(q);r.m.visible=true;
  r.m.material.uniforms.uSeed.value=Math.random()*50;
  const fx={kind:'ring',f:r,p:p.clone(),vel:vel.clone(),R,life,t:0};r.fx=fx;FX.live.push(fx);
}
function tendril(p,dir,len,life,vel){
  const T=take(FX.tend),pts=[],side=new V3().crossVectors(dir,new V3(Math.random()-0.5,Math.random()-0.5,Math.random()-0.5)).normalize();
  const curl=(Math.random()-0.5)*1.4;
  for(let i=0;i<=6;i++){const u=i/6;pts.push(new V3().copy(dir).multiplyScalar(len*u).addScaledVector(side,Math.sin(u*2.6)*len*0.28*curl).addScaledVector(dir.clone().cross(side),Math.sin(u*3.7+curl)*len*0.12));}
  T.m.geometry.dispose();T.m.geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),40,Math.max(0.6,len*0.035),8,false);
  // taper: the tube is built at full width, so narrow it toward the tip in place
  const pos=T.m.geometry.attributes.position,uv=T.m.geometry.attributes.uv,c=new THREE.CatmullRomCurve3(pts),q=new V3();
  for(let i=0;i<pos.count;i++){const u=uv.getX(i);c.getPoint(u,q);const k=1-0.85*u;pos.setXYZ(i,q.x+(pos.getX(i)-q.x)*k,q.y+(pos.getY(i)-q.y)*k,q.z+(pos.getZ(i)-q.z)*k);}
  pos.needsUpdate=true;
  T.m.position.copy(p);T.m.visible=true;T.m.material.uniforms.uSeed.value=Math.random()*50;
  const fx={kind:'tend',f:T,p:p.clone(),vel:vel.clone(),len,life,t:0};T.fx=fx;FX.live.push(fx);
}
function fxEnd(fx){const f=fx.f;f.busy=false;if(fx.kind==='fire'){f.fire.visible=false;f.smoke.visible=false;}else f.m.visible=false;}
function updateFx(dt){
  for(const fx of FX.live){
    if(fx.done){continue;}
    fx.t+=dt;fx.p.addScaledVector(fx.vel,dt);fx.vel.multiplyScalar(Math.exp(-0.7*dt));
    const a=fx.t/fx.life;
    if(fx.kind==='fire'){
      const {fire,smoke}=fx.f,ar=Math.min(a,1);
      const r=fx.R*(1-Math.exp(-ar*7))*(1+0.25*ar);
      fire.visible=a<1;fire.position.copy(fx.p);fire.scale.setScalar(Math.max(r,0.01));
      fire.material.uniforms.uAge.value=fx.t;
      fire.material.uniforms.uHeat.value=fx.heat*(0.15+1.0*Math.exp(-ar*3.5));fire.material.uniforms.uFade.value=Math.max(0,(ar-0.45)/0.55);
      const sa=fx.t/fx.smokeLife;
      smoke.position.copy(fx.p);smoke.scale.setScalar(fx.R*(0.6+1.1*(1-Math.exp(-sa*4))));
      smoke.material.uniforms.uAge.value=fx.t;smoke.material.uniforms.uHeat.value=Math.max(0,1-a*1.4)*0.6;
      smoke.material.uniforms.uFade.value=Math.min(1,a*2.5)*Math.pow(Math.max(0,1-sa),0.7);
      if(sa>=1)fx.done=true;
    }else if(fx.kind==='shell'){
      fx.f.m.position.copy(fx.p);fx.f.m.scale.setScalar(fx.R*Math.pow(Math.min(a,1),0.55)+0.01);
      fx.f.m.material.uniforms.uAge.value=fx.t;fx.f.m.material.uniforms.uFade.value=Math.pow(Math.max(0,1-a),1.6);
      if(a>=1)fx.done=true;
    }else if(fx.kind==='ring'){
      fx.f.m.position.copy(fx.p);fx.f.m.scale.setScalar(fx.R*Math.pow(Math.min(a,1),0.5)+0.01);
      fx.f.m.material.uniforms.uAge.value=fx.t;fx.f.m.material.uniforms.uFade.value=Math.pow(Math.max(0,1-a),1.3)*Math.min(1,fx.t*8);
      if(a>=1)fx.done=true;
    }else{
      const u=fx.f.m.material.uniforms;fx.f.m.position.copy(fx.p);
      u.uAge.value=fx.t;u.uGrow.value=Math.min(1,1-Math.exp(-fx.t*3.2)+0.02);u.uFade.value=Math.pow(Math.max(0,1-a),1.4);
      if(a>=1)fx.done=true;
    }
  }
  for(const fx of FX.live)if(fx.done&&fx.f.fx===fx)fxEnd(fx);
  FX.live=FX.live.filter(fx=>!fx.done);
}
// the three sizes the battle uses
function explode(p,T,size){
  const v=shipVel(T,0.85);
  if(size==='small')fireball(p,2.4,1.3,v,1.1);
  else if(size==='big'){fireball(p,5.5,2.4,v,1.3);shell(p,24,0.75,v);}
  else{ // a ship's death: the reactor goes
    fireball(p,17,4.2,v,1.5);fireball(_t2.copy(p).add(_t3.set(rand(-4,4),rand(-2,2),rand(-6,6))),10,3.2,v,1.2);
    shell(p,95,1.3,v);shell(p,45,0.8,v);
    ring(p,80,2.2,v,_qq.setFromUnitVectors(new V3(0,0,1),new V3(rand(-0.25,0.25),1,rand(-0.25,0.25)).normalize()));
    for(let i=0;i<5;i++){const d=new V3(rand(-1,1),rand(-0.6,0.6),rand(-1,1)).normalize();tendril(p,d,rand(26,48),rand(2.4,3.6),v);}
  }
}

/* ---------- shields and shock fronts (as in the film) ---------- */
function shipTick(S,dt,t){
  let flare=0;
  for(const T of tend){const fr=frontAt(T,S.pos);if(!fr)continue;
    const a=Math.abs(fr.sd);
    if(a<fr.thick*2.2){const k=fr.I*Math.exp(-a*a/(fr.thick*fr.thick*1.2));flare=Math.max(flare,k);
      S.offV.x+=fr.dir.x*k*14*dt;S.offV.y+=fr.dir.y*k*14*dt;S.offV.z+=fr.dir.z*k*14*dt;S.shake=Math.max(S.shake,k);}
  }
  S.offV.multiplyScalar(Math.exp(-0.9*dt));S.off.addScaledVector(S.offV,dt);S.off.multiplyScalar(Math.exp(-0.12*dt));
  S.shake*=Math.exp(-1.8*dt);S.roll=Math.sin(t*9.1+S.seed)*S.shake*0.06;
  placeShip(S);
  const sh=S.shieldMesh,u=sh.material.uniforms,left=Bridge.shields(S.key);
  const up=Object.values(left).reduce((a,x)=>a+x.left,0)/Object.values(left).reduce((a,x)=>a+x.max,0);
  sh.position.copy(world(S,S.g.userData.shield.c,_t1));sh.quaternion.copy(S.g.quaternion);sh.scale.copy(S.g.userData.shield.ax);
  for(let i=0;i<NIMP;i++)u.uImp.value[i].w+=dt;
  u.uFlare.value=flare*1.4+S.flareHit;S.flareHit*=Math.exp(-3*dt);
  u.uBase.value=(0.03+0.04*up)+0.02*Math.sin(t*1.3+S.seed);
  u.uFlick.value=up<0.25?(0.4+0.6*Math.random()):1;
  sh.visible=!S.dead&&S.g.visible;
}

/* ---------- star weather: eruptions now and then, sent toward the fight ---------- */
function erupt(phi,yk,state,t,seed){
  const T=tend.find(x=>x.state==='dead');if(!T)return;
  const c=new V3(Math.cos(phi),yk,Math.sin(phi)).normalize();
  T.c.copy(c);T.e1.crossVectors(c,AX.y).normalize();T.e2.crossVectors(c,T.e1).normalize();
  T.fa.copy(c).addScaledVector(T.e1,0.22).normalize().multiplyScalar(R_STAR);
  T.fb.copy(c).addScaledVector(T.e1,-0.22).normalize().multiplyScalar(R_STAR);
  T.seed=seed;T.state=state;T.t=t;T.fadeT=0;T.fr.I=0;T.fr.R=0;
}

/* ---------- camera ---------- */
function cameraTick(dt){
  const P=PL, d=clamp(orbit.dist*0.15,22,150);
  // headless stills: SK.debug.hold(x,y,z,fov) pins the camera at an offset in the player's frame (+x right, +y up,
  // -z ahead), looking at the ship; hold() with no arguments lets go
  if(SK.camHold){const h=SK.camHold;camera.position.copy(_t1.set(h.x,h.y,h.z).applyQuaternion(yawQ(P))).add(P.g.position);
    camera.up.set(0,1,0);camera.lookAt(P.g.position);if(camera.fov!==h.fov){camera.fov=h.fov;camera.updateProjectionMatrix();}return;}
  if(SK.cam==='flyby'){
    // parked ahead of the ship and off to one side; it flies past, and the camera re-parks once it is well clear
    if(!SK.park||SK.park.distanceTo(P.g.position)>200||SK.parkT>14){
      const f=fwd(P,new V3()), side=new V3(-f.z,0,f.x), s=Math.random()<0.5?-1:1;
      SK.park=P.g.position.clone().addScaledVector(f,70+P.speed*5).addScaledVector(side,s*(18+Math.random()*22)).add(new V3(0,(Math.random()-0.35)*16,0));
      SK.parkT=0;
    }
    SK.parkT+=dt;
    camera.position.copy(SK.park);
    const look=_t3.copy(P.g.position);if(!AI.dead)look.lerp(AI.g.position,0.12);
    camera.up.set(0,1,0);camera.lookAt(look);
    if(camera.fov!==36){camera.fov=36;camera.updateProjectionMatrix();}
    return;
  }
  let az=P.yaw+orbit.az, el=orbit.el;
  const tgt=SK.cam==='target'&&!AI.dead;
  if(tgt){const v=_t1.subVectors(P.pos,AI.pos);az=Math.atan2(v.x,v.z)+orbit.az*0.35;}
  const want=_t2.set(Math.sin(az)*Math.cos(el)*d,Math.sin(el)*d,Math.cos(az)*Math.cos(el)*d).add(P.g.position);
  if(SK.fast||SK.t<0.1)camera.position.copy(want);else camera.position.lerp(want,1-Math.exp(-dt*4));
  const look=tgt?_t3.copy(AI.g.position).lerp(P.g.position,0.35):_t3.copy(P.g.position).addScaledVector(fwd(P,_t1),12).add(_t1.set(0,3,0));
  camera.up.set(0,1,0);camera.lookAt(look);
  if(camera.fov!==50){camera.fov=50;camera.updateProjectionMatrix();}
}

/* ---------- engine glows, nav lights, lance charge ---------- */
/* A drive glow is the light coming out of the nozzle, so it follows the nozzle: full seen from astern, dim edge-on,
   gone from forward of the beam. The depth test alone lets a glow leak past a pod's aft rim when the hull in front
   of it is thinner than the occlusion bias. All drives exhaust along the hull's +z. */
const _drvAft=new THREE.Vector3(),_drvV=new THREE.Vector3();
function driveFacing(p){return sm(-0.15,0.5,_drvV.subVectors(camera.position,p).normalize().dot(_drvAft));}
function lights(){
  for(const S of ships){
    if(!S.g.visible)continue;
    const a=atten(S.pos.x,S.pos.y,S.pos.z), ud=S.g.userData, [r,g,b]=ud.engCol, k=S.dead?0.15:0.35+0.65*S.speed/S.maxSpeed;
    const dz=Math.max(8,camera.position.distanceTo(S.pos)), sz=Math.min(26,Math.max(3.5,300/dz))*(innerHeight/700);
    _drvAft.set(0,0,1).applyQuaternion(S.g.quaternion);
    for(const e of ud.eng){world(S,e,_t1);const f=(0.9+Math.random()*0.15)*k*driveFacing(_t1);if(f>0)pt(_t1.x,_t1.y,_t1.z,r*a*f,g*a*f,b*a*f,sz);}
    // wingtip strobes: small, white, an aircraft's double flash every 1.4 s, each ship on its own phase
    const ph=((simT+S.seed)%1.4+1.4)%1.4;
    if(!S.dead&&(ph<0.06||(ph>0.18&&ph<0.24)))for(const n of ud.navs){world(S,n,_t1);pt(_t1.x,_t1.y,_t1.z,3.2*a,3.2*a,3.4*a,3.5);}
    const lance=ud.mounts&&ud.mounts.lance;
    if(lance)['hbA','hbB','hbC'].forEach((id,i)=>{
      const L=lance[i];if(!L)return;
      const lost=Bridge.weaponLost(S.key,id), c=S.charge[id];
      const ch=lost||S.dead?0:c<=0?0.55:sm(2.5,0,c);           // gathers light in the last seconds, steady when armed
      L.mat.color.setRGB(lost?0.2:2.0+5*ch,lost?0.15:1.2+3.2*ch,lost?0.1:0.4+1.2*ch);
      if(ch>0.02){world(S,L.local,_t1);const aa=atten(_t1.x,_t1.y,_t1.z);pt(_t1.x,_t1.y,_t1.z,5*ch*aa,3*ch*aa,1*ch*aa,10+30*ch*(0.85+Math.random()*0.3));}
    });
  }
}
function buildFxSk(){
  buildFx();lights();
  ptGeo.setDrawRange(0,ptN);ptGeo.attributes.position.needsUpdate=true;ptGeo.attributes.color.needsUpdate=true;ptGeo.attributes.aSize.needsUpdate=true;
}

/* ---------- log and HUD ---------- */
function note(msg,cls){SK.log.unshift({msg,cls:cls||'',t:SK.t});if(SK.log.length>60)SK.log.length=60;}
function shieldHex(S){
  const sh=Bridge.shields(S.key), R=34, cx=44, cy=40, P=[];
  for(let i=0;i<6;i++){const a=(i*60)*Math.PI/180;P.push([cx+R*Math.cos(a),cy+R*Math.sin(a)]);}
  // flat-top hexagon, bow up: #1 top edge, then clockwise
  const edges=[[4,5],[5,0],[0,1],[1,2],[2,3],[3,4]];
  let s=`<svg viewBox="0 0 88 80" class="hex">`;
  edges.forEach(([a,b],i)=>{
    const f=sh[i+1].left/sh[i+1].max, col=f>0.66?'#7dffb0':f>0.33?'#ffcf4a':f>0?'#ff7a4a':'#5a2a2a';
    const [x1,y1]=P[a],[x2,y2]=P[b],mx=(x1+x2)/2,my=(y1+y2)/2,tx=cx+(mx-cx)*0.62,ty=cy+(my-cy)*0.62;
    s+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="${f>0?5:2}" stroke-linecap="round"/>`;
    s+=`<text x="${tx.toFixed(1)}" y="${(ty+3.5).toFixed(1)}" text-anchor="middle">${sh[i+1].left}</text>`;
  });
  return s+`<path d="M44 26 L50 46 L44 42 L38 46 Z" fill="#dde4f2" opacity=".55"/></svg>`;
}
function weaponRows(S,T){
  const bearing=T&&!T.dead?bear(S,T.pos,T):null, rh=T?Bridge.hexRange(S.pos.distanceTo(T.pos)):0;
  const bears=new Set(bearing==null?[]:Bridge.bearingWeapons(S.key,bearing).filter(p=>SEEKERS.has(p.category)?seekerReaches(p,rh):Bridge.reaches(S.key,p.category,p.weapon,rh)).map(p=>p.weapon.id));
  return Bridge.weaponsOf(S.key).map(({category,weapon})=>{
    const lost=Bridge.weaponLost(S.key,weapon.id), c=S.charge[weapon.id], full=armS(category,weapon);
    const ammo=S.ammo[weapon.id];
    const pd=pdHeld(S.key,{category,weapon});
    const st=lost?'<b class="lost">LOST</b>':ammo===0?'<b class="lost">EMPTY</b>':c<=0?`<b class="rdy">${ammo!=null?ammo+' LEFT':pd?'AUTO PD':'ARMED'}</b>`:`<i style="--p:${Math.round(100*(1-c/full))}%"></i>`;
    return `<div class="wr${bears.has(weapon.id)&&!lost&&!pd?' on':''}"><span>${short(tq(weapon.label))}</span><em>${weapon.arc}</em>${st}</div>`;
  }).join('');
}
function hudTick(){
  const P=PL,T=AI,range=P.pos.distanceTo(T.pos), b=bear(P,T.pos,T), dy=T.pos.y-P.pos.y;
  $('sk-pname').textContent=P.name;$('sk-tname').textContent=T.name+(T.dead?' · DESTROYED':'');
  $('sk-pshield').innerHTML=shieldHex(P);$('sk-tshield').innerHTML=shieldHex(T);
  $('sk-pw').innerHTML=weaponRows(P,T);
  $('sk-speed').innerHTML=`SPEED ${P.speed.toFixed(1)} · THROTTLE ${Math.round(P.throttle*100)}% · ALT ${P.pos.y>=0?'+':''}${Math.round(P.pos.y/HEX_U)} · ${P.snapT>0?'<b class="rdy">TURNING</b>':'RAPID TURN '+P.snaps}${P.sdT>0?` · <b class="lost">SELF-DESTRUCT ${Math.max(0,SD_HOLD-P.sdT).toFixed(1)}</b>`:''}<i class="thr"><b style="width:${Math.round(P.throttle*100)}%"></b><u style="left:${Math.round(100*P.speed/P.maxSpeed)}%"></u></i>`;
  const above=Math.round(dy/HEX_U);
  $('sk-range').textContent=`RANGE ${Bridge.hexRange(range)} HEX · BEARING ${Math.round(b)}°${above?` · ${Math.abs(above)} ${above>0?'ABOVE':'BELOW'}`:''}`;
  $('sk-tside').textContent=`facing you: shield #${Bridge.shieldFacing(bear(T,P.pos,P))}`;
  const mm=x=>`${Math.floor(x/60)}:${String(Math.floor(x%60)).padStart(2,'0')}`;
  $('sk-clock').textContent=`${mm(SK.t)} / ${mm(SK.limit||TIME_LIMIT)}${SK.limit?' OT':''}`;
  $('sk-log').innerHTML=SK.log.slice(0,6).map(l=>`<div class="${l.cls}">${l.msg}</div>`).join('');
  starBanner();missileBanner();
}
/* the amber banner: seekers aimed at the player. MSL_WARN out it shows the count and the nearest range; inside
   MSL_CRIT, where the computer captain starts its own dodge (a 30-unit climb or dive away from the seeker), it says
   so: a change of height is what makes a seeker overshoot. */
const MSL_WARN=120, MSL_CRIT=60;
function missileBanner(){
  const el=$('sk-msl');if(!el)return;
  let n=0,torp=0,near=1e9;
  if(PL&&!PL.dead&&!SK.over)for(const b of seekers){if(!b.on||b.T!==PL)continue;const d=b.p.distanceTo(PL.pos);if(d>MSL_WARN)continue;
    n++;if(b.category==='plasma')torp++;near=Math.min(near,d);}
  const on=n>0, crit=on&&near<MSL_CRIT;
  el.classList.toggle('on',on);el.classList.toggle('crit',crit);
  if(!on)return;
  const what=torp===n?(n>1?'TORPEDOES':'TORPEDO'):torp?'SEEKERS':(n>1?'MISSILES':'MISSILE');
  el.firstElementChild.textContent=`${n} ${what} INBOUND`;
  el.lastElementChild.textContent=`${Math.round(near/HEX_U)} HEX · ${crit?'CLIMB OR DIVE NOW':'CLIMB OR DIVE (R / F)'}`;
}
// the red banner: the player's course crosses the star (or it is close whatever the course)
function starBanner(){
  const el=$('sk-star'), st=starThreat(PL), close=STAR_ON&&st.d<30;
  const on=!PL.dead&&!SK.over&&((st.course&&st.d<WARN_D)||close), crit=on&&(st.d<CRIT_D||close);
  el.classList.toggle('on',on);el.classList.toggle('crit',crit);
  if(on)el.lastElementChild.textContent=`${Math.max(0,Math.round(st.d/HEX_U))} HEX · ${crit?'TURN AWAY NOW · THROTTLE DOWN':'TURN AWAY'}`;
}

/* ---------- radar and target pointer ----------
   The scope is heading-up, your ship at the centre: rings at 10, 20 and 30 hexes, the edge at RADAR_HEX (an enemy
   further out sits on the edge, hollow, with its range). The enemy is a triangle pointing the way it is heading,
   with its height above or below you in hexes; seekers are dots (orange coming for you, blue yours). The shaded
   sectors are where your armed weapons bear (point defence left out), so the scope shows which way to turn. The
   faint spokes are your shield facings' edges. When the enemy is off screen or behind the camera, a pointer on the
   screen's edge shows where, with the range. HUD only: recordings and photos don't carry it. */
const RADAR_HEX=40, RADAR_RINGS=[10,20,30];
let radarArcs=new Float32Array(36), radarCtx=null;
function radarArcsTick(){
  const n=new Float32Array(36);
  for(let i=0;i<36;i++){
    for(const p of Bridge.bearingWeapons(PL.key,i*10+5))if(!pdHeld(PL.key,p)&&PL.charge[p.weapon.id]<=0&&PL.ammo[p.weapon.id]!==0)n[i]++;
  }
  radarArcs=n;
}
function radarTick(){
  const cv=$('sk-radar');if(!cv||!PL)return;
  const css=cv.clientWidth||180, dpr=Math.min(2,devicePixelRatio||1), W=Math.round(css*dpr);
  if(cv.width!==W){cv.width=W;cv.height=W;radarCtx=null;}
  const g=radarCtx||(radarCtx=cv.getContext('2d'));
  const R=W/2-4*dpr, c=W/2, k=R/RADAR_HEX;
  g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,W,W);g.translate(c,c);
  g.fillStyle='rgba(6,12,22,0.78)';g.beginPath();g.arc(0,0,R,0,7);g.fill();
  // weapon arcs that bear, armed
  let mx=0;for(const v of radarArcs)mx=Math.max(mx,v);
  for(let i=0;i<36;i++){if(!radarArcs[i])continue;
    const a0=(i*10-90)*Math.PI/180, a1=a0+Math.PI/18;
    g.fillStyle=`rgba(111,243,255,${(0.08+0.22*radarArcs[i]/mx).toFixed(3)})`;
    g.beginPath();g.moveTo(0,0);g.arc(0,0,R,a0,a1);g.closePath();g.fill();}
  // rings and shield-facing spokes
  g.strokeStyle='rgba(160,190,230,0.22)';g.lineWidth=dpr;
  for(const r of RADAR_RINGS){g.beginPath();g.arc(0,0,r*k,0,7);g.stroke();}
  g.strokeStyle='rgba(160,190,230,0.5)';g.beginPath();g.arc(0,0,R,0,7);g.stroke();
  g.strokeStyle='rgba(160,190,230,0.12)';
  for(let i=0;i<6;i++){const a=(30+60*i-90)*Math.PI/180;g.beginPath();g.moveTo(0,0);g.lineTo(Math.cos(a)*R,Math.sin(a)*R);g.stroke();}
  const at=(pos)=>{const b=Bridge.bearingOf(PL.pos,yawQ(PL),pos)*Math.PI/180, h=Math.min(RADAR_HEX,PL.pos.distanceTo(pos)/HEX_U);return [Math.sin(b)*h*k,-Math.cos(b)*h*k,h>=RADAR_HEX];};
  // seekers
  const pulse=0.5+0.5*Math.sin(performance.now()/120);
  for(const b of seekers){if(!b.on)continue;const [x,y]=at(b.p), mine=b.T===PL;
    g.fillStyle=mine?'#ffae5a':'#7fc8ff';g.beginPath();g.arc(x,y,(b.category==='plasma'?2.6:1.8)*(mine?1.6:1)*dpr,0,7);g.fill();
    if(mine){g.strokeStyle=`rgba(255,174,90,${(0.35+0.5*pulse).toFixed(2)})`;g.lineWidth=1.2*dpr;g.beginPath();g.arc(x,y,(5+2*pulse)*dpr,0,7);g.stroke();}}
  // the enemy
  if(AI&&!(AI.dead&&!AI.g.visible)){
    const [x,y,edge]=at(AI.pos), col=AI.dead?'#777':'#ff6a4a';
    g.save();g.translate(x,y);g.rotate(PL.yaw-AI.yaw);
    g.beginPath();g.moveTo(0,-7*dpr);g.lineTo(5*dpr,5*dpr);g.lineTo(0,2.5*dpr);g.lineTo(-5*dpr,5*dpr);g.closePath();
    if(edge){g.strokeStyle=col;g.lineWidth=1.5*dpr;g.stroke();}else{g.fillStyle=col;g.fill();}
    g.restore();
    const dh=Math.round((AI.pos.y-PL.pos.y)/HEX_U), rh=Bridge.hexRange(PL.pos.distanceTo(AI.pos));
    const lab=(edge?rh+'':'')+(dh?(edge?' ':'')+(dh>0?'▲':'▼')+Math.abs(dh):'');
    if(lab){g.font=`${10*dpr}px "Share Tech Mono",monospace`;g.fillStyle=col;g.textAlign='left';g.textBaseline='middle';
      const tx=clamp(x+8*dpr,-R,R-34*dpr), ty=clamp(y,-R+8*dpr,R-8*dpr);g.fillText(lab,tx,ty);}
  }
  // you
  g.fillStyle='#dde4f2';g.beginPath();g.moveTo(0,-7*dpr);g.lineTo(5*dpr,5*dpr);g.lineTo(0,2.5*dpr);g.lineTo(-5*dpr,5*dpr);g.closePath();g.fill();
  pointerTick();
}
const _ptv=new V3();
function pointerTick(){
  const el=$('sk-ptr');if(!el)return;
  if(!AI||AI.dead||SK.over){el.style.display='none';return;}
  const v=_ptv.copy(AI.g.position).project(camera);
  let x=v.x,y=v.y;const behind=v.z>1;
  if(behind){x=-x;y=-y;}
  if(!behind&&Math.abs(x)<0.92&&Math.abs(y)<0.88){el.style.display='none';return;}
  const m=Math.max(Math.abs(x)/0.9,Math.abs(y)/0.82,1e-6);x/=m;y/=m;
  const sx=(x*0.5+0.5)*innerWidth, sy=(0.5-y*0.5)*innerHeight, ang=Math.atan2(-y*innerHeight,x*innerWidth);
  el.style.display='block';
  el.style.transform=`translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px)`;
  el.firstChild.style.transform=`rotate(${(ang*180/Math.PI).toFixed(1)}deg)`;
  el.lastChild.textContent=Bridge.hexRange(PL.pos.distanceTo(AI.pos))+' HEX';
}

/* ---------- recorder: the 3D view straight to a video file ----------
   The HUD is page, not canvas, so recordings and photos are the render alone. */
const REC={mr:null,chunks:[],t0:0,type:'',stream:null,bad:{}};
function recType(){
  if(!window.MediaRecorder)return '';
  for(const t of['video/mp4;codecs=avc1.640028','video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'])
    if(!REC.bad[t.split(';')[0]]&&MediaRecorder.isTypeSupported(t))return t;
  return '';
}
function stamp(){const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),8000);}
function toggleRec(){
  if(REC.mr){REC.mr.stop();return;}
  const type=recType();
  if(!type||!canvas.captureStream){note('Recording is not supported in this browser','dim');return;}
  const stream=canvas.captureStream(60);
  let mr;
  try{mr=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:16e6});}
  catch(e){stream.getTracks().forEach(t=>t.stop());note('Recording failed to start: '+e.message,'dim');return;}
  Object.assign(REC,{mr,stream,chunks:[],type,t0:performance.now()});
  mr.ondataavailable=e=>{if(e.data&&e.data.size)REC.chunks.push(e.data);};
  mr.onstop=()=>{
    const ext=type.startsWith('video/mp4')?'mp4':'webm', blob=new Blob(REC.chunks,{type:type.split(';')[0]});
    REC.stream.getTracks().forEach(t=>t.stop());REC.mr=null;REC.stream=null;syncRec();
    // an encoder that claims a format but writes nothing gets passed over from now on
    if(blob.size<2048){REC.bad[type.split(';')[0]]=true;if(REC.onSaved){const f=REC.onSaved;REC.onSaved=null;setTimeout(f,300);}note(`Recording came out empty (${ext.toUpperCase()}); the next one will use ${recType().includes('webm')?'WebM':'another format'}`,'dim');return;}
    download(blob,`six-fleets-skirmish-${stamp()}.${ext}`);
    note(`Recording saved (${ext.toUpperCase()}, ${(blob.size/1048576).toFixed(1)} MB)`,'dim');
    if(REC.onSaved){const f=REC.onSaved;REC.onSaved=null;setTimeout(f,1500);}
  };
  mr.start(1000);syncRec();
}
function syncRec(){
  const on=!!REC.mr;document.body.classList.toggle('sk-rec',on);
  $('sk-rec').textContent=on?'■ Stop':'● Rec';
  $('sk-endrec').hidden=!on;
  if(!on)$('sk-recdot').textContent='';
}
function recTick(){if(REC.mr){const s=Math.floor((performance.now()-REC.t0)/1000);$('sk-recdot').textContent=`● REC ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}}
// a still: one frame from a short canvas stream (the WebGL buffer itself is cleared after each frame)
function photo(){
  if(!canvas.captureStream)return;
  const st=canvas.captureStream(30), v=document.createElement('video');
  v.muted=true;v.playsInline=true;v.srcObject=st;
  const grab=()=>{
    const c=document.createElement('canvas');c.width=v.videoWidth||canvas.width;c.height=v.videoHeight||canvas.height;
    c.getContext('2d').drawImage(v,0,0,c.width,c.height);st.getTracks().forEach(t=>t.stop());
    c.toBlob(b=>{if(b){download(b,`six-fleets-${stamp()}.png`);note('Photo saved','dim');}},'image/png');
  };
  v.play().then(()=>{if(v.requestVideoFrameCallback)v.requestVideoFrameCallback(()=>grab());else setTimeout(grab,250);}).catch(()=>st.getTracks().forEach(t=>t.stop()));
}
function toggleClean(){document.body.classList.toggle('sk-clean');}
// fight again: a recording still running is stopped and saved before the page reloads
function again(){if(REC.mr){REC.onSaved=()=>location.reload();REC.mr.stop();}else location.reload();}
const CAMS=['chase','target','flyby'], CAMLABEL={chase:'Chase',target:'Target',flyby:'Fly-by'};
function nextCam(){SK.cam=CAMS[(CAMS.indexOf(SK.cam)+1)%CAMS.length];SK.park=null;$('sk-cam').textContent='View: '+CAMLABEL[SK.cam];}

/* ---------- the end: both ships' damage on their tactical sheets ---------- */
function result(){
  const ships_={};
  for(const S of ships)ships_[S.key]=JSON.parse(JSON.stringify(getDamageState(S.key)));
  return {kind:'six-fleets/engagement-result',version:1,engagement:'skirmish',mode:'real-time',
    location:SEL.loc,seconds:+SK.t.toFixed(1),outcome:SK.over,player:PL.key,enemy:AI.key,ships:ships_};
}
function finish(outcome){
  if(SK.over)return;SK.over=outcome;SK.overT=0;
  const title={victory:`${AI.cls} DESTROYED`,defeat:`${PL.cls} LOST`,disengaged:'DISENGAGED',time:'BATTLE BROKEN OFF',mutual:'BOTH SHIPS LOST'}[outcome];
  $('sk-end-title').textContent=title;
  const sum=S=>{const sh=Bridge.shields(S.key),st=getDamageState(S.key);
    const boxes=Object.values(st.damage).reduce((n,v)=>n+(Array.isArray(v)?v.filter(Boolean).length:v?1:0),0);
    const w=Bridge.weaponsOf(S.key).filter(x=>Bridge.weaponLost(S.key,x.weapon.id)).map(x=>short(tq(x.weapon.label)));
    return `<div class="sum"><b>${S.name}</b>${S.dead?' · destroyed':''}<br>shields ${[1,2,3,4,5,6].map(i=>sh[i].left+'/'+sh[i].max).join(' · ')}<br>${boxes} boxes marked${w.length?' · weapons lost: '+w.join(', '):''}</div>`;};
  const sheet=S=>{let svg='';try{svg=buildSheetSvg(S.key,{readOnly:true});}catch(e){svg='<p>sheet unavailable: '+e.message+'</p>';}return `<div class="sk-sheet">${sum(S)}${svg}</div>`;};
  $('sk-sheets').innerHTML=sheet(PL)+sheet(AI);
}
function saveResult(){
  const blob=new Blob([JSON.stringify(result(),null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='six-fleets-skirmish-result.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

/* ---------- ?debug: what the helm and the page are doing, frame by frame ----------
   Frame times (min/max over the last second), keys held, the helm's turn and bank, whether the page has focus and
   what element holds it, key events per second (key-repeat that sends keyup/keydown pairs shows here), and how
   often the weapon list's bearing marks changed in the last second. */
// ?debug opens with it showing; ` (backquote) shows and hides it at any time, so a recording can start clean
const DBG={on:new URLSearchParams(location.search).has('debug'),dts:[],ev:[],flips:[],lastOn:'',el:null};
function dbgToggle(){DBG.on=!DBG.on;DBG.dts=[];DBG.ev=[];DBG.flips=[];if(DBG.el)DBG.el.style.display=DBG.on?'':'none';}
{for(const t of ['keydown','keyup','blur','focus'])addEventListener(t,e=>DBG.on&&DBG.ev.push([performance.now(),t,e.code||'',e.repeat]),true);}
function dbgTick(rdt){
  const now=performance.now();DBG.dts.push([now,rdt]);
  const cut=now-1000;DBG.dts=DBG.dts.filter(x=>x[0]>cut);DBG.ev=DBG.ev.filter(x=>x[0]>cut);DBG.flips=DBG.flips.filter(x=>x>cut);
  const on=[...document.querySelectorAll('#sk-pw .wr')].map(r=>r.classList.contains('on')?1:0).join('');
  if(on!==DBG.lastOn){DBG.flips.push(now);DBG.lastOn=on;}
  if(!DBG.el){DBG.el=document.createElement('pre');DBG.el.style.cssText='position:fixed;left:8px;bottom:8px;z-index:50;margin:0;padding:6px 8px;background:rgba(0,0,0,.75);color:#9fe;font:11px/1.35 monospace;pointer-events:none;white-space:pre';document.body.appendChild(DBG.el);}
  const ms=DBG.dts.map(x=>x[1]*1000), held=Object.keys(keyDown).filter(k=>keyDown[k]).join(' ')||'-';
  const cnt=t=>DBG.ev.filter(x=>x[1]===t).length, rep=DBG.ev.filter(x=>x[1]==='keydown'&&x[3]).length;
  const a=document.activeElement;
  DBG.el.textContent=`fps ${DBG.dts.length}  frame ms ${Math.min(...ms).toFixed(1)}..${Math.max(...ms).toFixed(1)}\n`+
    `keys held: ${held}\nturnIn ${PL.turnIn}  bank ${PL.bank.toFixed(3)}  yaw ${PL.yaw.toFixed(3)}  climb ${PL.climb}\n`+
    `focus ${document.hasFocus()?'yes':'NO'}  active ${a?(a.id||a.tagName):'-'}\n`+
    `last 1 s: keydown ${cnt('keydown')} (repeat ${rep})  keyup ${cnt('keyup')}  blur ${cnt('blur')}  focus ${cnt('focus')}\n`+
    `weapon bearing marks changed ${DBG.flips.length}x in 1 s  [${on}]`;
}

/* ---------- step: replaces the game's step() while the skirmish runs ---------- */
SK.step=function(rdt){
  // offline capture: the game's loop only redraws; SK.frame() advances exactly one 1/30 s step
  if(SK.offline&&!SK._inner){simT=SK.simLock;return;}
  const dt=Math.min(rdt,0.05);
  if(DBG.on&&!SK.fast&&PL)dbgTick(rdt);
  SK.t+=dt;const t=SK.t;
  U.time.value=simT;
  U.pulse.value=0.5+0.3*Math.sin(simT*0.7)+0.2*Math.sin(simT*2.3+1.0);
  if(SK.planet)SK.planet.update(camera,dt);
  SFLook.tick(simT,ships.map(S=>S.g));
  sunLight.intensity=(1.8+0.8*U.pulse.value)*(LOC.planet?0.5:1);   // in orbit no dust dims the ships
  nextEvent=1e9;
  tickTendrils(dt*S.ts,simT);
  if(!LOC.planet&&t>=eruptAt){const ph=Math.atan2(PL.pos.z,PL.pos.x)+(Math.random()-0.5)*0.9;erupt(ph,(Math.random()-0.5)*0.5,'warn',0,1+Math.floor(Math.random()*90));eruptAt=t+45+Math.random()*25;}
  if(!SK.over){
    // the player's helm (or the computer, in auto)
    if(SK.auto)captain(PL,AI,dt);
    else{
      PL.turnIn=(keyDown.KeyA||keyDown.ArrowLeft||keyDown.tl?1:0)-(keyDown.KeyD||keyDown.ArrowRight||keyDown.tr?1:0);
      PL.climb=(keyDown.KeyR||keyDown.cu?1:0)-(keyDown.KeyF||keyDown.cd?1:0);
      const th=(keyDown.KeyW||keyDown.ArrowUp||keyDown.tu?1:0)-(keyDown.KeyS||keyDown.ArrowDown||keyDown.td?1:0);
      PL.throttle=clamp(PL.throttle+th*dt*0.9,0,1);
      if(keyDown.sn){keyDown.sn=false;want.snap=true;}
      if(want.snap)snapTurn(PL);
      PL.sdT=SD_ON&&(keyDown.KeyX||keyDown.sd)&&!PL.dead?(PL.sdT||0)+dt:0;
      if(PL.sdT>=SD_HOLD)selfDestruct(PL,AI);
      // spinning with no turn held: the helm brings the bow round on the target
      if(PL.snapT>0&&!PL.turnIn&&!AI.dead){const b=bear(PL,AI.pos,AI);PL.turnIn=clamp(-(b>180?b-360:b)/25,-1,1);}
      if(want.all||keyDown.Space||keyDown.fa)tryFire(PL,AI,null);
      if(want.qip||keyDown.f1)tryFire(PL,AI,p=>p.category==='phasers');
      if(want.heavy||keyDown.f2)tryFire(PL,AI,p=>p.category!=='phasers');
    }
    want.qip=want.heavy=want.all=want.snap=false;
    captain(AI,PL,dt);
    const range=PL.pos.distanceTo(AI.pos);
    {const h=range/HEX_U;stat(PL,'t_'+(h<10?'00-10':h<20?'10-20':h<30?'20-30':h<45?'30-45':'45+'),dt);}
    SK.farT=range>DISENGAGE?SK.farT+dt:0;
    if(PL.dead&&AI.dead&&PL.deadT>3.5)finish('mutual');
    else if(AI.dead&&AI.deadT>3.5)finish('victory');
    else if(PL.dead&&PL.deadT>3.5)finish('defeat');
    else if(SK.farT>6)finish('disengaged');
    else if(t>(SK.limit||TIME_LIMIT)){
      const lim=SK.limit||TIME_LIMIT, active=t-(SK.lastDmg??-1e9)<OT_ACTIVE&&range<OT_RANGE;
      if(active&&lim+OT_STEP<=OT_MAX){SK.limit=lim+OT_STEP;note(`Fight still on: overtime to ${Math.floor(SK.limit/60)}:${String(SK.limit%60).padStart(2,'0')}`,'dim');}
      else finish('time');
    }
  }else{SK.overT+=dt;if(REC.mr&&SK.overT>4&&!REC.autoStopped){REC.autoStopped=true;REC.mr.stop();}}
  for(const S of ships){
    for(const id in S.charge)if(S.charge[id]>0)S.charge[id]=Math.max(0,S.charge[id]-dt);
    helm(S,dt);shipTick(S,dt,t);if(S.dead)deathTick(S,dt);breachTick(S,dt,t);
  }
  for(const b of beams)if(b.on)beamTick(b,dt,t);
  for(const b of torps)if(b.on)torpTick(b,dt);
  for(let i=torps.length-1;i>=0;i--)if(!torps[i].on)torps.splice(i,1);
  for(const b of seekers)if(b.on)seekerTick(b,dt);
  for(let i=seekers.length-1;i>=0;i--)if(!seekers[i].on)seekers.splice(i,1);
  vents=vents.filter(v=>ventTick(v,dt));
  updateSparks(dt);updateFx(dt);
  cameraTick(dt);
  let shake=0;for(const S of ships)shake=Math.max(shake,S.shake*Math.max(0,1-camera.position.distanceTo(S.pos)/80));
  if(shake>0.01)camera.position.add(_t1.set(Math.random()-0.5,Math.random()-0.5,Math.random()-0.5).multiplyScalar(shake*0.6));
  corona.quaternion.copy(camera.quaternion);spikes.quaternion.copy(camera.quaternion);
  if(SK.fill){SK.fill.position.copy(camera.position).add(_t1.set(0,30,0));SK.fill.target.position.copy(PL.g.position);}
  let st=0;
  for(const T of tend){const fr=frontAt(T,camera.position);if(!fr)continue;st=Math.max(st,fr.I*(fr.sd>0?Math.exp(-fr.sd/45):Math.exp(fr.sd/22)));}
  lastStatic=lerp(lastStatic,Math.min(0.6,st*0.8),Math.min(1,dt*10));
  if(!SK.fast){
    // dust streaks around the camera, as the game draws them for the Shrike: the sense of speed
    S.vel.copy(fwd(PL,_t1)).multiplyScalar(PL.speed*2.5);S.dust=Math.max(0.22,gameDens(PL.pos.x,PL.pos.y,PL.pos.z));moteLines.visible=true;updateMotes(0);
    buildFxSk();
    finalPass.uniforms.uStatic.value=lastStatic;finalPass.uniforms.uHit.value=0;
    hudT-=dt;if(hudT<=0){hudT=0.1;hudTick();recTick();radarArcsTick();}
    radarTick();
    document.body.classList.toggle('sk-over',!!SK.over&&SK.overT>0.8);
  }
};
/** Run the battle forward without drawing (headless checks): seconds, or until it ends. */
SK.simulate=function(seconds){
  SK.fast=true;const h=1/30;let n=Math.round(seconds/h);
  while(n-->0&&!(SK.over&&SK.overT>1)){simT+=h*S.ts;SK.step(h);}
  SK.fast=false;SK.step(0);
  return SK.info();
};
SK.rec=REC;SK.photo=photo;SK.toggleRec=toggleRec;
/** Offline capture: freeze the loop (SK.offline=true), then call SK.frame() once per captured frame. */
SK.offlineStart=function(){SK.offline=true;SK.simLock=simT;};
SK.frame=function(){SK._inner=true;simT=SK.simLock+(1/30)*S.ts;SK.simLock=simT;SK.step(1/30);SK._inner=false;};
SK.info=()=>({t:+SK.t.toFixed(1),over:SK.over,alt:[+PL.pos.y.toFixed(1),+AI.pos.y.toFixed(1)],player:PL&&PL.key,enemy:AI&&AI.key,seekers:seekers.length,range:+PL.pos.distanceTo(AI.pos).toFixed(1),yaw:+PL.yaw.toFixed(3),throttle:+PL.throttle.toFixed(2),speed:+PL.speed.toFixed(2),snaps:[PL.snaps,AI.snaps],
  charged:Object.entries(PL.charge).filter(([,c])=>c>0).map(([id])=>id),
  player:{shields:Bridge.shields(PL.key),dead:PL.dead},enemy:{shields:Bridge.shields(AI.key),dead:AI.dead},log:SK.log.slice(0,8).map(l=>l.msg)});
SK.result=result;SK.stats=STATS;
SK.debug={hold:(x,y,z,fov)=>{SK.camHold=x==null?null:{x,y,z,fov:fov||40};},bear,ships:()=>[PL,AI],cam:()=>camera,star:S=>starThreat(S),banner:()=>{starBanner();const e=$("sk-star");return {on:e.classList.contains("on"),crit:e.classList.contains("crit"),text:e.textContent};}};   // headless checks
SK.fx={hit:(who,dmg,big)=>{const T=who==='player'?PL:AI;const L=new V3((Math.random()-0.5)*3,0.8,(Math.random()-0.5)*16);
    Bridge.land(T.key,Math.random()*360,{damage:dmg||12});hullBlast(T,world(T,L,new V3()),!!big);},breaches:(who)=>((who==='player'?PL:AI).breaches||[]).length,explode:(x,y,z,size)=>explode(new V3(x,y,z),null,size||'death'),kill:(who)=>{kill(who==='player'?PL:AI);},live:()=>FX.live.length,
  ahead:(d,size,side)=>{const p=PL.pos.clone().addScaledVector(fwd(PL),d).add(new V3((side||0),2,0));explode(p,null,size||'death');}};

/* ---------- start ---------- */
/* ---------- picking the pair ----------
   ?p=<ship>&e=<ship> (sovereign, reclamation, pathfinder, sentinel, vanguard, raptor) starts that fight at once;
   otherwise the picker opens. The choice goes into the address, so Fight again replays the same pair. */
/* ---------- the location's scene ----------
   Planet maps come from tools/planets/bake_planet.py and are embedded by tools/embed_planet.py (#planet-maps, keyed by
   planet), so the page runs from a plain file. At Tauri-B, Veyrath hangs beyond the nebula as scenery, lit by the
   star and dimmed by the dust in front of it (?noplanet leaves it out). At a planet, the fight is in its orbit: the
   nebula and the eruptions are off, and the star, its corona and its light move out to where Tauri-B stands as that
   world's sun. */
const BACKDROP_R=280, BACKDROP_AT=new V3(-0.5,-0.3,0.81).normalize().multiplyScalar(1400);
let PLANET_MAPS;
function planetMaps(id){
  if(PLANET_MAPS===undefined){try{PLANET_MAPS=JSON.parse(document.getElementById('planet-maps').textContent);}catch(e){PLANET_MAPS=null;}}
  return PLANET_MAPS&&PLANET_MAPS[id];
}
function addPlanet(id,o){
  const emb=planetMaps(id);
  if(SK.planet||!emb||!window.SFPlanet)return;
  SK.planet=SFPlanet.build(Object.assign({maps:emb.maps,meta:emb.meta,anisotropy:renderer.capabilities.getMaxAnisotropy()},o));
  scene.add(SK.planet.group);
}
/* ---------- reflections: each location's sky for the hulls to mirror (js/shiplook.js builds it) ----------
   At Tauri-B the nebula's reds and blues (the star's own light stays a point light, since it sits in the fight); in
   orbit the sun as a hot spot and the planet filling the sky below, lit on the sun side. */
const ENV_LOOK={
  tauri:{up:[0.05,0.035,0.08],mid:[0.16,0.05,0.07],down:[0.03,0.05,0.12]},
  veyrath:{up:[0.004,0.005,0.008],mid:[0.008,0.008,0.012],down:[0.004,0.004,0.006],planet:[0.012,0.01,0.01],lit:[0.14,0.06,0.025],glow:[0.22,0.05,0.005]},
  caelora:{up:[0.004,0.005,0.008],mid:[0.008,0.008,0.012],down:[0.004,0.004,0.006],planet:[0.01,0.03,0.07],lit:[0.12,0.22,0.38],glow:[0,0,0]},
};
function buildEnvironment(){
  SFLook.environment(renderer,scene,ENV_LOOK[SEL.loc]||ENV_LOOK.tauri,LOC.planet?
    {sun:LOC.sun,planet:LOC.at,planetR:Math.asin(Math.min(0.999,PLANET_R/LOC.at.length()))}:{});
}
function setupLocation(){
  LOC=LOCATIONS[SEL.loc]||LOCATIONS.tauri;SEL.loc=LOC===LOCATIONS[SEL.loc]?SEL.loc:'tauri';
  document.title=`Six Fleets · Skirmish at ${LOC.name}`;
  $('sk-star').firstElementChild.textContent=`${LOC.hazard} PROXIMITY`;
  buildEnvironment();
  if(!LOC.planet){
    if(!_sq.has('noplanet'))addPlanet('veyrath',{radius:BACKDROP_R,position:BACKDROP_AT,light:new V3(),tilt:0.32});
    return;
  }
  volMat.uniforms.uRN.value=1e-3;                          // every ray misses the nebula: no dust, and a cheaper frame
  const sun=LOC.sun;
  for(const m of [star,corona,spikes])m.position.copy(sun);
  star.scale.setScalar(5);corona.scale.setScalar(3);spikes.scale.setScalar(2);
  sunLight.position.copy(sun);
  scene.traverse(o=>{if(o.isAmbientLight)o.intensity*=0.5;});
  HZ.x=LOC.at.x;HZ.y=LOC.at.y;HZ.z=LOC.at.z;HZ.R=PLANET_R*1.03;   // the lower atmosphere is as deep as a hull goes
  addPlanet(LOC.planet,{radius:PLANET_R,position:LOC.at,light:sun,spin:LOC.spin,tilt:LOC.tilt});
}

SK.start=function(){
  document.body.classList.add('skirmish');
  loadModels().then(missing=>{
    if(missing.length){$('sk-end-title').textContent='HULLS NOT LOADED';$('sk-sheets').textContent=missing.join(' · ');document.body.classList.add('sk-over');return;}
    const q=new URLSearchParams(location.search);
    if(LOCATIONS[q.get('loc')])SEL.loc=q.get('loc');
    const pair=FLEET[q.get('p')]&&FLEET[q.get('e')];
    if(!q.has('pick')&&(pair||q.has('auto'))){if(pair){SEL.player=q.get('p');SEL.enemy=q.get('e');}begin();}   // ?auto alone: the default pair
    else picker();
  });
};
function picker(){
  const q=new URLSearchParams(location.search);
  if(FLEET[q.get('p')])SEL.player=q.get('p');if(FLEET[q.get('e')])SEL.enemy=q.get('e');
  const row=(side,el)=>{
    el.innerHTML=FLEET_IDS.map(id=>{const D=FLEET[id];return `<button type="button" data-id="${id}" class="${SEL[side]===id?'on':''}"><b>${D.cls}</b><span>${D.race}</span></button>`;}).join('');
    for(const b of el.querySelectorAll('button'))b.addEventListener('click',()=>{SEL[side]=b.dataset.id;row(side,el);});
  };
  row('player',$('sk-pick-p'));row('enemy',$('sk-pick-e'));
  const locRow=()=>{
    const el=$('sk-pick-l');
    el.innerHTML=LOC_IDS.map(id=>{const L=LOCATIONS[id];return `<button type="button" data-id="${id}" class="${SEL.loc===id?'on':''}"><b>${L.name.toUpperCase()}</b><span>${L.sub}</span></button>`;}).join('');
    for(const b of el.querySelectorAll('button'))b.addEventListener('click',()=>{SEL.loc=b.dataset.id;locRow();});
    $('sk-pick-title').textContent=`SKIRMISH AT ${LOCATIONS[SEL.loc].name.toUpperCase()}`;
  };
  if(LOCATIONS[q.get('loc')])SEL.loc=q.get('loc');
  locRow();
  document.body.classList.add('sk-picking');
}
// the picker's Control Keys page: it takes the box's place until Back (or Esc)
function showKeys(on){$('sk-pick').firstElementChild.classList.toggle('keys',on);(on?$('sk-keys-back'):$('sk-keys-btn')).focus();}
function launchPick(auto){
  if(!document.body.classList.contains('sk-picking'))return;
  const q=new URLSearchParams();q.set('p',SEL.player);q.set('e',SEL.enemy);if(SEL.loc!=='tauri')q.set('loc',SEL.loc);if(auto)q.set('auto','');
  history.replaceState(null,'',location.pathname+'?'+q.toString().replace(/=(&|$)/g,'$1'));
  document.body.classList.remove('sk-picking');
  begin();
}
function begin(){
  SO.mode='skirmish';S.mode='orbit';S.ts=0.35;
  clearSky();parkStation();
  for(const f of foes){f.alive=false;f.m.visible=false;f.respawn=1e9;}
  ship.visible=false;moteLines.visible=false;
  // the same class on both sides: the opponent is the hull's second ship, with its own damage record
  const pk=FLEET[SEL.player].hull, ek=FLEET[SEL.enemy].hull+(SEL.enemy===SEL.player?'_2':'');
  Bridge.reset([pk,ek]);
  PL=makeShip('player',SEL.player,pk);AI=makeShip('enemy',SEL.enemy,ek);ships=[PL,AI];
  for(const S of ships)SFLook.dressShip(S.g,FLEET[S.id].model,LOOK[FLEET[S.id].model]);
  if(AI.key.endsWith('_2'))AI.name+=' II';
  const phi=0.3, rad=new V3(Math.cos(phi),0,Math.sin(phi)), tan=new V3(-Math.sin(phi),0,Math.cos(phi));
  PL.pos.copy(rad).multiplyScalar(150).setY(PL.y);
  AI.pos.copy(PL.pos).addScaledVector(tan,START_GAP).addScaledVector(rad,40).setY(AI.y);
  const face=(A,B)=>{const d=_t1.subVectors(B.pos,A.pos);A.yaw=Math.atan2(-d.x,-d.z);};
  face(PL,AI);face(AI,PL);AI.yaw+=0.35;
  for(const S of ships)placeShip(S);
  for(let i=0;i<16;i++){const m=beamMesh();beams.push({m,mat:m.material,on:false});}
  for(let i=0;i<48;i++)sprites.push(glowSprite());
  sunLight.distance=0;
  setupLocation();
  buildExplosions();
  SK.fill=new THREE.DirectionalLight(0x8fa6d8,0.32);scene.add(SK.fill,SK.fill.target);
  orbit.az=0;orbit.el=0.3;orbit.dist=380;orbit.auto=false;
  const q=new URLSearchParams(location.search);
  SK.auto=q.has('auto');
  SK.on=true;
  note('Helm: A/D turn, W/S throttle, R/F climb and dive, Q rapid speed turn, hold X to self-destruct. Fire: 1 projectors, 2 heavy weapons, Space everything that bears. K records, P takes a photo, C hides the HUD.','dim');
  window.__sk=SK;
}
SK.dom=function(){
  addEventListener('keydown',e=>{
    if(document.body.classList.contains('sk-picking')){
      const box=$('sk-pick').firstElementChild, open=box.classList.contains('keys');
      if(e.code==='Escape'&&open){e.preventDefault();showKeys(false);return;}
      if(e.code==='Enter'){e.preventDefault();if(open)showKeys(false);launchPick(false);return;}
    }
    if(!SK.on)return;
    const k=e.code, mine=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Digit1','Digit2','KeyV','KeyH','KeyR','KeyF','KeyJ','Tab','KeyK','KeyP','KeyC','KeyQ','KeyX','Backquote'];
    if(!mine.includes(k))return;
    e.preventDefault();e.stopImmediatePropagation();
    if(e.repeat&&!/Key[WASDRF]|Arrow/.test(k))return;
    keyDown[k]=true;
    if(k==='Digit1')want.qip=true;
    if(k==='Digit2')want.heavy=true;
    if(k==='Space')want.all=true;
    if(k==='KeyQ')want.snap=true;
    if(k==='KeyV'||k==='Tab')nextCam();
    if(k==='KeyK')toggleRec();
    if(k==='KeyP')photo();
    if(k==='KeyC')toggleClean();
    if(k==='KeyH')document.body.classList.toggle('sk-nohelp');
    if(k==='Backquote')dbgToggle();
    if(k==='KeyJ')SK.auto=!SK.auto;
    if(k==='KeyR'&&SK.over)again();
  },true);
  addEventListener('keyup',e=>{if(SK.on)keyDown[e.code]=false;},true);
  // touch: hold-to-steer and fire buttons
  for(const el of document.querySelectorAll('#sk-touch [data-k]')){
    const k=el.dataset.k,on=e=>{e.preventDefault();e.stopPropagation();keyDown[k]=true;},off=()=>{keyDown[k]=false;};
    el.addEventListener('pointerdown',on);el.addEventListener('pointerup',off);el.addEventListener('pointercancel',off);el.addEventListener('pointerleave',off);
  }
  $('sk-again').addEventListener('click',again);
  $('sk-go').addEventListener('click',()=>launchPick(false));
  $('sk-watch').addEventListener('click',()=>launchPick(true));
  $('sk-keys-btn').addEventListener('click',()=>showKeys(true));
  $('sk-keys-back').addEventListener('click',()=>showKeys(false));
  $('sk-change').addEventListener('click',()=>{const go=()=>{location.search='?pick&p='+SEL.player+'&e='+SEL.enemy;};if(REC.mr){REC.onSaved=go;REC.mr.stop();}else go();});
  $('sk-save').addEventListener('click',saveResult);
  $('sk-cam').addEventListener('click',nextCam);
  $('sk-rec').addEventListener('click',toggleRec);
  $('sk-endrec').addEventListener('click',()=>{if(REC.mr)REC.mr.stop();});
  $('sk-photo').addEventListener('click',photo);
  $('sk-clean').addEventListener('click',toggleClean);
  $('sk-unclean').addEventListener('click',toggleClean);
  if(!recType())$('sk-rec').hidden=true;
};
})();
