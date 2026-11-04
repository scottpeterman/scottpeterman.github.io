/* The ship look shared by the battle pages (the skirmish and the film): polished metal that mirrors a sky built for
   the scene, plating drawn in the shader, baked occlusion in the creases, and drive exhausts with a heat gradient.
   Plain script on global THREE (r147), loaded before the page's own code; everything it needs is passed in.

   SFLook.environment(renderer, scene, look, opts)  a sky for the hulls to mirror, into scene.environment
       look {up, mid, down [, planet, lit, glow]}  linear colours; opts {sun, planet, planetR}: unit directions
       and the planet's angular radius (sun hot spot and planet disc only when given)
   SFLook.dressShip(group, model, L)               metal + plating + occlusion on the hull materials, drives on the
       exhaust discs; model keys the occlusion field (#film-ao), L is the page's LOOK entry (eng, core colours)
   SFLook.tick(t, groups)                           per frame: drive flicker time, and each ship's frame for the plating

   URL flags (before/after): ?noenv ?nodetail ?noao ?nodrives */
(function(){
'use strict';
const Q=new URLSearchParams(location.search);

/* ---------- reflections: a sky for the hulls to mirror ----------
   The hulls are metal (MeshStandardMaterial) and had nothing to reflect, so they read as flat paint. The page builds
   a small sky scene, prefiltered (PMREM) into scene.environment, which every standard material picks up. */
function environment(renderer,scene,look,opts){
  if(Q.has('noenv'))return;
  opts=opts||{};
  const v3=a=>new THREE.Vector3(...(a||[0,0,0])), hasPl=!!opts.planet;
  const sun=opts.sun?opts.sun.clone().normalize():new THREE.Vector3(0,1,0);
  const pl=hasPl?opts.planet.clone().normalize():new THREE.Vector3(0,-1,0);
  const mat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
    uniforms:{uUp:{value:v3(look.up)},uMid:{value:v3(look.mid)},uDown:{value:v3(look.down)},uSun:{value:sun},uPl:{value:pl},
      uPlanet:{value:v3(look.planet)},uLit:{value:v3(look.lit)},uGlow:{value:v3(look.glow)},uHasPl:{value:hasPl?1:0},
      uSunK:{value:opts.sun?1:0},uPlR:{value:opts.planetR||0}},
    vertexShader:`varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform vec3 uUp,uMid,uDown,uSun,uPl,uPlanet,uLit,uGlow;uniform float uHasPl,uSunK,uPlR;varying vec3 vD;
      void main(){vec3 d=normalize(vD);
        vec3 c=d.y>0.0?mix(uMid,uUp,smoothstep(0.0,0.7,d.y)):mix(uMid,uDown,smoothstep(0.0,0.7,-d.y));
        if(uHasPl>0.5){
          float a=acos(clamp(dot(d,uPl),-1.0,1.0)), disc=1.0-smoothstep(uPlR-0.03,uPlR+0.01,a);
          vec3 n=normalize(d-uPl*cos(a));                       // roughly the surface normal seen along d
          float day=smoothstep(-0.15,0.5,dot(normalize(n+uPl*0.4),uSun));
          vec3 pc=uPlanet+uLit*day+uGlow*(1.0-day);
          float limb=exp(-pow((a-uPlR)/0.05,2.0));
          c=mix(c,pc,disc)+uLit*limb*0.35*day;
        }
        float s=max(dot(d,uSun),0.0);
        c+=uSunK*(vec3(40.0,34.0,27.0)*pow(s,1400.0)+vec3(0.18,0.15,0.11)*pow(s,60.0));
        gl_FragColor=vec4(c,1.0);}`});
  const env=new THREE.Scene();env.add(new THREE.Mesh(new THREE.SphereGeometry(10,64,32),mat));
  const pm=new THREE.PMREMGenerator(renderer);
  scene.environment=pm.fromScene(env,0,0.1,100).texture;
  pm.dispose();mat.dispose();
  // with a sky to mirror, the flat ambient fill only washes the metal out
  scene.traverse(o=>{if(o.isAmbientLight)o.intensity*=0.45;});
}

/* ---------- hull detail: plating, seams, grime and light strips, in the shader ----------
   The models have no UVs, so the plating is projected from three sides (triplanar) in the ship's own frame: the
   pattern runs on across parts and stays put as the ship turns. Panels are staggered rows, longer along the hull
   (about 1/26 of its length) than across. Seams darken and roughen; each panel varies a little in tone and polish,
   which is what breaks the reflections up plate by plate; a slow noise lays grime over it; and a few panels carry
   a thin light strip in the ship's shield colour (bloom does the glow). Seams fade out before they shimmer: the
   detail is weighted by how many pixels a panel covers. ?nodetail leaves it out (before/after). */
const DETAIL_GLSL=`
float sfH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float sfN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(sfH(i),sfH(i+vec2(1,0)),f.x),mix(sfH(i+vec2(0,1)),sfH(i+vec2(1,1)),f.x),f.y);}
// p: the face's 2D coordinates in panel units (x along the hull). returns seam, panel id, strip, detail fade
vec4 sfPanel(vec2 p){
  float row=floor(p.y);
  p.x+=sfH(vec2(row,3.7))*0.6+row*0.37;                     // staggered rows
  vec2 c=floor(p),f=fract(p),fw=max(fwidth(p),vec2(1e-4));
  vec2 d=min(f,1.0-f)/fw;                                    // distance to the seams in pixels
  float seam=1.0-smoothstep(0.6,1.6,min(d.x,d.y));
  float fade=1.0-smoothstep(0.08,0.3,max(fw.x,fw.y));       // under ~4 px a panel: let the seams go
  float id=sfH(c+vec2(11.3,4.1));
  float strip=step(0.955,id)*(1.0-smoothstep(0.0,1.2,abs(f.y-0.3)/fw.y))*step(0.12,f.x)*step(f.x,0.88);
  return vec4(seam*fade,id,strip*fade,fade);
}`;
/* baked occlusion: shipkit.bake_occlusion() writes a small 3D field per hull (0 open .. 255 deep in a crease), embedded
   as #film-ao by tools/embed_hulls.py. It is sampled just off the surface in the model's own frame, so creases
   darken however big the faces are. ?noao leaves it out. */
let AO_FIELDS;const AO_TEX={};
function aoTexture(model){
  if(Q.has('noao'))return null;
  if(AO_FIELDS===undefined){try{AO_FIELDS=JSON.parse(document.getElementById('film-ao').textContent);}catch(e){AO_FIELDS=null;}}
  const f=AO_FIELDS&&AO_FIELDS[model];if(!f)return null;
  if(!AO_TEX[model]){
    const bin=atob(f.data), u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
    const t=new THREE.Data3DTexture(u8,f.dims[0],f.dims[1],f.dims[2]);
    t.format=THREE.RedFormat;t.type=THREE.UnsignedByteType;t.minFilter=t.magFilter=THREE.LinearFilter;
    t.wrapS=t.wrapT=t.wrapR=THREE.ClampToEdgeWrapping;t.unpackAlignment=1;t.needsUpdate=true;
    AO_TEX[model]={tex:t,c0:new THREE.Vector3(...f.c0),pitch:f.pitch,dims:new THREE.Vector3(...f.dims)};
  }
  return AO_TEX[model];
}
function addDetail(m,g,model){
  const len=Math.max(4,(g.userData.hullAx?g.userData.hullAx.z*2:new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).z));
  const col=(g.userData.shield&&g.userData.shield.col||new THREE.Color(0.6,0.4,1.2)).clone();
  const k=1.6/Math.max(col.r,col.g,col.b);col.multiplyScalar(k);   // a lit strip, whatever the shield's brightness
  g.userData.detailInv=g.userData.detailInv||new THREE.Matrix4();
  const ao=aoTexture(model);
  const U={uShipInv:{value:g.userData.detailInv},uCell:{value:new THREE.Vector2(len/26,len/52)},uStrip:{value:col},
    uAO:{value:ao?ao.tex:null},uAOc0:{value:ao?ao.c0:new THREE.Vector3()},uAOpitch:{value:ao?ao.pitch:1},uAOdims:{value:ao?ao.dims:new THREE.Vector3(1,1,1)},uAOon:{value:ao?1:0}};
  m.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,U);
    sh.vertexShader='uniform mat4 uShipInv;\nvarying vec3 vShip;\nvarying vec3 vKit;\n'+sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n  vShip=(uShipInv*modelMatrix*vec4(transformed,1.0)).xyz;\n  vKit=transformed;');
    sh.fragmentShader='precision highp sampler3D;\nuniform vec2 uCell;uniform vec3 uStrip;\nuniform sampler3D uAO;uniform vec3 uAOc0,uAOdims;uniform float uAOpitch,uAOon;\nvarying vec3 vShip;\nvarying vec3 vKit;\n'+DETAIL_GLSL+'\n'+sh.fragmentShader
      .replace('#include <color_fragment>',`#include <color_fragment>
  vec3 sfn=normalize(cross(dFdx(vShip),dFdy(vShip)));vec3 sfw=pow(abs(sfn),vec3(4.0));sfw/=sfw.x+sfw.y+sfw.z;
  vec4 sfA=sfPanel(vec2(vShip.z,vShip.y)/uCell), sfB=sfPanel(vec2(vShip.z,vShip.x)/uCell), sfC=sfPanel(vec2(vShip.x,vShip.y)/uCell.yy);
  vec4 sfP=sfA*sfw.x+sfB*sfw.y+sfC*sfw.z;
  float sfGrime=mix(0.82,1.0,sfN(vShip.zx*0.35+vShip.y*0.2))*mix(0.9,1.0,sfN(vShip.zy*1.7));
  diffuseColor.rgb*=mix(1.0,0.45,sfP.x)*mix(1.0,0.86+0.28*sfP.y,sfP.w)*sfGrime;
  float sfAO=1.0;
  if(uAOon>0.5){vec3 kn=normalize(cross(dFdx(vKit),dFdy(vKit)));
    vec3 uvw=((vKit+kn*uAOpitch*0.75-uAOc0)/uAOpitch+0.5)/uAOdims;
    sfAO=1.0-0.78*texture(uAO,uvw).r;}
  diffuseColor.rgb*=mix(1.0,sfAO,0.6);`)
      .replace('#include <aomap_fragment>',`#include <aomap_fragment>
  reflectedLight.indirectDiffuse*=sfAO;reflectedLight.indirectSpecular*=sfAO*sfAO;`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
  roughnessFactor=clamp(roughnessFactor+sfP.x*0.35+(sfP.y-0.5)*0.18*sfP.w+(1.0-sfGrime)*0.6,0.04,1.0);`)
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
  totalEmissiveRadiance+=uStrip*sfP.z;`);
  };
  m.customProgramCacheKey=()=>'sfdetail';
}
/** Hull and trim materials as polished metal, once there is something to reflect (they are cached per hull),
    with the plating detail on the vertex-coloured hull and trim. */
function metalise(g,model){
  const env=!Q.has('noenv'), detail=!Q.has('nodetail');
  g.traverse(o=>{const m=o.material;if(!o.isMesh||!m||!m.isMeshStandardMaterial||m.userData.metal)return;
    m.userData.metal=true;
    if(env){
      if(m.metalness>=0.7){m.metalness=0.9;m.roughness=Math.min(m.roughness,0.24);}   // trim, stripes, rings
      else{m.metalness=0.8;m.roughness=0.3;}
    }
    if(detail&&m.vertexColors)addDetail(m,g,model);
    m.needsUpdate=true;});
}
/* ---------- drive exhausts: a heat gradient instead of a flat plate ----------
   Each hull's exhaust discs come merged into one mesh (engine_glow, and the smaller engine_glow_core in front). At
   launch the mesh is split into its discs (connected components), and every vertex learns its disc's centre and
   radius; the shader then draws a white-hot core, the race's drive colour through the middle and a dimmer rim, with
   a slow flicker, brighter seen head-on. ?nodrives leaves the flat discs. */
const DRIVE_T={value:0};
function discAttributes(geo){
  const pos=geo.attributes.position, n=pos.count, idx=geo.index?geo.index.array:null;
  const parent=new Int32Array(n);for(let i=0;i<n;i++)parent[i]=i;
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const tri=idx?idx.length:n;
  for(let t=0;t<tri;t+=3){const a=find(idx?idx[t]:t),b=find(idx?idx[t+1]:t+1),c=find(idx?idx[t+2]:t+2);parent[b]=a;parent[find(c)]=a;}
  // positions shared by unindexed duplicates: weld by position so a disc stays one component
  if(!idx){const key=new Map();for(let i=0;i<n;i++){const k=pos.getX(i).toFixed(4)+','+pos.getY(i).toFixed(4)+','+pos.getZ(i).toFixed(4);
    if(key.has(k))parent[find(i)]=find(key.get(k));else key.set(k,i);}}
  const sum=new Map(), v=new THREE.Vector3();
  for(let i=0;i<n;i++){const r=find(i);v.fromBufferAttribute(pos,i);const e=sum.get(r)||{c:new THREE.Vector3(),k:0,r:0};e.c.add(v);e.k++;sum.set(r,e);}
  for(const e of sum.values())e.c.divideScalar(e.k);
  for(let i=0;i<n;i++){const e=sum.get(find(i));v.fromBufferAttribute(pos,i);e.r=Math.max(e.r,v.distanceTo(e.c));}
  const ctr=new Float32Array(n*3), rad=new Float32Array(n);
  for(let i=0;i<n;i++){const e=sum.get(find(i));ctr[i*3]=e.c.x;ctr[i*3+1]=e.c.y;ctr[i*3+2]=e.c.z;rad[i]=e.r||1;}
  geo.setAttribute('aDisc',new THREE.BufferAttribute(ctr,3));geo.setAttribute('aDiscR',new THREE.BufferAttribute(rad,1));
}
function driveMaterial(col,core){
  const c=col.clone(), hot=core?col.clone():c.clone().lerp(new THREE.Color(1,1,1),0.6);
  return new THREE.ShaderMaterial({side:THREE.DoubleSide,
    uniforms:{uCol:{value:c},uHot:{value:hot},uT:DRIVE_T,uCore:{value:core?1:0}},
    vertexShader:`attribute vec3 aDisc;attribute float aDiscR;varying float vR;varying vec3 vN;varying vec3 vV;varying float vSeed;
      void main(){vR=length(position-aDisc)/aDiscR;vSeed=dot(aDisc,vec3(12.9,78.2,37.7));
        vec4 w=modelMatrix*vec4(position,1.0);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-w.xyz);
        gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`uniform vec3 uCol,uHot;uniform float uT,uCore;varying float vR;varying vec3 vN;varying vec3 vV;varying float vSeed;
      void main(){float r=clamp(vR,0.0,1.0);
        float flick=0.9+0.1*sin(uT*31.0+vSeed)+0.05*sin(uT*67.0+vSeed*1.7);
        float face=0.55+0.45*abs(dot(normalize(vN),vV));         // head-on, you look into the drive
        vec3 c=mix(uHot,uCol,smoothstep(0.0,0.55,r))*mix(1.0,0.28,smoothstep(0.55,1.0,r));
        c*=mix(0.55,1.0,uCore)*flick*face;
        gl_FragColor=vec4(c,1.0);}`});
}
function dressDrives(g,L){
  if(Q.has('nodrives')||!L)return;
  g.traverse(o=>{
    if(!o.isMesh)return;const base=o.name.replace(/_\d+$/,'');
    if(!/^engine_glow/.test(base))return;
    if(!o.geometry.attributes.aDisc){o.geometry=o.geometry.clone();discAttributes(o.geometry);
      if(!o.geometry.attributes.normal)o.geometry.computeVertexNormals();}   // the GLB's glow discs carry none
    const core=/^engine_glow_core/.test(base);
    o.material=driveMaterial(new THREE.Color(...(core?L.core:L.eng)),core);
  });
}

function dressShip(g,model,L){metalise(g,model);dressDrives(g,L);}
function tick(t,groups){
  DRIVE_T.value=t;
  for(const g of groups)if(g&&g.userData.detailInv){g.updateMatrixWorld();g.userData.detailInv.copy(g.matrixWorld).invert();}
}
window.SFLook={environment,dressShip,tick};
})();
