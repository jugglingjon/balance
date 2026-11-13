import * as THREE from 'three';

export const STATE_COLOURS = { balanced: '#2f9e6e', edge: '#e0871b', unbalanced: '#d1495b' };

const BASE_THICKNESS = 0.02; // the base is a thin slab so it shows edge-on
const MARKER_SIZE = 0.11;
const OVERLAY_ORDER = 10; // drawn on top of the body

// The classic centre-of-gravity symbol: a circle in alternating quarters.
function markerTexture(colour) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const r = c - 8;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colour;
  for (const start of [0, Math.PI]) {
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, start, start + Math.PI / 2);
    ctx.fill();
  }
  ctx.lineWidth = 9;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createBalanceViz() {
  const group = new THREE.Group();
  group.name = 'balance';

  const textures = {};
  for (const [state, colour] of Object.entries(STATE_COLOURS)) textures[state] = markerTexture(colour);
  const overlay = { depthTest: false, depthWrite: false, transparent: true };

  // Base of support on the floor.
  const baseMaterial = new THREE.MeshBasicMaterial({ ...overlay, opacity: 0.4, side: THREE.DoubleSide });
  const base = new THREE.Mesh(new THREE.BufferGeometry(), baseMaterial);
  base.rotation.x = Math.PI / 2; // shape (x, y) -> floor (x, z), extruded downward
  base.position.y = BASE_THICKNESS;
  base.renderOrder = OVERLAY_ORDER;
  group.add(base);

  // The middle of the base, where the pose is comfortably balanced.
  const coreMaterial = new THREE.MeshBasicMaterial({ ...overlay, opacity: 0.75, side: THREE.DoubleSide });
  const core = new THREE.Mesh(new THREE.BufferGeometry(), coreMaterial);
  core.rotation.x = Math.PI / 2;
  core.position.y = BASE_THICKNESS;
  core.renderOrder = OVERLAY_ORDER + 1;
  group.add(core);

  const outlineMaterial = new THREE.LineBasicMaterial({ ...overlay });
  const outline = new THREE.LineLoop(new THREE.BufferGeometry(), outlineMaterial);
  outline.position.y = BASE_THICKNESS;
  outline.renderOrder = OVERLAY_ORDER + 3;
  group.add(outline);

  // Plumb line from the centre of gravity down to the floor.
  const lineMaterial = new THREE.MeshBasicMaterial({ ...overlay });
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 8), lineMaterial);
  line.renderOrder = OVERLAY_ORDER + 3;
  group.add(line);

  const footMaterial = new THREE.MeshBasicMaterial({ ...overlay });
  const foot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 12), footMaterial);
  foot.renderOrder = OVERLAY_ORDER + 4;
  group.add(foot);

  const markerMaterial = new THREE.SpriteMaterial({ ...overlay, map: textures.balanced });
  const marker = new THREE.Sprite(markerMaterial);
  marker.scale.setScalar(MARKER_SIZE);
  marker.renderOrder = OVERLAY_ORDER + 5;
  group.add(marker);

  function update(balance) {
    const { state } = balance;
    const colour = STATE_COLOURS[state];
    for (const m of [baseMaterial, coreMaterial, outlineMaterial, lineMaterial, footMaterial]) m.color.set(colour);
    markerMaterial.map = textures[state];

    const { com, hull } = balance;
    const slab = (points) =>
      new THREE.ExtrudeGeometry(new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, p.z))), {
        depth: BASE_THICKNESS,
        bevelEnabled: false,
      });
    marker.position.copy(com);
    foot.position.set(com.x, 0, com.z);
    line.position.set(com.x, com.y / 2, com.z);
    line.scale.y = Math.max(com.y, 1e-4);

    base.geometry.dispose();
    base.geometry = slab(hull);
    core.geometry.dispose();
    core.geometry = slab(balance.core);
    outline.geometry.dispose();
    outline.geometry = new THREE.BufferGeometry().setFromPoints(
      hull.map((p) => new THREE.Vector3(p.x, 0, p.z))
    );
  }

  return { group, update };
}
