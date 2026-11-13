import * as THREE from 'three';
import { SEGMENT_NAMES, createPose } from './skeleton.js';

// Presets are written as absolute angles in degrees per segment: either `x`
// or `[x, z]`.
//   x  pitch in the side view. Positive tips an upright part forward, so a
//      hanging limb swings backward; -90 points an arm or leg straight ahead
//      and 180 turns a segment upside down.
//   z  roll in the front view, applied after x. Positive swings a hanging
//      limb out to the figure's left.
// Keys: a segment name ('thighL'), a part on both sides ('thigh'), or a whole
// limb ('arm', 'leg', 'armL', 'legR'). Later keys override earlier ones. For
// keys that cover both sides, z is mirrored on the right.

const LIMB_PARTS = {
  arm: ['upperArm', 'forearm', 'hand'],
  leg: ['thigh', 'shin', 'foot'],
};

const INVERTED = { lowerTorso: 180, upperTorso: 180, head: 180, leg: 180 };

export const PRESETS = [
  {
    id: 'mountain',
    name: 'Mountain',
    view: 'side',
    // A slight forward lean from the ankles puts the weight over mid-foot.
    angles: { lowerTorso: 2.5, upperTorso: 2.5, head: 2.5, arm: 2.5, leg: 2.5, foot: 0 },
  },
  {
    id: 'forward-fold',
    name: 'Forward fold',
    view: 'side',
    angles: { leg: -7, foot: 0, lowerTorso: 105, upperTorso: 152, head: 165, upperArm: 6, forearm: -50, hand: -50 },
  },
  {
    id: 'warrior-3',
    name: 'Warrior III',
    view: 'side',
    angles: { lowerTorso: 90, upperTorso: 90, head: 75, arm: -90, legR: 90, legL: [-4, -6], footL: 0 },
  },
  {
    id: 'tree',
    name: 'Tree',
    view: 'front',
    angles: {
      legL: [0, -7.5], // shift the hips over the standing foot
      footL: 0,
      thighR: [0, -55],
      shinR: [0, 75],
      footR: [0, 40],
      upperArm: [0, 165],
      forearm: [0, 195],
      hand: [0, 195],
    },
  },
  {
    id: 'boat',
    name: 'Boat',
    view: 'side',
    angles: { lowerTorso: -40, upperTorso: -32, head: -15, leg: -128, arm: -95 },
  },
  {
    id: 'crow',
    name: 'Crow',
    view: 'side',
    angles: {
      hand: -90,
      forearm: 14,
      upperArm: 58,
      lowerTorso: 84,
      upperTorso: 112,
      head: 62,
      thigh: [-52, 14],
      shin: 112,
      foot: 150,
    },
  },
  {
    id: 'headstand',
    name: 'Headstand',
    view: 'side',
    // Tripod headstand: crown of the head and both palms on the floor.
    angles: { ...INVERTED, lowerTorso: 177, leg: 174, upperArm: 61, forearm: 0, hand: -90 },
  },
  {
    id: 'forearm-stand',
    name: 'Forearm stand',
    view: 'side',
    angles: { ...INVERTED, head: 95, upperArm: 8, forearm: -90, hand: -96 },
  },
  {
    id: 'handstand',
    name: 'Handstand',
    view: 'side',
    angles: { ...INVERTED, arm: 9, hand: -90 },
  },
  {
    id: 'straddle-handstand',
    name: 'Straddle handstand',
    view: 'front',
    angles: { ...INVERTED, leg: [180, -55], arm: 9, hand: -90 },
  },
];

const _euler = new THREE.Euler();

function expandKey(key) {
  const side = /[LR]$/.test(key) && !SEGMENT_NAMES.includes(key + 'L') ? key.slice(-1) : null;
  const base = side ? key.slice(0, -1) : key;
  if (SEGMENT_NAMES.includes(key)) return [{ name: key, mirror: false }];
  const parts = LIMB_PARTS[base] || [base];
  const out = [];
  for (const part of parts) {
    if (side) out.push({ name: part + side, mirror: false });
    else out.push({ name: part + 'L', mirror: false }, { name: part + 'R', mirror: true });
  }
  return out;
}

export function presetPose(preset, pose = createPose()) {
  for (const name of SEGMENT_NAMES) pose[name].identity();
  for (const [key, value] of Object.entries(preset.angles)) {
    const [x, z] = Array.isArray(value) ? value : [value, 0];
    for (const { name, mirror } of expandKey(key)) {
      if (!pose[name]) throw new Error(`Preset "${preset.id}": unknown segment "${key}"`);
      _euler.set(THREE.MathUtils.degToRad(x), 0, THREE.MathUtils.degToRad(mirror ? -z : z), 'ZYX');
      pose[name].setFromEuler(_euler);
    }
  }
  return pose;
}
