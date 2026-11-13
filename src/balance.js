import * as THREE from 'three';
import { SEGMENTS, SEGMENT_NAMES } from './skeleton.js';

const PAD_STEPS = 10; // points used to approximate each round contact patch
// The centre of gravity may sit this far outside the base and still count as
// balanced, so a perfectly stacked pose is not reported as falling.
const EDGE_TOLERANCE = 0.002;

const _v = new THREE.Vector3();

// Fraction of the base, measured across it through its centre, that counts as
// comfortably balanced. Between this core and the edge is the warning zone.
export const CORE_FRACTION = 0.5;

export function createBalance() {
  return { com: new THREE.Vector3(), hull: [], core: [], margin: 0, balanced: false, state: 'unbalanced' };
}

// Fills `balance` for a solved pose:
//   com      centre of gravity of the whole body
//   hull     base of support, a convex polygon of {x, z} floor points
//   core     the middle of the base: the hull shrunk about its centroid
//   margin   metres from the centre of gravity's floor projection to the
//            nearest edge of the base; positive inside, negative outside
//   state    'balanced' (over the core), 'edge' (over the base but outside
//            the core) or 'unbalanced' (outside the base)
export function computeBalance(pose, frame, balance) {
  balance.com.set(0, 0, 0);
  for (const name of SEGMENT_NAMES) {
    const seg = SEGMENTS[name];
    _v.copy(seg.com).applyQuaternion(pose[name]).add(frame.origins[name]);
    balance.com.addScaledVector(_v, seg.mass);
  }

  const points = [];
  for (const c of frame.grounded) {
    for (let i = 0; i < PAD_STEPS; i++) {
      const a = (i / PAD_STEPS) * Math.PI * 2;
      points.push({ x: c.position.x + Math.cos(a) * c.pad, z: c.position.z + Math.sin(a) * c.pad });
    }
  }
  balance.hull = convexHull(points);
  balance.margin = signedDistance(balance.hull, balance.com.x, balance.com.z);
  balance.balanced = balance.margin >= -EDGE_TOLERANCE;

  const centre = centroid(balance.hull);
  balance.core = balance.hull.map((p) => ({
    x: centre.x + (p.x - centre.x) * CORE_FRACTION,
    z: centre.z + (p.z - centre.z) * CORE_FRACTION,
  }));
  const overCore = signedDistance(balance.core, balance.com.x, balance.com.z) >= 0;
  balance.state = !balance.balanced ? 'unbalanced' : overCore ? 'balanced' : 'edge';
  return balance;
}

const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

// Andrew's monotone chain.
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length < 3) return pts;
  const build = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return build(pts).concat(build(pts.reverse()));
}

// Area centroid of a convex polygon.
function centroid(hull) {
  let area = 0;
  let x = 0;
  let z = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const w = a.x * b.z - b.x * a.z;
    area += w;
    x += (a.x + b.x) * w;
    z += (a.z + b.z) * w;
  }
  return { x: x / (3 * area), z: z / (3 * area) };
}

function signedDistance(hull, x, z) {
  let nearest = Infinity;
  let inside = hull.length >= 3;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const lengthSq = ex * ex + ez * ez;
    const t = lengthSq ? THREE.MathUtils.clamp(((x - a.x) * ex + (z - a.z) * ez) / lengthSq, 0, 1) : 0;
    nearest = Math.min(nearest, Math.hypot(x - a.x - ex * t, z - a.z - ez * t));
    if (cross(a, b, { x, z }) < 0) inside = false;
  }
  return inside ? nearest : -nearest;
}
