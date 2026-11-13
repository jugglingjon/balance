import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// World conventions (metres): Y is up, the floor is y = 0,
// the figure faces +Z and its left/right runs along X.

const VIEW_HEIGHT = 2.9; // metres visible vertically at zoom 1
const TARGET = new THREE.Vector3(0, 1.1, 0);
const CAMERA_DISTANCE = 10;
const TRANSITION_MS = 450;

// Direction from the target to the camera for each view.
const VIEW_DIRECTIONS = {
  side: new THREE.Vector3(1, 0, 0),
  front: new THREE.Vector3(0, 0, 1),
  orbit: new THREE.Vector3(0.75, 0.4, 0.85).normalize(),
};

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f1ec);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  camera.position.copy(TARGET).addScaledVector(VIEW_DIRECTIONS.side, CAMERA_DISTANCE);
  camera.lookAt(TARGET);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(TARGET);
  controls.enableDamping = true;
  controls.minZoom = 0.5;
  controls.maxZoom = 4;
  controls.maxPolarAngle = Math.PI / 2; // never look up from under the floor
  controls.enableRotate = false;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc9bd, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 6, 4);
  scene.add(sun);

  scene.add(createFloor());

  let view = 'side';
  let transition = null;

  function setView(next) {
    if (!VIEW_DIRECTIONS[next] || next === view) return;
    view = next;
    controls.enableRotate = false;
    transition = {
      start: performance.now(),
      fromDir: camera.position.clone().sub(controls.target).normalize(),
      toDir: VIEW_DIRECTIONS[next],
      fromTarget: controls.target.clone(),
      fromZoom: camera.zoom,
    };
  }

  function stepTransition(now) {
    const t = Math.min((now - transition.start) / TRANSITION_MS, 1);
    const e = t * t * (3 - 2 * t); // smoothstep
    const dir = transition.fromDir.clone().lerp(transition.toDir, e).normalize();
    controls.target.lerpVectors(transition.fromTarget, TARGET, e);
    camera.position.copy(controls.target).addScaledVector(dir, CAMERA_DISTANCE);
    camera.zoom = THREE.MathUtils.lerp(transition.fromZoom, 1, e);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    if (t === 1) {
      transition = null;
      controls.enableRotate = view === 'orbit';
    }
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    // Keep the full figure height in view; on narrow screens fit the width instead.
    const aspect = width / height;
    const halfH = Math.max(VIEW_HEIGHT, 2.2 / aspect) / 2;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.updateProjectionMatrix();
  }

  new ResizeObserver(resize).observe(canvas);
  resize();

  renderer.setAnimationLoop((now) => {
    if (transition) stepTransition(now);
    else controls.update();
    renderer.render(scene, camera);
  });

  return { scene, camera, renderer, controls, setView, getView: () => view };
}

function createFloor() {
  const floor = new THREE.Group();
  floor.name = 'floor';

  // A thin slab rather than a plane, so the ground still reads as a line
  // when the orthographic side/front cameras see it edge-on.
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.04, 4),
    new THREE.MeshStandardMaterial({ color: 0xdcd7cc, roughness: 1 })
  );
  slab.position.y = -0.02;
  floor.add(slab);

  const grid = new THREE.GridHelper(4, 8, 0xb9b3a6, 0xcbc5b9);
  grid.position.y = 0.001;
  floor.add(grid);

  // Arrow on the floor showing which way the figure faces (+Z).
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.16);
  shape.lineTo(0.1, 0);
  shape.lineTo(0.035, 0);
  shape.lineTo(0.035, -0.16);
  shape.lineTo(-0.035, -0.16);
  shape.lineTo(-0.035, 0);
  shape.lineTo(-0.1, 0);
  shape.closePath();
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0xa8a294 })
  );
  arrow.rotation.x = Math.PI / 2; // shape +Y -> world +Z
  arrow.position.set(0, 0.002, 1.2);
  arrow.material.side = THREE.DoubleSide;
  floor.add(arrow);

  return floor;
}
