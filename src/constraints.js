import * as THREE from 'three';
import { SEGMENTS, SEGMENT_NAMES, solveOrigins } from './skeleton.js';

// What keeps a dragged pose physically sensible:
//   - planted hands and feet stay where they are (their limb bends instead),
//   - nothing passes through the floor,
//   - joints stay within a rough human range.
// The first is enforced directly with two-bone IK. The other two are measured
// as a "cost" so the drag code can refuse a step that would make them worse.

const DEG = 180 / Math.PI;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

// Segment positions with the pinned contact held at pin.position (no grounding).
export function placePinned(pose, origins, pin) {
  solveOrigins(pose, origins);
  _a.copy(pin.local).applyQuaternion(pose[pin.segment]).add(origins[pin.segment]);
  _a.subVectors(pin.position, _a);
  for (const name of SEGMENT_NAMES) origins[name].add(_a);
}

// --- Planted limbs ----------------------------------------------------------

const LIMB_ENDS = ['footL', 'footR', 'handL', 'handR'];

// One entry per hand or foot currently on the floor: where its wrist/ankle is
// and how the hand/foot is turned, so both can be restored after an edit.
export function makePlants(pose, frame) {
  const grounded = new Set(frame.grounded.map((c) => c.segment));
  return LIMB_ENDS.filter((end) => grounded.has(end)).map((end) => {
    const mid = SEGMENTS[end].parent;
    const top = SEGMENTS[mid].parent;
    return {
      end,
      mid,
      top,
      target: frame.origins[end].clone(),
      quat: pose[end].clone(),
      upper: SEGMENTS[mid].at.length(),
      lower: SEGMENTS[end].at.length(),
      // Which way the middle joint folds when the limb starts out straight:
      // knees forward, elbows back.
      pole: new THREE.Vector3(0, 0, end.startsWith('foot') ? 1 : -1),
    };
  });
}

// Point a limb segment (which hangs along -Y at rest) in a new direction with
// the smallest possible turn.
function aim(quat, direction) {
  _c.copy(DOWN).applyQuaternion(quat);
  quat.premultiply(_q.setFromUnitVectors(_c, direction));
}

// Re-bend any planted limb whose wrist/ankle has been carried away from its
// spot. Returns true if the pose was changed.
export function holdPlants(pose, origins, plants, pin) {
  let changed = false;
  for (const plant of plants) {
    if (origins[plant.end].distanceToSquared(plant.target) < 1e-8) continue;
    changed = true;
    const root = origins[plant.top];
    const reach = _a.subVectors(plant.target, root);
    const distance = THREE.MathUtils.clamp(
      reach.length(),
      Math.abs(plant.upper - plant.lower) + 1e-4,
      plant.upper + plant.lower - 1e-4
    );
    reach.normalize();

    // Keep folding the way the limb already folds; fall back to the default.
    const bend = _b.subVectors(origins[plant.mid], root);
    bend.addScaledVector(reach, -bend.dot(reach));
    if (bend.lengthSq() < 1e-6) {
      bend.copy(plant.pole).applyQuaternion(pose[plant.top]);
      bend.addScaledVector(reach, -bend.dot(reach));
    }
    bend.normalize();

    const along = (plant.upper * plant.upper - plant.lower * plant.lower + distance * distance) / (2 * distance);
    const out = Math.sqrt(Math.max(plant.upper * plant.upper - along * along, 0));
    const toMid = _c.copy(reach).multiplyScalar(along).addScaledVector(bend, out);
    const toEnd = reach.multiplyScalar(distance).sub(toMid).normalize();
    toMid.normalize();
    // aim() uses _c as scratch, so hand it copies.
    aim(pose[plant.top], _b.copy(toMid));
    aim(pose[plant.mid], _b.copy(toEnd));
    pose[plant.end].copy(plant.quat);
  }
  if (changed) placePinned(pose, origins, pin);
  return changed;
}

// --- Floor ------------------------------------------------------------------

// How far (metres) the lowest contact sits below the floor.
export function floorDepth(pose, origins) {
  let lowest = 0;
  for (const name of SEGMENT_NAMES) {
    for (const contact of SEGMENTS[name].contacts) {
      _a.copy(contact.p).applyQuaternion(pose[name]);
      lowest = Math.min(lowest, _a.y + origins[name].y - contact.r);
    }
  }
  return -lowest;
}

// --- Joint limits -----------------------------------------------------------
// Poses carry no twist information, so these are deliberately loose: they stop
// the clearly impossible (knees bending backwards, a head folded onto the
// spine) without trying to model real anatomy.

const UP = [0, 1, 0];
const HANG = [0, -1, 0];
const AHEAD = [0, 0, 1];

const CENTRAL_LIMITS = [
  { child: 'midTorso', parent: 'lowerTorso', kind: 'swing', axis: UP, max: 45 },
  { child: 'upperTorso', parent: 'midTorso', kind: 'swing', axis: UP, max: 40 },
  { child: 'head', parent: 'upperTorso', kind: 'swing', axis: UP, max: 70 },
];
const SIDE_LIMITS = [
  // Angle of the thigh from straight down, by direction.
  { child: 'thigh', parent: 'lowerTorso', kind: 'cone', forward: 135, side: 95, back: 35 },
  // Hinges: signed bend about the parent's left-right axis. Positive carries a
  // hanging part backward (knee flexion), negative forward (elbow flexion).
  { child: 'shin', parent: 'thigh', kind: 'hinge', axis: HANG, min: -5, max: 160, sideways: 8 },
  { child: 'foot', parent: 'shin', kind: 'hinge', axis: AHEAD, min: -35, max: 60, sideways: 25 },
  { child: 'upperArm', parent: 'upperTorso', kind: 'shoulder', back: 60, overhead: 155 },
  { child: 'forearm', parent: 'upperArm', kind: 'hinge', axis: HANG, min: -155, max: 5, sideways: 8 },
  { child: 'hand', parent: 'forearm', kind: 'swing', axis: HANG, max: 105 },
];
const LIMITS = CENTRAL_LIMITS.map((l) => ({ ...l, axis: new THREE.Vector3(...l.axis) }));
for (const side of ['L', 'R']) {
  for (const l of SIDE_LIMITS) {
    LIMITS.push({
      ...l,
      child: l.child + side,
      parent: SEGMENTS[l.parent] ? l.parent : l.parent + side,
      axis: l.axis && new THREE.Vector3(...l.axis),
    });
  }
}

// Degrees by which one joint is past its limit (0 when within range).
function excess(limit, pose) {
  // d: the child's long axis expressed in the parent's frame.
  const rest = limit.axis || DOWN;
  const d = _a.copy(rest).applyQuaternion(pose[limit.child]).applyQuaternion(_q.copy(pose[limit.parent]).invert());
  const angle = Math.acos(THREE.MathUtils.clamp(d.dot(rest), -1, 1)) * DEG;

  if (limit.kind === 'swing') return Math.max(0, angle - limit.max);

  if (limit.kind === 'hinge') {
    const sideways = Math.asin(THREE.MathUtils.clamp(Math.abs(d.x), 0, 1)) * DEG;
    // A limb that is already well bent and points out to the side is read as
    // the whole limb having turned (the knee in tree pose), so only its size
    // is capped. A nearly straight limb may not fold sideways.
    if (angle > 45 && sideways > 20) return Math.max(0, angle - Math.max(Math.abs(limit.min), Math.abs(limit.max)));
    const bend = Math.atan2(rest.y * d.z - rest.z * d.y, rest.y * d.y + rest.z * d.z) * DEG;
    return Math.max(0, bend - limit.max, limit.min - bend) + Math.max(0, sideways - limit.sideways);
  }

  // Direction of the swing: 1 straight ahead, 0 sideways, -1 straight back.
  const sideways = Math.hypot(d.x, d.z);
  const ahead = sideways > 1e-4 ? d.z / sideways : 1;

  if (limit.kind === 'cone') {
    const max = ahead >= 0 ? limit.side + (limit.forward - limit.side) * ahead : limit.side + (limit.side - limit.back) * ahead;
    return Math.max(0, angle - max);
  }

  // Shoulder: free to the front and side. Behind the body the arm stops early,
  // except close to overhead, which is reached by way of the front.
  if (ahead >= 0) return 0;
  const max = 180 + (limit.back - 180) * -ahead;
  return Math.max(0, Math.min(angle - max, limit.overhead - angle));
}

// Total degrees by which the pose is outside its joint limits.
export function limitExcess(pose) {
  let total = 0;
  for (const limit of LIMITS) total += excess(limit, pose);
  return total;
}
