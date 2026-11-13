import * as THREE from 'three';

// The body is a tree of rigid segments. Every segment has its own local frame
// with the origin at its proximal joint, and in the rest pose (all rotations
// zero) the figure stands upright facing +Z with arms at its sides, +X being
// the figure's left. A pose is one absolute world quaternion per segment.
//
// Proportions are those of the GDQuest mannequin model after it has been
// rescaled to adult proportions (metres, about 1.79 m tall); they come from
// `node tools/build-rig.mjs`. The `shapes` are only a
// stand-in drawn while the model loads. Mass values are fractions
// of total body mass (they sum to 1) and `com` is the segment's centre of mass
// in its local frame. `contacts` are spheres that can rest on the floor: `r` is
// the height of the sphere's centre when it touches down and `pad` (default r)
// is the radius of the patch it presses onto the floor.

const LIMBS = {
  upperArm: {
    mass: 0.028,
    com: [0, -0.137, 0],
    shapes: [{ a: [0, 0, 0], b: [0, -0.314, 0], r: 0.043 }],
    contacts: [],
    child: { name: 'forearm', at: [0, -0.314, 0] },
  },
  forearm: {
    mass: 0.016,
    com: [0, -0.111, 0],
    shapes: [{ a: [0, 0, 0], b: [0, -0.259, 0], r: 0.036 }],
    contacts: [
      { id: 'elbow', p: [0, 0, 0], r: 0.038 },
      { id: 'wrist', p: [0, -0.215, 0], r: 0.038 },
    ],
    child: { name: 'hand', at: [0, -0.259, 0] },
  },
  hand: {
    mass: 0.006,
    com: [0, -0.085, 0],
    shapes: [{ a: [0, -0.03, 0], b: [0, -0.15, 0], r: 0.036, scale: [1, 1, 0.6] }],
    contacts: [
      { id: 'heelOfHand', p: [0, -0.03, 0], r: 0.026, pad: 0.03 },
      { id: 'knuckles', p: [0, -0.095, 0], r: 0.026, pad: 0.03 },
      { id: 'fingertips', p: [0, -0.16, 0], r: 0.026, pad: 0.03 },
    ],
    tip: { id: 'fingertips', p: [0, -0.185, 0] },
  },
  thigh: {
    mass: 0.1,
    com: [0, -0.168, 0],
    shapes: [{ a: [0, 0, 0], b: [0, -0.389, 0], r: 0.068 }],
    contacts: [],
    child: { name: 'shin', at: [0, -0.389, 0] },
  },
  shin: {
    mass: 0.0465,
    com: [0, -0.185, 0],
    shapes: [{ a: [0, 0, 0], b: [0, -0.428, 0], r: 0.05 }],
    contacts: [{ id: 'knee', p: [0, 0, 0], r: 0.06, pad: 0.035 }],
    child: { name: 'foot', at: [0, -0.428, 0] },
  },
  foot: {
    mass: 0.0145,
    com: [0, -0.07, 0.07],
    shapes: [{ a: [0, -0.076, -0.02], b: [0, -0.081, 0.19], r: 0.035 }],
    contacts: [
      { id: 'heel', p: [0, -0.076, -0.02], r: 0.04 },
      { id: 'ball', p: [0, -0.076, 0.1], r: 0.04 },
      { id: 'toes', p: [0, -0.081, 0.195], r: 0.035 },
    ],
    tip: { id: 'toes', p: [0, -0.09, 0.23] },
  },
};

const TRUNK = {
  lowerTorso: {
    mass: 0.142,
    com: [0, 0.06, 0.01],
    shapes: [{ a: [0, 0.01, 0], b: [0, 0.1, 0.015], r: 0.09, scale: [1.35, 1, 1] }],
    contacts: [
      { id: 'sitBoneL', p: [0.06, 0.03, -0.02], r: 0.08, pad: 0.05 },
      { id: 'sitBoneR', p: [-0.06, 0.03, -0.02], r: 0.08, pad: 0.05 },
    ],
  },
  midTorso: {
    mass: 0.139,
    com: [0, 0.09, -0.004],
    shapes: [{ a: [0, 0.03, 0], b: [0, 0.15, -0.006], r: 0.09, scale: [1.3, 1, 1] }],
    contacts: [],
  },
  upperTorso: {
    mass: 0.216,
    com: [0, 0.11, -0.02],
    shapes: [
      { a: [0, 0.05, -0.01], b: [0, 0.13, -0.025], r: 0.105, scale: [1.4, 1, 1] },
      { a: [-0.14, 0.182, -0.046], b: [0.14, 0.182, -0.046], r: 0.055 },
    ],
    contacts: [
      { id: 'shoulderL', p: [0.14, 0.182, -0.046], r: 0.06 },
      { id: 'shoulderR', p: [-0.14, 0.182, -0.046], r: 0.06 },
    ],
  },
  head: {
    mass: 0.081,
    com: [0, 0.16, 0.02],
    shapes: [
      { a: [0, 0, 0], b: [0, 0.08, 0.01], r: 0.045 },
      { a: [0, 0.175, 0.02], b: [0, 0.175, 0.02], r: 0.095 },
    ],
    contacts: [{ id: 'head', p: [0, 0.175, 0.02], r: 0.095, pad: 0.04 }],
    tip: { id: 'headTop', p: [0, 0.27, 0.02] },
  },
};

// Joint positions in the parent segment's frame.
const JOINTS = {
  waist: [0, 0.144, 0.025], // pelvis to abdomen
  chest: [0, 0.185, -0.008], // abdomen to ribcage
  neck: [0, 0.242, -0.045],
  shoulder: [0.172, 0.182, -0.046],
  hip: [0.102, 0, 0],
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
      // Far end of the segment, where a drag handle can sit.
      tip: def.tip ? { id: side ? def.tip.id + side : def.tip.id, p: new THREE.Vector3(...def.tip.p) } : null,
      contacts: def.contacts.map((c) => ({
        id: side ? c.id + side : c.id,
        p: new THREE.Vector3(...c.p),
        r: c.r,
        pad: c.pad ?? c.r,
      })),
    };
  };
  const addChain = (type, parent, at, side) => {
    const def = LIMBS[type];
    add(type + side, def, parent, at, side);
    if (def.child) addChain(def.child.name, type + side, def.child.at, side);
  };

  add('lowerTorso', TRUNK.lowerTorso, null, [0, 0, 0]);
  const mirrored = ([x, y, z], sign) => [x * sign, y, z];
  add('midTorso', TRUNK.midTorso, 'lowerTorso', JOINTS.waist);
  add('upperTorso', TRUNK.upperTorso, 'midTorso', JOINTS.chest);
  add('head', TRUNK.head, 'upperTorso', JOINTS.neck);
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    addChain('upperArm', 'upperTorso', mirrored(JOINTS.shoulder, sign), side);
    addChain('thigh', 'lowerTorso', mirrored(JOINTS.hip, sign), side);
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
      contacts.push({ id: c.id, segment: name, position: p, pad: c.pad, bottom: p.y - c.r });
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
