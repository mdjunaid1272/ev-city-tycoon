import * as THREE from 'three';
import { mat, mesh, rbox } from './Materials.js';
import { D, STOP, LANE } from './RoadManager.js';

const OFF = 0.12, ON = 2.6;

/** Signal poles with red/yellow/green lamps (one head per approach) + painted stop lines. */
export class TrafficLightView {
  constructor(scene, road) {
    this.road = road;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.lamps = []; // {it, axis, mats:{green,yellow,red}, last}
    const lineGeo = new THREE.BoxGeometry(LANE * 1.9, 0.02, 0.45);
    const stopMat = mat(0xf4f7fa);
    for (const row of road.inters) for (const it of row) {
      const axisMats = [0, 1].map(() => ({
        red: new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xff2222, emissiveIntensity: OFF }),
        yellow: new THREE.MeshStandardMaterial({ color: 0x554411, emissive: 0xffc400, emissiveIntensity: OFF }),
        green: new THREE.MeshStandardMaterial({ color: 0x115522, emissive: 0x22ff66, emissiveIntensity: OFF }),
      }));
      this.lamps.push({ it, axis: 0, mats: axisMats[0], last: '' }, { it, axis: 1, mats: axisMats[1], last: '' });
      // approach k: pole on the right kerb corner before the crossing, facing the oncoming driver
      for (let k = 0; k < 4; k++) {
        const kr = (k + 1) % 4;
        const px = it.x - D[k][0] * 6.9 + D[kr][0] * 6.9, pz = it.z - D[k][1] * 6.9 + D[kr][1] * 6.9;
        const m = axisMats[k % 2];
        const g = new THREE.Group();
        g.add(mesh(new THREE.CylinderGeometry(0.1, 0.13, 5, 8), mat(0x4a525d, { metal: 0.4 }), { y: 2.5 }));
        g.add(mesh(rbox(0.5, 1.5, 0.42, 0.12, 2), mat(0x20252b), { y: 5.2 }));
        const bulb = new THREE.SphereGeometry(0.16, 10, 8);
        [[m.red, 5.65], [m.yellow, 5.2], [m.green, 4.75]].forEach(([mt, y]) => {
          const b = new THREE.Mesh(bulb, mt);
          b.position.set(0, y, 0.2);
          g.add(b);
        });
        g.position.set(px, 0.3, pz);
        // local +z faces the driver approaching from behind (opposite of travel direction)
        g.rotation.y = Math.atan2(-D[k][0], -D[k][1]);
        this.root.add(g);
        // stop line
        const sl = new THREE.Mesh(lineGeo, stopMat);
        const sx = it.x - D[k][0] * STOP + D[kr][0] * LANE, sz = it.z - D[k][1] * STOP + D[kr][1] * LANE;
        sl.position.set(sx, 0.05, sz);
        sl.rotation.y = k % 2 === 0 ? 0 : Math.PI / 2;
        this.root.add(sl);
      }
    }
  }

  update() {
    for (const l of this.lamps) {
      const s = this.road.light(l.it, l.axis).state;
      if (s === l.last) continue;
      l.last = s;
      l.mats.red.emissiveIntensity = s === 'red' ? ON : OFF;
      l.mats.yellow.emissiveIntensity = s === 'yellow' ? ON : OFF;
      l.mats.green.emissiveIntensity = s === 'green' ? ON : OFF;
    }
  }
}
