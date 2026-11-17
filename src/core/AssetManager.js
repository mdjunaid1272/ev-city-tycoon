import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Asset interface with replaceable models.
 * Every model name has a procedural factory (fallback). If public/assets/models/<name>.glb
 * is listed in public/data/assets.json it is loaded and used instead, so Blender GLBs can be
 * dropped in later without touching game code.
 */
export class AssetManager {
  constructor() {
    this.factories = new Map();
    this.glb = new Map();
    this.loader = new GLTFLoader();
    this.progress = 0;
    this.onProgress = null;
  }

  registerProcedural(name, factory) {
    this.factories.set(name, factory);
  }

  /** Returns a fresh instance of the named model (GLB clone or procedural). */
  create(name, opts) {
    const g = this.glb.get(name);
    if (g) return g.clone(true);
    const f = this.factories.get(name);
    if (!f) throw new Error(`Unknown model "${name}"`);
    return f(opts);
  }

  async loadManifest(url) {
    let list = [];
    try {
      const res = await fetch(url);
      if (res.ok) list = (await res.json()).models || [];
    } catch (_) {
      /* no manifest -> procedural only */
    }
    let done = 0;
    await Promise.all(
      list.map(async (m) => {
        try {
          const gltf = await this.loader.loadAsync(m.url);
          this.glb.set(m.name, gltf.scene);
        } catch (e) {
          console.warn(`[AssetManager] failed to load ${m.url}, using procedural fallback`, e);
        }
        done++;
        this.setProgress(done / list.length);
      }),
    );
    this.setProgress(1);
  }

  setProgress(p) {
    this.progress = p;
    this.onProgress?.(p);
  }
}
