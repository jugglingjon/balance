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
//
// The model is stylised (large head, short arms, deep chest), so bones are
// also given scales that bring it to adult proportions. The app positions
// every bone itself rather than through the bone hierarchy, so a bone's scale
// stretches only its own part of the mesh.
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
  midTorso: 'spine_01',
  upperTorso: 'spine_02',
  head: 'neck_01',
  upperArmL: 'upperarm.l', forearmL: 'lowerarm.l', handL: 'hand.l',
  upperArmR: 'upperarm.r', forearmR: 'lowerarm.r', handR: 'hand.r',
  thighL: 'thigh.l', shinL: 'calf.l', footL: 'foot.l',
  thighR: 'thigh.r', shinR: 'calf.r', footR: 'foot.r',
};
const SEGMENT_PARENT = {
  midTorso: 'lowerTorso', upperTorso: 'midTorso', head: 'upperTorso',
  upperArmL: 'upperTorso', forearmL: 'upperArmL', handL: 'forearmL',
  thighL: 'lowerTorso', shinL: 'thighL', footL: 'shinL',
};

// Reproportioning. `along` stretches a bone lengthwise, `all` scales it
// evenly, `wide` / `deep` act across the body (left-right / front-back).
// Bones without an entry copy an evenly scaled parent (fingers follow hands).
const PROPORTIONS = [
  [/^head$/, { all: 0.86 }],
  [/^spine_02$/, { wide: 0.95, deep: 0.88 }],
  [/^upperarm\./, { along: 1.2 }],
  [/^lowerarm\./, { along: 1.25 }],
  [/^hand\./, { all: 1.05 }],
];

const BONE_SEGMENT = Object.fromEntries(Object.entries(SEGMENT_BONES).map(([s, b]) => [b, s]));
const DOWN = new THREE.Vector3(0, -1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

const glb = readGlb(SOURCE);
const bones = bindPose(glb);
const names = Object.keys(bones); // skin joint order, parents first
const pos = (m) => new THREE.Vector3().setFromMatrixPosition(m);
const rot = (m) => new THREE.Quaternion().setFromRotationMatrix(m);
const childOf = (name, pattern) => names.find((n) => bones[n].parent === name && pattern.test(n));

// --- Scales (in each bone's own axes; bones point along +Y) -------------------
const scale = {};
for (const name of names) {
  const spec = PROPORTIONS.find(([pattern]) => pattern.test(name))?.[1];
  const parent = bones[name].parent;
  if (!spec) {
    const inherited = parent && scale[parent].uniform ? scale[parent].v.clone() : ONE.clone();
    scale[name] = { v: inherited, uniform: parent ? scale[parent].uniform : false };
    continue;
  }
  if (spec.all) {
    scale[name] = { v: new THREE.Vector3().setScalar(spec.all), uniform: true };
    continue;
  }
  // Which of the bone's X / Z axes runs left-right in the bind pose?
  const x = new THREE.Vector3(1, 0, 0).transformDirection(bones[name].world);
  const xIsWide = Math.abs(x.x) > Math.abs(x.z);
  const wide = spec.wide ?? 1;
  const deep = spec.deep ?? 1;
  scale[name] = { v: new THREE.Vector3(xIsWide ? wide : deep, spec.along ?? 1, xIsWide ? deep : wide), uniform: false };
}
// A bone's offset from its parent is expressed in the parent's axes, so it
// stretches with the parent.
const offset = {};
for (const name of names) {
  const parent = bones[name].parent;
  offset[name] = pos(bones[name].local);
  if (parent) offset[name].multiply(scale[parent].v);
}

// --- Rest pose -------------------------------------------------------------
// `turn` is the world-space rotation taking a bone from the bind pose to our
// rest pose; unlisted bones inherit their parent's.
function turnFor(name) {
  const bone = bones[name];
  const along = new THREE.Vector3(0, 1, 0).transformDirection(bone.world);
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
    const targetPalm = new THREE.Vector3(0, 0, -1);
    const to = new THREE.Matrix4().makeBasis(DOWN.clone().cross(targetPalm), DOWN, targetPalm);
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
  const p = parent ? offset[name].clone().applyQuaternion(parent.q).add(parent.p) : pos(bone.world);
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
  new THREE.Matrix4().compose(ref[name].p, ref[name].q, scale[name].v).multiply(bones[name].world.clone().invert())
);
const clouds = {};
let floor = Infinity;
let top = -Infinity;
for (const prim of glb.json.meshes[0].primitives) {
  const P = glb.accessor(prim.attributes.POSITION);
  const J = glb.accessor(prim.attributes.JOINTS_0);
  const W = glb.accessor(prim.attributes.WEIGHTS_0);
  for (let i = 0; i < P.length; i++) {
    const v = new THREE.Vector3();
    let main = 0;
    for (let k = 0; k < 4; k++) {
      v.addScaledVector(new THREE.Vector3(...P[i]).applyMatrix4(skinMatrix[J[i][k]]), W[i][k]);
      if (W[i][k] > W[i][main]) main = k;
    }
    (clouds[segmentOf[names[J[i][main]]]] ||= []).push(v);
    floor = Math.min(floor, v.y);
    top = Math.max(top, v.y);
  }
}

const fmt = (v) => `[${v.toArray().map((n) => (Math.abs(n) < 5e-4 ? 0 : +n.toFixed(3))).join(', ')}]`;
console.log(`height ${(top - floor).toFixed(3)} m; floor at y = ${floor.toFixed(3)}; hips at y = ${origin.lowerTorso.y.toFixed(3)}\n`);
console.log('segment        joint in parent frame        mesh bounds in segment frame (min / max)');
for (const segment of Object.keys(SEGMENT_BONES)) {
  if (segment.endsWith('R')) continue;
  const parent = SEGMENT_PARENT[segment];
  const at = parent ? origin[segment].clone().sub(origin[parent]) : new THREE.Vector3();
  const box = new THREE.Box3().setFromPoints(clouds[segment].map((v) => v.clone().sub(origin[segment])));
  console.log(segment.padEnd(14), fmt(at).padEnd(28), fmt(box.min), '/', fmt(box.max), ` (${clouds[segment].length} verts)`);
}
const tip = (bone) => fmt(ref[bone].p.clone().sub(origin[segmentOf[bone]]));
console.log('\nball of foot in foot frame', tip('ball.l'), ' middle knuckle in hand frame', tip('middle_01.l'), ' skull base in head frame', tip('head'));

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
    position: round(offset[name].toArray(), 5), // offset from the parent bone, in the parent's axes
    ref: round(ref[name].q.toArray(), 6),
    scale: round(scale[name].v.toArray(), 4),
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
