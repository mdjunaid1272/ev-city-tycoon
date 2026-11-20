import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // always at the far plane
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uTop, uHorizon, uSunDir, uSunColor, uMoonDir;
  uniform float uNight, uSunVis;
  varying vec3 vDir;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.5));
    if (d.y < 0.0) col = uHorizon;
    // sun: hard disc + warm halo that widens near the horizon
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 1400.0) * 2.0 + pow(sd, 48.0) * 0.30 * uSunVis + pow(sd, 6.0) * 0.14 * uSunVis);
    // moon + stars
    float md = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.9, 0.94, 1.0) * pow(md, 2600.0) * 1.4 * uNight + vec3(0.45, 0.55, 0.9) * pow(md, 60.0) * 0.16 * uNight;
    float s = hash(floor(d * 260.0));
    float star = step(0.9972, s) * smoothstep(0.04, 0.4, d.y) * uNight;
    col += vec3(star);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const mix3 = (a, b, t, out) => out.copy(a).lerp(b, t);
const C = (h) => new THREE.Color(h);
const DAY_TOP = C(0x3d8fe0), NIGHT_TOP = C(0x050a1e), DUSK_TOP = C(0x6a5aa8);
const SUN_HIGH = C(0xfff4d0), SUN_LOW = C(0xff7a3a);
const CLOUD_DAY = C(0xffffff), CLOUD_DUSK = C(0xffb89a), CLOUD_NIGHT = C(0x2a3358);

function glowTexture(inner = 0.0) {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, S * inner, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,236,170,1)'); gr.addColorStop(0.35, 'rgba(255,214,120,0.45)'); gr.addColorStop(1, 'rgba(255,200,100,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sky dome (gradient, sun, moon, stars), drifting clouds and night lamp glow. Purely visual. */
export class Environment {
  constructor({ scene, settings }) {
    this.scene = scene;
    this.detail = settings.quality.detail ?? 1;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.time = 0;
    this._c = new THREE.Color();
    this.night = 0;
    this.buildSky();
    this.buildClouds();
    this.buildCloudShadows();
  }

  buildSky() {
    this.skyU = {
      uTop: { value: DAY_TOP.clone() }, uHorizon: { value: new THREE.Color(0x9fd8ff) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: SUN_HIGH.clone() }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uNight: { value: 0 }, uSunVis: { value: 1 },
    };
    const m = new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 18), m);
    this.sky.renderOrder = 1000; // drawn after the opaque scene: early depth rejection skips every pixel a building / the ground already covers
    this.sky.frustumCulled = false;
    this.root.add(this.sky);
  }

  buildClouds() {
    const groups = Math.round(18 * this.detail), per = 5;
    this.cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, fog: false, emissive: 0xffffff, emissiveIntensity: 0.2, transparent: true, opacity: 0.96 });
    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), this.cloudMat, groups * per);
    this.cloudData = [];
    let seed = 4242;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let g = 0; g < groups; g++) {
      const a = r() * Math.PI * 2, dist = 120 + r() * 420, y = 85 + r() * 55;
      const gx = Math.cos(a) * dist, gz = Math.sin(a) * dist, sc = 0.8 + r() * 0.9;
      for (let k = 0; k < per; k++) {
        this.cloudData.push({ ox: (k - 2) * 9 * sc + (r() - 0.5) * 6, oy: (r() - 0.5) * 3, oz: (r() - 0.5) * 8, s: (7 + r() * 5) * sc * (k === 2 ? 1.25 : 1), gx, gz, y });
      }
    }
    this.clouds.frustumCulled = false;
    this.root.add(this.clouds);
    this.cloudShift = 0;
    this.updateClouds(0);
  }

  /** Soft cloud shadows drifting over the ground: the most visible sign of the sky from the game camera. */
  buildCloudShadows() {
    let seed = 77;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    for (let i = 0; i < 34; i++) {
      const x = r() * S, y = r() * S, rad = 40 + r() * 70;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { // wrap so the texture tiles
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
    }
    this.shadowTex = new THREE.CanvasTexture(c);
    this.shadowTex.wrapS = this.shadowTex.wrapT = THREE.RepeatWrapping;
    this.shadowTex.repeat.set(1.1, 1.1);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity: 0.2, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1 });
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(380, 380), this.shadowMat);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = 0.42;
    this.shadowPlane.renderOrder = 3;
    this.shadowPlane.frustumCulled = false;
    this.root.add(this.shadowPlane);
  }

  updateClouds(dt) {
    this.cloudShift += dt * 3.2; // wind, m/s
    // the clouds drift only a few metres per second and are huge: rewriting their instance matrices 10x a second looks identical
    // to every frame, and nothing at all is written while the game is paused (dt = 0)
    this._cloudAcc = (this._cloudAcc || 0) + dt;
    if (this._cloudsDrawn && (dt === 0 || this._cloudAcc < 0.1)) return;
    this._cloudAcc = 0; this._cloudsDrawn = true;
    const m = (this._cm ||= new THREE.Matrix4()), q = (this._cq ||= new THREE.Quaternion()), p = (this._cp ||= new THREE.Vector3()), s = (this._cs ||= new THREE.Vector3());
    this.cloudData.forEach((c, i) => {
      let x = c.gx + this.cloudShift;
      x = ((x + 560) % 1120 + 1120) % 1120 - 560; // wrap around the horizon
      p.set(x + c.ox, c.y + c.oy, c.gz + c.oz);
      s.set(c.s * 1.5, c.s * 0.55, c.s);
      this.clouds.setMatrixAt(i, m.compose(p, q, s));
    });
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  /** Called by DayNight every frame: horizon colour, sun elevation (-1..1), day / night factors. */
  setTime({ horizon, elev, day, night, sunSky }) {
    this.night = night;
    const u = this.skyU;
    u.uHorizon.value.copy(horizon);
    const dusk = Math.max(0, 1 - Math.abs(elev) / 0.38);
    mix3(NIGHT_TOP, DAY_TOP, day, u.uTop.value);
    u.uTop.value.lerp(DUSK_TOP, dusk * 0.55 * (1 - night * 0.6));
    u.uSunDir.value.copy(sunSky);
    u.uMoonDir.value.copy(sunSky).multiplyScalar(-1);
    u.uNight.value = night;
    u.uSunVis.value = THREE.MathUtils.clamp(elev * 3 + 0.4, 0, 1);
    mix3(SUN_LOW, SUN_HIGH, THREE.MathUtils.clamp(elev * 2.2, 0, 1), u.uSunColor.value);
    // clouds: white by day, rosy at dusk, dark blue at night
    this._c.copy(CLOUD_DAY).lerp(CLOUD_DUSK, dusk * 0.8).lerp(CLOUD_NIGHT, night);
    this.cloudMat.color.copy(this._c);
    this.cloudMat.emissive.copy(this._c);
    this.cloudMat.emissiveIntensity = THREE.MathUtils.lerp(0.06, 0.22, day);
    if (this.shadowMat) this.shadowMat.opacity = 0.2 * day;
    if (this.glow) {
      this.glow.material.opacity = night * 0.95;
      this.glow.visible = night > 0.02;
      this.pools.material.opacity = night * 0.55;
      this.pools.visible = night > 0.02;
    }
  }

  /** Warm halo around every street lamp head + a pool of light on the ground (night only). */
  addLampGlow(lampPos) {
    const n = lampPos.length;
    const pos = new Float32Array(n * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), s = new THREE.Vector3(1, 1, 1);
    const tex = glowTexture();
    const pools = new THREE.InstancedMesh(new THREE.CircleGeometry(6.5, 24), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2 }), n);
    lampPos.forEach(([x, z, ang], i) => {
      const ox = Math.sin(ang) * 1.2, oz = Math.cos(ang) * 1.2; // matches the lamp arm in CityManager
      pos.set([x + ox, 5.95, z + oz], i * 3);
      pools.setMatrixAt(i, m.compose(new THREE.Vector3(x + ox, 0.38, z + oz), q, s));
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.glow = new THREE.Points(g, new THREE.PointsMaterial({ map: tex, size: 7, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.glow.frustumCulled = false;
    this.pools = pools;
    pools.frustumCulled = false;
    this.glow.visible = this.pools.visible = false;
    this.root.add(this.glow, pools);
  }

  update(dt, camPos, focus = null) {
    this.time += dt;
    this.sky.position.copy(camPos);
    if (focus) {
      // the shadow layer follows the view; the texture is offset in world units so the shadows stay put on the ground while it moves
      const k = 1.1 / 380;
      this.shadowPlane.position.x = focus.x; this.shadowPlane.position.z = focus.z;
      this.shadowTex.offset.set(focus.x * k + this.time * 0.0035, -focus.z * k + this.time * 0.0012);
    }
    this.updateClouds(dt);
  }
}
