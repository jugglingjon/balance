import * as THREE from 'three';
import { SEGMENTS, SEGMENT_NAMES } from './skeleton.js';

const COLOURS = {
  centre: 0x6c8496,
  L: 0x5a7386, // near side in the side view
  R: 0x93a7b4, // far side, lighter so overlapping limbs stay readable
};

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

export function createMannequin() {
  const group = new THREE.Group();
  group.name = 'mannequin';

  const materials = {};
  for (const [key, color] of Object.entries(COLOURS)) {
    materials[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  }

  const parts = {};
  for (const name of SEGMENT_NAMES) {
    const seg = SEGMENTS[name];
    const part = new THREE.Group();
    part.name = name;
    for (const shape of seg.shapes) part.add(shapeMesh(shape, materials[seg.side || 'centre']));
    parts[name] = part;
    group.add(part);
  }

  function update(pose, frame) {
    for (const name of SEGMENT_NAMES) {
      parts[name].position.copy(frame.origins[name]);
      parts[name].quaternion.copy(pose[name]);
    }
  }

  return { group, parts, update };
}
