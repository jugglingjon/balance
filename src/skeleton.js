import * as THREE from 'three';

// The body is a tree of rigid segments. Every segment has its own local frame
// with the origin at its proximal joint, and in the rest pose (all rotations
// zero) the figure stands upright facing +Z with arms at its sides, +X being
// the figure's left. A pose is one absolute world quaternion per segment.
//
// Lengths are metres for a figure about 1.69 m tall. Mass values are fractions
// of total body mass (they sum to 1) and `com` is the segment's centre of mass
// in its local frame. `contacts` are spheres that can rest on the floor.

const LIMBS = {
  upperArm: {
    mass: 0.028,
    com: [0, -0.126, 0],
    shapes: [{ a: [0, 0, 0], b: [0, -0.29, 0], r: 0.04 }],
    contacts: [],
    child: { name: 'forearm', at: [0, -0.29, 0] },
  },
  forearm: {
    mass: 0.016,
    com: [0, -0.112, 0],
    shapes: [{ a: [0, 0, 0], b: [0, -0.26, 0], r: 0.033 }],
    contacts: [
      { id: 'elbow', p: [0, 0, 0], r: 0.035 },
      { id: 'wrist', p: [0, -0.25, 0], r: 0.035 },
    ],
    child: { name: 'hand', at: [0, -0.26, 0] },
  },
  hand: {
    mass: 0.006,
    com: [0, -0.09, 0],
    shapes: [{ a: [0, -0.03, 0], b: [0, -0.15, 0], r: 0.036, scale: [1, 1, 0.4] }],
    contacts: [
      { id: 'heelOfHand', p: [0, -0.015, 0], r: 0.015 },
      { id: 'knuckles', p: [0, -0.1, 0], r: 0.015 },
      { id: 'fingertips', p: [0, -0.175, 0], r: 0.015 },
    ],
  },
  thigh: {
    mass: 0.1,
    com: [0, -0.182, 0],
    shapes: [{ a: [0, 0, 0], b: [0, -0.42, 0], r: 0.065 }],
    contacts: [],
    child: { name: 'shin', at: [0, -0.42, 0] },
  },
  shin: {
    mass: 0.0465,
    com: [0, -0.182, 0],
    shapes: [{ a: [0, 0, 0], b: [0, -0.42, 0], r: 0.045 }],
    contacts: [{ id: 'knee', p: [0, 0, 0], r: 0.055 }],
    child: { name: 'foot', at: [0, -0.42, 0] },
  },
  foot: {
    mass: 0.0145,
    com: [0, -0.04, 0.06],
    shapes: [{ a: [0, -0.04, -0.03], b: [0, -0.04, 0.165], r: 0.03 }],
    contacts: [
      { id: 'heel', p: [0, -0.04, -0.03], r: 0.03 },
      { id: 'ball', p: [0, -0.04, 0.12], r: 0.03 },
      { id: 'toes', p: [0, -0.04, 0.165], r: 0.03 },
    ],
  },
};

const TRUNK = {
  lowerTorso: {
    mass: 0.217,
    com: [0, 0.1, 0],
    shapes: [{ a: [0, 0.02, 0], b: [0, 0.2, 0], r: 0.095, scale: [1.45, 1, 1] }],
    contacts: [
      { id: 'sitBoneL', p: [0.07, 0, -0.02], r: 0.085 },
      { id: 'sitBoneR', p: [-0.07, 0, -0.02], r: 0.085 },
    ],
  },
  upperTorso: {
    mass: 0.28,
    com: [0, 0.14, 0],
    shapes: [
      { a: [0, 0.03, 0], b: [0, 0.2, 0], r: 0.1, scale: [1.45, 1, 1] },
      { a: [-0.15, 0.25, 0], b: [0.15, 0.25, 0], r: 0.055 },
    ],
    contacts: [
      { id: 'shoulderL', p: [0.15, 0.25, 0], r: 0.055 },
      { id: 'shoulderR', p: [-0.15, 0.25, 0], r: 0.055 },
    ],
  },
  head: {
    mass: 0.081,
    com: [0, 0.15, 0],
    shapes: [
      { a: [0, 0, 0], b: [0, 0.08, 0], r: 0.04 },
      { a: [0, 0.17, 0], b: [0, 0.17, 0], r: 0.1 },
    ],
    contacts: [{ id: 'head', p: [0, 0.17, 0], r: 0.1 }],
  },
};

function buildSegments() {
  const segments = {};
  const add = (name, def, parent, at, side) => {
    segments[name] = {
      name,
      side: side || null,
      parent,
      at: new THREE.Vector3(...at), // joint position in the parent's frame
      mass: def.mass,
      com: new THREE.Vector3(...def.com),
      shapes: def.shapes,
      contacts: def.contacts.map((c) => ({
        id: side ? c.id + side : c.id,
        p: new THREE.Vector3(...c.p),
        r: c.r,
      })),
    };
  };
  const addChain = (type, parent, at, side) => {
    const def = LIMBS[type];
    add(type + side, def, parent, at, side);
    if (def.child) addChain(def.child.name, type + side, def.child.at, side);
  };

  add('lowerTorso', TRUNK.lowerTorso, null, [0, 0, 0]);
  add('upperTorso', TRUNK.upperTorso, 'lowerTorso', [0, 0.22, 0]);
  add('head', TRUNK.head, 'upperTorso', [0, 0.29, 0]);
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    addChain('upperArm', 'upperTorso', [0.19 * sign, 0.25, 0], side);
    addChain('thigh', 'lowerTorso', [0.09 * sign, 0, 0], side);
  }
  return segments;
}

export const SEGMENTS = buildSegments();
// Insertion order is parent-before-child, so a plain loop walks the tree.
export const SEGMENT_NAMES = Object.keys(SEGMENTS);

const GROUND_TOLERANCE = 0.015;
const _v = new THREE.Vector3();

export function createPose() {
  const pose = {};
  for (const name of SEGMENT_NAMES) pose[name] = new THREE.Quaternion();
  return pose;
}

export function createFrame() {
  const origins = {};
  for (const name of SEGMENT_NAMES) origins[name] = new THREE.Vector3();
  return { origins, grounded: [], supportCentre: new THREE.Vector3() };
}

// Work out where every segment sits in the world for a pose, with the lowest
// contact resting on the floor (y = 0). The root stays above x = z = 0;
// `frame.supportCentre` reports where the middle of the grounded contacts is so
// the caller can place the figure horizontally.
export function solvePose(pose, frame) {
  const { origins } = frame;
  for (const name of SEGMENT_NAMES) {
    const seg = SEGMENTS[name];
    if (!seg.parent) origins[name].set(0, 0, 0);
    else origins[name].copy(seg.at).applyQuaternion(pose[seg.parent]).add(origins[seg.parent]);
  }

  const contacts = [];
  let lowest = Infinity;
  for (const name of SEGMENT_NAMES) {
    for (const c of SEGMENTS[name].contacts) {
      const p = c.p.clone().applyQuaternion(pose[name]).add(origins[name]);
      contacts.push({ id: c.id, segment: name, position: p, bottom: p.y - c.r });
      lowest = Math.min(lowest, p.y - c.r);
    }
  }

  for (const name of SEGMENT_NAMES) origins[name].y -= lowest;
  frame.grounded = contacts.filter((c) => c.bottom - lowest <= GROUND_TOLERANCE);
  frame.supportCentre.set(0, 0, 0);
  for (const c of frame.grounded) {
    c.position.y = 0;
    frame.supportCentre.add(c.position);
  }
  frame.supportCentre.divideScalar(frame.grounded.length);
  return frame;
}

export function shiftFrame(frame, dx, dz) {
  _v.set(dx, 0, dz);
  for (const name of SEGMENT_NAMES) frame.origins[name].add(_v);
  for (const c of frame.grounded) c.position.add(_v);
  frame.supportCentre.add(_v);
}
