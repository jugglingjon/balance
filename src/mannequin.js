import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SEGMENTS, SEGMENT_NAMES } from './skeleton.js';
import rig from './mannequinRig.json';

// The figure is the GDQuest "Open 3D Mannequin" (CC-BY 4.0), a skinned mesh.
// Each of its bones belongs to one of our segments and has a `ref` rotation:
// its world rotation when the figure stands in our rest pose. Posing is then
//   bone world rotation = segment rotation x ref
// with bone positions following from the model's own fixed bone offsets.
// A simple capsule figure stands in until the model has loaded.

const MODEL_URL = `${import.meta.env.BASE_URL}models/mannequin.glb`;
const UP = new THREE.Vector3(0, 1, 0);

function shapeMesh(shape, material) {
  const a = new THREE.Vector3(...shape.a);
  const b = new THREE.Vector3(...shape.b);
  const length = a.distanceTo(b);
  const geometry =
    length < 1e-6
      ? new THREE.SphereGeometry(shape.r, 24, 16)
      : new THREE.CapsuleGeometry(shape.r, length, 8, 20);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.lerpVectors(a, b, 0.5);
  if (length >= 1e-6) mesh.quaternion.setFromUnitVectors(UP, b.sub(a).normalize());
  if (shape.scale) mesh.scale.set(...shape.scale);
  return mesh;
}

function createPlaceholder() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x8fa3b1, roughness: 0.8 });
  const parts = {};
  for (const name of SEGMENT_NAMES) {
    const part = new THREE.Group();
    for (const shape of SEGMENTS[name].shapes) part.add(shapeMesh(shape, material));
    parts[name] = part;
    group.add(part);
  }
  return {
    group,
    update(pose, frame) {
      for (const name of SEGMENT_NAMES) {
        parts[name].position.copy(frame.origins[name]);
        parts[name].quaternion.copy(pose[name]);
      }
    },
  };
}

function createModel(gltf) {
  const group = gltf.scene;
  let skinned = null;
  group.traverse((node) => {
    if (node.isSkinnedMesh) skinned = node;
  });
  if (!skinned) throw new Error('Mannequin model has no skinned mesh');
  // The bounds are computed for the bind pose only, so never cull.
  skinned.frustumCulled = false;

  const byName = {};
  for (const bone of skinned.skeleton.bones) byName[bone.name] = bone;
  const bones = rig.bones.map((def) => {
    // GLTFLoader strips characters such as "." from node names.
    const bone = byName[THREE.PropertyBinding.sanitizeNodeName(def.name)];
    if (!bone) throw new Error(`Mannequin model is missing bone "${def.name}"`);
    bone.position.fromArray(def.position);
    bone.scale.set(1, 1, 1);
    return {
      bone,
      segment: def.segment,
      ref: new THREE.Quaternion().fromArray(def.ref),
      world: new THREE.Quaternion(),
      parent: null,
      parentName: def.parent,
    };
  });
  for (const entry of bones) entry.parent = bones[rig.bones.findIndex((d) => d.name === entry.parentName)] || null;

  const rootOffset = new THREE.Vector3().fromArray(rig.rootOffset);
  const _q = new THREE.Quaternion();

  return {
    group,
    update(pose, frame) {
      // rig.bones lists parents before children.
      for (const entry of bones) {
        entry.world.multiplyQuaternions(pose[entry.segment], entry.ref);
        if (entry.parent) {
          entry.bone.quaternion.copy(_q.copy(entry.parent.world).invert()).multiply(entry.world);
        } else {
          entry.bone.quaternion.copy(entry.world);
          entry.bone.position.copy(rootOffset).applyQuaternion(pose.lowerTorso).add(frame.origins.lowerTorso);
        }
      }
    },
  };
}

export function createMannequin() {
  const group = new THREE.Group();
  group.name = 'mannequin';

  let figure = createPlaceholder();
  group.add(figure.group);
  let last = null;

  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      const model = createModel(gltf);
      group.remove(figure.group);
      figure = model;
      group.add(figure.group);
      if (last) figure.update(last.pose, last.frame);
    },
    undefined,
    (error) => console.error('Could not load the mannequin model; using the simple figure.', error)
  );

  return {
    group,
    update(pose, frame) {
      last = { pose, frame };
      figure.update(pose, frame);
    },
  };
}
