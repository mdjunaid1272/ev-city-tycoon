import { LINES, ROAD_EXTENT } from './CityManager.js';

/**
 * Road network as a directed lane graph (pure data, no Three.js).
 *
 * Directions: 0 = North (-z), 1 = East (+x), 2 = South (+z), 3 = West (-x). Right-hand traffic.
 * - "road" edges: one lane, from an intersection exit (or the map boundary) to the next
 *   intersection stop line (or the boundary).
 * - "conn" edges: short curved paths *inside* an intersection (straight / right / left).
 * Each intersection runs a two-phase traffic signal.
 */
export const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const STOP = 11; // stop line distance from intersection centre
export const LANE = 3; // lane centre offset from road centre
const right = (k) => (k + 1) % 4;

const CYCLE = { green: 10, yellow: 2, allRed: 1.5 };
export const YELLOW = CYCLE.yellow;
const T_TOTAL =2 * (CYCLE.green + CYCLE.yellow + CYCLE.allRed);

let edgeSeq = 0;

function makeEdge(kind, pts, dir) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return {
    id: ++edgeSeq, kind, pts, cum, len: cum[cum.length - 1], dir,
    agents: [], to: null, from: null, conns: [], next: null, despawn: false, spawn: false,
  };
}

/** Position + heading at distance s along an edge. */
export function sampleEdge(e, s, out) {
  const { pts, cum } = e;
  if (s <= 0) s = 0;
  if (s >= e.len) s = e.len - 1e-6;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
  return out;
}

export class RoadManager {
  constructor() {
    this.time = 0;
    this.edges = [];
    this.spawnEdges = [];
    this.inters = LINES.map(() => []); // inters[i][j]
    this.build();
  }

  entryPt(it, k) {
    return { x: it.x - D[k][0] * STOP + D[right(k)][0] * LANE, z: it.z - D[k][1] * STOP + D[right(k)][1] * LANE };
  }
  exitPt(it, k) {
    return { x: it.x + D[k][0] * STOP + D[right(k)][0] * LANE, z: it.z + D[k][1] * STOP + D[right(k)][1] * LANE };
  }

  build() {
    LINES.forEach((x, i) => LINES.forEach((z, j) => {
      this.inters[i][j] = {
        i, j, x, z, inside: new Set(), entry: [null, null, null, null], exit: [null, null, null, null],
        offset: (i * 7 + j * 11) % T_TOTAL, // staggered signals
      };
    }));
    const add = (e) => { this.edges.push(e); return e; };

    // road edges
    for (let k = 0; k < 4; k++) {
      for (let l = 0; l < LINES.length; l++) {
        // intersections in travel order along lane line l
        const seq = [];
        for (let n = 0; n < LINES.length; n++) {
          const idx = k === 1 || k === 2 ? n : LINES.length - 1 - n;
          seq.push(k % 2 === 1 ? this.inters[idx][l] : this.inters[l][idx]);
        }
        const rk = right(k);
        // boundary start point: on the lane, at the map edge, behind the first intersection
        const first = seq[0], last = seq[seq.length - 1];
        // boundary points sit at +/-ROAD_EXTENT on the travel axis
        const bStart = k % 2 === 1
          ? { x: k === 1 ? -ROAD_EXTENT : ROAD_EXTENT, z: first.z + D[rk][1] * LANE }
          : { x: first.x + D[rk][0] * LANE, z: k === 2 ? -ROAD_EXTENT : ROAD_EXTENT };
        const bEnd = k % 2 === 1
          ? { x: k === 1 ? ROAD_EXTENT : -ROAD_EXTENT, z: last.z + D[rk][1] * LANE }
          : { x: last.x + D[rk][0] * LANE, z: k === 2 ? ROAD_EXTENT : -ROAD_EXTENT };
        let prev = add(makeEdge('road', [bStart, this.entryPt(first, k)], k));
        prev.spawn = true;
        prev.to = first; first.entry[k] = prev;
        this.spawnEdges.push(prev);
        for (let n = 0; n < seq.length - 1; n++) {
          const a = seq[n], b = seq[n + 1];
          const e = add(makeEdge('road', [this.exitPt(a, k), this.entryPt(b, k)], k));
          e.from = a; a.exit[k] = e;
          e.to = b; b.entry[k] = e;
        }
        const out = add(makeEdge('road', [this.exitPt(last, k), bEnd], k));
        out.from = last; last.exit[k] = out; out.despawn = true;
      }
    }

    // connectors inside each intersection
    for (const row of this.inters) for (const it of row) {
      for (let k = 0; k < 4; k++) {
        const inEdge = it.entry[k];
        for (const [turn, m] of [['S', k], ['R', right(k)], ['L', (k + 3) % 4]]) {
          const outEdge = it.exit[m];
          const a = inEdge.pts[inEdge.pts.length - 1], b = outEdge.pts[0];
          const pts = [];
          if (turn === 'S') pts.push(a, b);
          else {
            const dot = (b.x - a.x) * D[k][0] + (b.z - a.z) * D[k][1];
            const c = { x: a.x + D[k][0] * dot, z: a.z + D[k][1] * dot };
            for (let t = 0; t <= 1.0001; t += 0.1) {
              const u = 1 - t;
              pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z });
            }
          }
          const conn = add(makeEdge('conn', pts, k));
          conn.turn = turn; conn.inter = it; conn.next = outEdge; conn.inDir = k; conn.outDir = m;
          inEdge.conns.push({ turn, edge: conn });
        }
      }
    }

    // named edges used by the charging-station driveways (south road westbound / north road eastbound)
    this.driveIn = this.inters[2][2].exit[3]; // z=30 road, westbound lane, between x=30 and x=-30
    this.driveOut = this.inters[1][1].exit[1]; // z=-30 road, eastbound lane, between x=-30 and x=30
    // service lots on the neighbouring blocks: each has a driveway on its south road's westbound lane
    this.washEdge = this.inters[1][2].exit[3]; // z=30 road, westbound, x -41 -> -79 (car wash block, centre -60,0)
    this.garageEdge = this.inters[2][1].exit[3]; // z=-30 road, westbound, x 19 -> -19 (garage block, centre 0,-60)
    // lots added in Milestone 7. rot = lot rotation so that local +z faces the road; spawn = where its customers enter the map
    const spawnOn = (dir, key, val) => this.spawnEdges.find((e) => e.dir === dir && Math.abs(e.pts[0][key] - val) < 0.5);
    this.lotAccess = {
      small: { edge: this.inters[0][3].exit[3], rot: 0, spawn: spawnOn(3, 'z', 87) }, // residential, block (-2,1), south road z=90
      commercial: { edge: this.inters[3][3].exit[3], rot: 0, spawn: spawnOn(3, 'z', 87) }, // block (1,1)
      industrial: { edge: this.inters[1][3].exit[1], rot: Math.PI, spawn: spawnOn(1, 'z', 93) }, // block (0,2), north road z=90 eastbound
      highway: { edge: this.inters[3][2].exit[0], rot: -Math.PI / 2, spawn: spawnOn(0, 'x', 93) }, // block (2,0), road x=90 northbound
    };
  }

  update(dt) {
    this.time += dt;
  }

  /** Signal state for an axis (0 = north/south, 1 = east/west): { state, t (seconds in state) }. */
  light(it, axis) {
    let p = (this.time + it.offset) % T_TOTAL;
    const half = T_TOTAL / 2;
    if (axis === 1) p = (p + half) % T_TOTAL;
    const { green, yellow } = CYCLE;
    if (p < green) return { state: 'green', t: p };
    if (p < green + yellow) return { state: 'yellow', t: p - green };
    return { state: 'red', t: p - green - yellow };
  }

  /** x,z -> s along an edge for a point on it (axis aligned lanes). */
  sOf(e, x, z) {
    const a = e.pts[0], b = e.pts[e.pts.length - 1];
    return Math.hypot(x - a.x, z - a.z) * Math.sign((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z) || 1);
  }
}
