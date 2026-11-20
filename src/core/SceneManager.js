import * as THREE from 'three';

/** Owns renderer, scene, lights and shadow setup. */
export class SceneManager {
  constructor(canvas, settings) {
    this.settings = settings;
    const q = settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fd8ff);
    this.scene.fog = new THREE.Fog(0x9fd8ff, 190, 540);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1600);

    this.hemi = new THREE.HemisphereLight(0xdff3ff, 0x6e8a5a, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0xbcd7ff, 0.45); // cool bounce light from the opposite side keeps shadows from going flat
    this.scene.add(this.fill, this.fill.target);
    this.sunDir = new THREE.Vector3(0.5, 0.8, 0.35).normalize();
    this.shadowFocus = new THREE.Vector3();

    this.applyQuality();
    this.resize();
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
  }

  /** Stop reacting to window changes and release GPU resources. Safe to call twice. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    removeEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop?.(null);
    this.renderer.dispose();
  }

  applyQuality() {
    const q = this.settings.quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    const s = this.sun.shadow;
    s.mapSize.set(q.shadowMap, q.shadowMap);
    if (s.map) { s.map.dispose(); s.map = null; }
    const R = 48;
    Object.assign(s.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 260 });
    s.camera.updateProjectionMatrix();
    s.bias = -0.0004;
    s.normalBias = 0.04;
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow frustum centred on whatever the player/camera is looking at. */
  updateShadowFocus(target) {
    this.shadowFocus.lerp(target, 0.2);
    // snap to a grid so shadows don't shimmer while moving
    const g = 2;
    const fx = Math.round(this.shadowFocus.x / g) * g, fz = Math.round(this.shadowFocus.z / g) * g;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 120, this.sunDir.y * 120, fz + this.sunDir.z * 120);
    this.sun.target.updateMatrixWorld();
    this.fill.target.position.set(fx, 0, fz);
    this.fill.position.set(fx - this.sunDir.x * 80, 40 + this.sunDir.y * 20, fz - this.sunDir.z * 80);
    this.fill.target.updateMatrixWorld();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
