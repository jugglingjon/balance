// Offline step: turns the GDQuest mannequin GLB into what the app needs.
//
//   node tools/build-rig.mjs
//
// Writes
//   public/models/mannequin.glb   the model without its animation clips
//   src/mannequinRig.json         how to drive its bones from our segments
// and prints the measurements used to fill in src/skeleton.js.
//
// The app describes a pose as one absolute rotation per body segment, where
// "no rotation" means standing upright with the arms hanging down. The model
// is bound in a T-pose with the legs apart, so for every bone we work out its
// world rotation in our rest pose (`ref`). At run time a bone's world rotation
// is simply (its segment's rotation) x (its ref rotation).
import fs from 'node:fs';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, dedup, quantize } from '@gltf-transform/functions';
import { readGlb, bindPose } from './glb.mjs';

const SOURCE = 'assets-src/mannequiny-0.3.0.glb';
const MODEL_OUT = 'public/models/mannequin.glb';
const RIG_OUT = 'src/mannequinRig.json';

// Bone that starts each of our segments. Bones not listed ride along with the
// nearest listed ancestor (fingers with the hand, clavicles with the chest).
const SEGMENT_BONES = {
  lowerTorso: 'pelvis',
  upperTorso: 'spine_01',
  head: 'neck_01',
  upperArmL: 'upperarm.l', forearmL: 'lowerarm.l', handL: 'hand.l',
  upperArmR: 'upperarm.r', forearmR: 'lowerarm.r', handR: 'hand.r',
  thighL: 'thigh.l', shinL: 'calf.l', footL: 'foot.l',
  thighR: 'thigh.r', shinR: 'calf.r', footR: 'foot.r',
};
const BONE_SEGMENT = Object.fromEntries(Object.entries(SEGMENT_BONES).map(([s, b]) => [b, s]));
const DOWN = new THREE.Vector3(0, -1, 0);

const glb = readGlb(SOURCE);
const bones = bindPose(glb);
const names = Object.keys(bones); // skin joint order, parents first
const pos = (m) => new THREE.Vector3().setFromMatrixPosition(m);
const rot = (m) => new THREE.Quaternion().setFromRotationMatrix(m);
const childOf = (name, pattern) => names.find((n) => bones[n].parent === name && pattern.test(n));

// --- Rest pose -------------------------------------------------------------
// `turn` is the world-space rotation taking a bone from the bind pose to our
// rest pose; unlisted bones inherit their parent's.
function turnFor(name) {
  const bone = bones[name];
  const along = new THREE.Vector3(0, 1, 0).transformDirection(bone.world); // bones point along +Y
  if (/^(upperarm|lowerarm|thigh|calf)\./.test(name)) {
    return new THREE.Quaternion().setFromUnitVectors(along, DOWN);
  }
  if (/^foot\./.test(name)) {
    // Keep the sole flat but point the toes straight ahead.
    const ahead = along.clone().setX(0).normalize();
    return new THREE.Quaternion().setFromUnitVectors(along, ahead);
  }
  if (/^hand\./.test(name)) {
    // Fingers down, palm facing backward, so that pitching the hand forward
    // by 90 degrees lays it palm-down on the floor.
    const left = name.endsWith('.l');
    const thumbSide = pos(bones[childOf(name, /^index_01/)].world)
      .sub(pos(bones[childOf(name, /^ring_01/)].world))
      .normalize();
    const palm = left ? along.clone().cross(thumbSide) : thumbSide.clone().cross(along);
    palm.normalize();
    const side = along.clone().cross(palm).normalize();
    const from = new THREE.Matrix4().makeBasis(side, along, palm);
    const targetAlong = DOWN.clone();
    const targetPalm = new THREE.Vector3(0, 0, -1);
    const to = new THREE.Matrix4().makeBasis(targetAlong.clone().cross(targetPalm), targetAlong, targetPalm);
    return rot(to).multiply(rot(from).invert());
  }
  return null;
}

const ref = {}; // name -> { q: world rotation, p: world position, turn }
for (const name of names) {
  const bone = bones[name];
  const parent = bone.parent ? ref[bone.parent] : null;
  const turn = turnFor(name) || (parent ? parent.turn : new THREE.Quaternion());
  const q = turn.clone().multiply(rot(bone.world));
  const p = parent ? pos(bone.local).applyQuaternion(parent.q).add(parent.p) : pos(bone.world);
  ref[name] = { q, p, turn };
}

const segmentOf = {};
for (const name of names) segmentOf[name] = BONE_SEGMENT[name] || segmentOf[bones[name].parent];

// --- Measurements for skeleton.js -------------------------------------------
const origin = {};
for (const [segment, bone] of Object.entries(SEGMENT_BONES)) origin[segment] = ref[bone].p.clone();
origin.lowerTorso = ref['thigh.l'].p.clone().add(ref['thigh.r'].p).multiplyScalar(0.5); // between the hips

// Skin every vertex into the rest pose and sort it by segment.
const skinMatrix = names.map((name) =>
  new THREE.Matrix4().compose(ref[name].p, ref[name].q, new THREE.Vector3(1, 1, 1)).multiply(bones[name].world.clone().invert())
);
const clouds = {};
let floor = Infinity;
for (const prim of glb.json.meshes[0].primitives) {
  const P = glb.accessor(prim.attributes.POSITION);
  const J = glb.accessor(prim.attributes.JOINTS_0);
  const W = glb.accessor(prim.attributes.WEIGHTS_0);
  for (let i = 0; i < P.length; i++) {
    const v = new THREE.Vector3();
    let top = 0;
    for (let k = 0; k < 4; k++) {
      v.addScaledVector(new THREE.Vector3(...P[i]).applyMatrix4(skinMatrix[J[i][k]]), W[i][k]);
      if (W[i][k] > W[i][top]) top = k;
    }
    const segment = segmentOf[names[J[i][top]]];
    (clouds[segment] ||= []).push(v);
    floor = Math.min(floor, v.y);
  }
}

const fmt = (v) => `[${v.toArray().map((n) => (Math.abs(n) < 5e-4 ? 0 : +n.toFixed(3))).join(', ')}]`;
const parentSegment = { upperTorso: 'lowerTorso', head: 'upperTorso', upperArm: 'upperTorso', forearm: 'upperArm', hand: 'forearm', thigh: 'lowerTorso', shin: 'thigh', foot: 'shin' };
console.log(`floor at y = ${floor.toFixed(3)}; hips at y = ${origin.lowerTorso.y.toFixed(3)}\n`);
console.log('segment        joint in parent frame        mesh bounds in segment frame (min / max)');
for (const segment of Object.keys(SEGMENT_BONES)) {
  if (segment.endsWith('R')) continue;
  const base = segment.replace(/L$/, '');
  const parent = parentSegment[base] ? parentSegment[base] + (segment.endsWith('L') && !/Torso$/.test(parentSegment[base]) ? 'L' : '') : null;
  const at = parent ? origin[segment].clone().sub(origin[parent]) : new THREE.Vector3();
  const box = new THREE.Box3().setFromPoints(clouds[segment].map((v) => v.clone().sub(origin[segment])));
  console.log(segment.padEnd(14), fmt(at).padEnd(28), fmt(box.min), '/', fmt(box.max), ` (${clouds[segment].length} verts)`);
}
const tip = (bone) => fmt(ref[bone].p.clone().sub(origin[segmentOf[bone]]));
console.log('\nball of foot in foot frame', tip('ball.l'), ' middle knuckle in hand frame', tip('middle_01.l'));

// --- Outputs ----------------------------------------------------------------
const round = (list, digits) => list.map((n) => +n.toFixed(digits));
const rig = {
  source: 'GDQuest Open 3D Mannequin (mannequiny-0.3.0), CC-BY 4.0',
  // Where the pelvis bone sits relative to our lowerTorso origin, rest pose.
  rootOffset: round(ref.pelvis.p.clone().sub(origin.lowerTorso).toArray(), 5),
  bones: names.map((name) => ({
    name,
    parent: bones[name].parent,
    segment: segmentOf[name],
    position: round(pos(bones[name].local).toArray(), 5), // fixed offset from the parent bone
    ref: round(ref[name].q.toArray(), 6),
  })),
};
fs.writeFileSync(RIG_OUT, JSON.stringify(rig, null, 1) + '\n');

const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const doc = await io.read(SOURCE);
for (const animation of doc.getRoot().listAnimations()) animation.dispose();
// The model has no textures, so its UV sets (and second colour set) are dead weight.
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const semantic of ['TEXCOORD_0', 'TEXCOORD_1', 'COLOR_1']) prim.setAttribute(semantic, null);
  }
}
await doc.transform(dedup(), prune(), quantize());
fs.mkdirSync('public/models', { recursive: true });
await io.write(MODEL_OUT, doc);
console.log(`\nwrote ${RIG_OUT} and ${MODEL_OUT} (${(fs.statSync(MODEL_OUT).size / 1024).toFixed(0)} kB)`);
