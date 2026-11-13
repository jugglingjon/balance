import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// World conventions (metres): Y is up, the floor is y = 0,
// the figure faces +Z and its left/right runs along X.

// World-space band that must stay visible at zoom 1 (metres), and the screen
// margins (pixels) that the UI overlays occupy.
const VIEW_BOTTOM = -0.12;
const VIEW_TOP = 2.2;
const VIEW_WIDTH = 1.5;
const MARGIN_TOP = 112;
const MARGIN_BOTTOM = 112;
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
  controls.update();

  // In the flat views a plain drag (mouse or one finger) pans; in the orbit
  // view it rotates. Zoom is the wheel or a pinch everywhere.
  function applyControlMode() {
    const orbit = view === 'orbit';
    controls.enableRotate = orbit;
    controls.mouseButtons.LEFT = orbit ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.touches.ONE = orbit ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
  }

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc9bd, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 6, 4);
  scene.add(sun);

  scene.add(createFloor());

  let view = 'side';
  let transition = null;
  applyControlMode();

  function setView(next) {
    // Choosing the current view again recentres and resets the zoom.
    if (!VIEW_DIRECTIONS[next]) return;
    view = next;
    controls.enabled = false;
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
      controls.enabled = true;
      applyControlMode();
    }
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    // Fit the band of world space the figure can occupy into the part of the
    // canvas that is not covered by the toolbar and the preset dock. The
    // frustum is off-centre vertically so the floor sits just above the dock.
    const usable = Math.max(height - MARGIN_TOP - MARGIN_BOTTOM, 100);
    const scale = Math.max((VIEW_TOP - VIEW_BOTTOM) / usable, VIEW_WIDTH / width); // metres per pixel
    camera.bottom = VIEW_BOTTOM - MARGIN_BOTTOM * scale - TARGET.y;
    camera.top = camera.bottom + height * scale;
    camera.right = (width * scale) / 2;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
  }

  new ResizeObserver(resize).observe(canvas);
  resize();

  const frameCallbacks = [];

  renderer.setAnimationLoop((now) => {
    for (const fn of frameCallbacks) fn(now);
    if (transition) stepTransition(now);
    else controls.update();
    renderer.render(scene, camera);
  });

  return {
    scene,
    camera,
    renderer,
    controls,
    setView,
    getView: () => view,
    // Unit vector pointing from the scene toward the camera in the flat views;
    // poses are edited by rotating about it.
    getViewAxis: () => VIEW_DIRECTIONS[view],
    onFrame: (fn) => frameCallbacks.push(fn),
  };
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
