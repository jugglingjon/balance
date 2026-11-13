import * as THREE from 'three';
import { SEGMENTS, SEGMENT_NAMES } from './skeleton.js';

// One dot per body segment at its centre of mass. A dot's area is
// proportional to the segment's share of body weight, which shows why moving
// a leg shifts the balance far more than moving an arm.

const COLOUR = '#7a4fb5';
const DIAMETER_AT_FULL_MASS = 0.3; // metres, for a (hypothetical) segment holding all the mass
const ORDER = 15; // above the body and floor overlay, below the handles

function dotTexture() {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
  ctx.fillStyle = COLOUR;
  ctx.globalAlpha = 0.72;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMassViz() {
  const group = new THREE.Group();
  group.name = 'mass';
  group.visible = false;

  const material = new THREE.SpriteMaterial({ map: dotTexture(), depthTest: false, depthWrite: false, transparent: true });
  const dots = {};
  for (const name of SEGMENT_NAMES) {
    const dot = new THREE.Sprite(material);
    dot.scale.setScalar(DIAMETER_AT_FULL_MASS * Math.sqrt(SEGMENTS[name].mass));
    dot.renderOrder = ORDER;
    dots[name] = dot;
    group.add(dot);
  }

  return {
    group,
    setVisible(visible) {
      group.visible = visible;
    },
    update(balance) {
      for (const name of SEGMENT_NAMES) dots[name].position.copy(balance.parts[name]);
    },
  };
}
