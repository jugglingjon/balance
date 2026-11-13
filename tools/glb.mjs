// Minimal GLB reader for the offline rig tools (no loader, no DOM).
import fs from 'node:fs';
import * as THREE from 'three';

const TYPES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

export function readGlb(path) {
  const data = fs.readFileSync(path);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength + 8;
  const bin = data.subarray(binStart, binStart + data.readUInt32LE(20 + jsonLength));

  // Returns an array of rows (arrays of numbers), normalised where flagged.
  function accessor(index) {
    const acc = json.accessors[index];
    const view = json.bufferViews[acc.bufferView];
    const Type = ARRAYS[acc.componentType];
    const size = TYPES[acc.type];
    const stride = view.byteStride || size * Type.BYTES_PER_ELEMENT;
    const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const rows = [];
    for (let i = 0; i < acc.count; i++) {
      const copy = Buffer.from(bin.subarray(base + i * stride, base + i * stride + size * Type.BYTES_PER_ELEMENT));
      let row = Array.from(new Type(copy.buffer, copy.byteOffset, size));
      if (acc.normalized) {
        const max = Type === Uint8Array ? 255 : Type === Uint16Array ? 65535 : 1;
        row = row.map((v) => v / max);
      }
      rows.push(row);
    }
    return rows;
  }

  return { json, accessor };
}

// Bind pose of a skin: per joint { name, parent, world (Matrix4), local (Matrix4) }.
export function bindPose(glb, skinIndex = 0) {
  const { json } = glb;
  const skin = json.skins[skinIndex];
  const inverse = glb.accessor(skin.inverseBindMatrices);
  const parentOf = {};
  json.nodes.forEach((node, i) => (node.children || []).forEach((c) => (parentOf[c] = i)));
  const bones = {};
  skin.joints.forEach((nodeIndex, j) => {
    const world = new THREE.Matrix4().fromArray(inverse[j]).invert();
    bones[json.nodes[nodeIndex].name] = { name: json.nodes[nodeIndex].name, index: j, nodeIndex, world };
  });
  for (const bone of Object.values(bones)) {
    const parentNode = parentOf[bone.nodeIndex];
    const parent = parentNode !== undefined ? bones[json.nodes[parentNode].name] : null;
    bone.parent = parent ? parent.name : null;
    bone.local = parent ? parent.world.clone().invert().multiply(bone.world) : bone.world.clone();
  }
  return bones;
}
