/* Planet backdrops for the battle pages (three.js r147, global THREE).

   SFPlanet.build(opts) -> { group, update(camera), ready }
     opts.maps     { color, normal, rough, emis?, clouds? }  image URLs (data: URIs in the built pages)
     opts.meta     planet.json from tools/planets/bake_planet.py (atmo colour/density, which maps exist)
     opts.radius   world units
     opts.position THREE.Vector3, the planet's centre
     opts.light    THREE.Vector3, the system's star (the only light the planet sees)
     opts.sun      THREE.Color, the star's light colour (linear), default warm white
     opts.sunIntensity  the star's light on the surface, default 3.2
     opts.spin     radians per second about the planet's axis, default a slow drift
     opts.tilt     axial tilt in radians

   The maps are baked offline (tools/planets) from Deep Space's terrain functions in three.js SphereGeometry's
   UV layout, so they wrap a plain sphere with no seam. The planet is lit by its own shaders from opts.light
   alone: the scene's ambient and fill lights are there for the ships and would light the night side. The
   atmosphere is Deep Space's raymarched single-scatter shell (src/atmosphere-webgl.js, MIT, Eray114514),
   with a fixed step count and a dithered start instead of its temporal half-resolution pass. */
(function () {
  'use strict';

  const SURFACE_VS = `
    varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    void main(){
      vUv=uv; vN=normalize(mat3(modelMatrix)*normal);
      vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz;
      gl_Position=projectionMatrix*viewMatrix*w;
    }`;

  // the sphere's tangent frame is analytic: east = Y x n, north = n x east (matches the bake's +x/+y)
  const FRAME = `
    vec3 tangentNormal(vec3 nObj, vec3 ts, mat3 toWorld){
      vec3 east=normalize(cross(vec3(0.0,1.0,0.0),nObj)+vec3(1e-5,0.0,0.0));
      vec3 north=cross(nObj,east);
      return normalize(toWorld*(east*ts.x+north*ts.y+nObj*ts.z));
    }`;

  const SURFACE_FS = `
    uniform sampler2D uColor,uNormal,uRough,uEmis;
    uniform float uHasEmis,uSpecK;
    uniform vec3 uLightPos,uSun,uCentre,uNight;
    uniform mat3 uToWorld;
    varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    ${FRAME}
    void main(){
      vec3 nGeo=normalize(vW-uCentre);
      vec3 nObj=normalize(transpose(uToWorld)*nGeo);
      vec3 ts=texture2D(uNormal,vUv).xyz*2.0-1.0;
      vec3 n=tangentNormal(nObj,ts,uToWorld);
      vec3 L=normalize(uLightPos-vW), V=normalize(cameraPosition-vW);
      vec3 albedo=pow(texture2D(uColor,vUv).rgb,vec3(2.2));
      float rough=texture2D(uRough,vUv).r;
      // relief shades the day side; the terminator follows the true sphere so mountains can't light the night
      float geo=dot(nGeo,L);
      float lit=max(dot(n,L),0.0)*smoothstep(-0.08,0.12,geo);
      float wrap=smoothstep(-0.25,0.15,geo)*0.06;             // a little scattered light past the terminator
      vec3 col=albedo*uSun*(lit+wrap)+albedo*uNight;
      vec3 H=normalize(L+V);
      float shin=mix(220.0,8.0,rough);
      float spec=pow(max(dot(n,H),0.0),shin)*(1.0-rough)*uSpecK*smoothstep(0.0,0.15,geo);
      col+=uSun*spec;
      if(uHasEmis>0.5){
        float e=texture2D(uEmis,vUv).r;                          // the bake's ember weight (red = 255 * e)
        // heat ramp: deep red crust edges, orange flows, yellow-white cores
        vec3 heat=mix(vec3(0.35,0.03,0.0),vec3(1.0,0.32,0.04),smoothstep(0.05,0.55,e));
        heat=mix(heat,vec3(1.6,1.05,0.5),smoothstep(0.7,1.0,e));
        float glow=e*e*(0.45+0.85*smoothstep(0.25,-0.35,geo));   // reads strongest on the night side
        col=mix(col,col*0.35,smoothstep(0.1,0.5,e))+heat*glow*0.9;
      }
      gl_FragColor=vec4(col,1.0);
    }`;

  const CLOUD_FS = `
    uniform sampler2D uClouds;
    uniform vec3 uLightPos,uSun,uCentre,uNight;
    varying vec2 vUv; varying vec3 vN; varying vec3 vW;
    void main(){
      float a=texture2D(uClouds,vUv).r;
      if(a<0.01)discard;
      vec3 n=normalize(vW-uCentre), L=normalize(uLightPos-vW);
      float geo=dot(n,L);
      float lit=max(geo,0.0)*0.92+smoothstep(-0.2,0.1,geo)*0.08;
      gl_FragColor=vec4(vec3(0.95,0.97,1.0)*(uSun*lit+uNight),a*0.88);
    }`;

  // Deep Space atmosphere-webgl.js, trimmed of its scene-depth inputs (the planet is the only thing inside it)
  const ATMO_VS = `
    uniform vec3 uCameraLocal; varying vec3 vDirection;
    void main(){
      vDirection=position-uCameraLocal;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
    }`;
  const ATMO_FS = `
    precision highp float;
    uniform vec3 atmoColor,sunDir,uCameraLocal,uSun;
    uniform float density,uGroundR,uAtmoR;
    varying vec3 vDirection;
    vec2 sphereHits(vec3 o,float r,vec3 d){
      float b=dot(o,d),disc=b*b-dot(o,o)+r*r;
      if(disc<0.0)return vec2(-1.0);
      float s=sqrt(disc);return vec2(-b-s,-b+s);
    }
    void main(){
      vec3 dir=normalize(vDirection);
      vec2 outer=sphereHits(uCameraLocal,uAtmoR,dir);
      if(outer.y<=0.0)discard;
      vec2 ground=sphereHits(uCameraLocal,uGroundR,dir);
      float t0=max(outer.x,0.0),t1=outer.y;
      if(ground.x>t0)t1=min(t1,ground.x);
      if(t1<=t0)discard;
      const int STEPS=24;
      float dt=(t1-t0)/float(STEPS);
      float ign=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));
      float t=t0+dt*ign;
      float mu=dot(dir,normalize(sunDir));
      float rayleighPhase=0.05968*(1.0+mu*mu);
      float g=0.76;
      float miePhase=0.07958*(1.0-g*g)/pow(max(0.04,1.0+g*g-2.0*g*mu),1.5);
      vec3 rayleighColor=mix(vec3(0.48,0.68,1.0),max(atmoColor,vec3(0.015)),0.58);
      vec3 col=vec3(0.0);float trans=1.0;
      for(int i=0;i<STEPS;i++){
        vec3 p=uCameraLocal+dir*t;
        float r=length(p);
        float h=clamp((r-uGroundR)/max(uAtmoR-uGroundR,1e-4),0.0,1.0);
        float rhoR=exp(-h*6.2)*density, rhoM=exp(-h*15.0)*density*0.22;
        vec3 radial=p/max(r,1e-4);
        float sunMu=dot(radial,normalize(sunDir));
        float horizon=smoothstep(-0.13,0.055,sunMu);
        float slant=1.0/max(0.16,sunMu+0.32);
        float sunTrans=exp(-(rhoR*0.32+rhoM*1.4)*slant)*horizon;
        vec3 scatter=rayleighColor*rhoR*rayleighPhase+vec3(1.0,0.93,0.82)*rhoM*miePhase;
        scatter*=sunTrans+0.075*density*(1.0-h);
        float extinction=(rhoR*0.58+rhoM*1.8)*dt/max(uAtmoR-uGroundR,1e-4);
        float a=1.0-exp(-extinction*0.62);
        col+=trans*a*scatter*11.0;
        trans*=1.0-a;
        t+=dt;
      }
      float alpha=clamp(1.0-trans,0.0,0.985);
      if(alpha<0.001)discard;
      gl_FragColor=vec4(col*uSun,alpha);
    }`;

  function hexColor(s) { return new THREE.Color(s).convertSRGBToLinear(); }

  function build(o) {
    const R = o.radius, meta = o.meta, P = o.position.clone();
    const tint = (o.sun || new THREE.Color(1.0, 0.86, 0.7)).clone();
    const sun = tint.clone().multiplyScalar(o.sunIntensity == null ? 3.2 : o.sunIntensity);
    const group = new THREE.Group();
    group.position.copy(P);
    group.name = 'planet:' + (meta.name || meta.type);

    const body = new THREE.Group();                       // spins; the atmosphere does not need to
    body.rotation.z = o.tilt || 0;
    group.add(body);

    const loader = new THREE.TextureLoader();
    const texs = [];
    const load = url => new Promise(res => {
      if (!url) return res(null);
      loader.load(url, t => { t.wrapS = THREE.RepeatWrapping; t.anisotropy = o.anisotropy || 4; texs.push(t); res(t); },
        undefined, () => res(null));
    });
    const toWorld = new THREE.Matrix3();
    const common = { uLightPos: { value: o.light.clone() }, uSun: { value: sun }, uCentre: { value: P },
      uNight: { value: new THREE.Color(0.006, 0.007, 0.011) }, uToWorld: { value: toWorld } };

    const surfMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uColor: { value: null }, uNormal: { value: null }, uRough: { value: null },
        uEmis: { value: null }, uHasEmis: { value: 0 }, uSpecK: { value: 0.55 } }, common),
      vertexShader: SURFACE_VS, fragmentShader: SURFACE_FS,
    });
    const surface = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 120), surfMat);
    surface.visible = false;                              // until its maps are in
    body.add(surface);

    let deck = null;
    if (meta.clouds) {
      const cloudMat = new THREE.ShaderMaterial({
        uniforms: Object.assign({ uClouds: { value: null } }, common),
        vertexShader: SURFACE_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false,
      });
      deck = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 128, 96), cloudMat);
      deck.visible = false;
      body.add(deck);
    }

    const atmoR = R * 1.1;
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: { atmoColor: { value: hexColor(meta.atmo || '#69b4ff') }, density: { value: meta.atmoDensity || 1 },
        sunDir: { value: o.light.clone().sub(P).normalize() }, uCameraLocal: { value: new THREE.Vector3() },
        uGroundR: { value: R }, uAtmoR: { value: atmoR }, uSun: { value: tint } },   // Deep Space's calibration
      vertexShader: ATMO_VS, fragmentShader: ATMO_FS,
      side: THREE.BackSide, transparent: true, premultipliedAlpha: true, depthWrite: false,
    });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(atmoR, 128, 96), atmoMat);
    atmo.renderOrder = 1;
    group.add(atmo);

    const spin = o.spin == null ? 0.004 : o.spin;
    const ready = Promise.all([load(o.maps.color), load(o.maps.normal), load(o.maps.rough),
      load(o.maps.emis), load(o.maps.clouds)]).then(([c, n, r, e, cl]) => {
      const u = surfMat.uniforms;
      u.uColor.value = c; u.uNormal.value = n; u.uRough.value = r;
      if (e) { u.uEmis.value = e; u.uHasEmis.value = 1; } else u.uEmis.value = c;
      surface.visible = !!(c && n && r);
      if (deck && cl) { deck.material.uniforms.uClouds.value = cl; deck.visible = true; }
      return surface.visible;
    });

    const tmpM = new THREE.Matrix4();
    function update(camera, dt) {
      body.rotation.y += spin * (dt || 0);
      if (deck) deck.rotation.y += spin * 0.35 * (dt || 0);   // weather drifts against the ground
      body.updateMatrixWorld(true);
      toWorld.setFromMatrix4(tmpM.extractRotation(surface.matrixWorld));
      atmoMat.uniforms.uCameraLocal.value.copy(camera.position).sub(P);
    }

    function dispose() {
      for (const t of texs) t.dispose();
      surface.geometry.dispose(); surfMat.dispose(); atmo.geometry.dispose(); atmoMat.dispose();
      if (deck) { deck.geometry.dispose(); deck.material.dispose(); }
    }
    return { group, update, ready, dispose, radius: R, position: P };
  }

  window.SFPlanet = { build };
})();
