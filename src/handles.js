import * as THREE from 'three';
import { SEGMENTS } from './skeleton.js';
import { buildHandles, movingSet, sideOf, mirrorName } from './rig.js';

const HANDLE_PIXELS = 17; // on-screen diameter, whatever the zoom
const HIT_RADIUS = { mouse: 16, touch: 30, pen: 20 }; // pixels
const ORDER = 20; // above the body and the balance overlay
const ALL = Object.keys(SEGMENTS);

function discTexture(fill, ring) {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = ring;
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ctx: {
//   pose, frame               live objects owned by the app
//   isMirrored()              mirror left/right toggle
//   beginDrag(preferred, fixed)  pin the figure by a planted contact, taken
//                             from the first of those segment sets that has one
//   pinPosition()             world position of the pinned contact
//   settle()                  enforce planted limbs on the edited pose and
//                             return its cost (floor and joint-limit trouble)
//   poseChanged()             re-solve and redraw after the pose was edited
//   endDrag()
// }
export function createHandles(stage, ctx) {
  const { camera, renderer, controls } = stage;
  const canvas = renderer.domElement;
  const group = new THREE.Group();
  group.name = 'handles';

  const textures = {
    idle: discTexture('#ffffff', '#3d5363'),
    hot: discTexture('#1f2d38', '#ffffff'), // not amber: that is the 'near the edge' colour
  };
  const sprites = new Map();
  let handles = [];
  let anchors = new Set();
  let anchorKey = '';
  let hovered = null;
  let drag = null;

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();

  function spriteFor(id) {
    if (!sprites.has(id)) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: textures.idle, depthTest: false, depthWrite: false, transparent: true })
      );
      sprite.renderOrder = ORDER;
      group.add(sprite);
      sprites.set(id, sprite);
    }
    return sprites.get(id);
  }

  function handlePosition(handle, target) {
    target.set(0, 0, 0);
    for (const point of handle.points) {
      _c.copy(point.local).applyQuaternion(ctx.pose[point.segment]).add(ctx.frame.origins[point.segment]);
      target.add(_c);
    }
    return target.divideScalar(handle.points.length);
  }

  function restyle() {
    for (const handle of handles) {
      const hot = handle === hovered || handle === drag?.handle;
      const sprite = spriteFor(handle.id);
      sprite.material.map = hot ? textures.hot : textures.idle;
      sprite.renderOrder = hot ? ORDER + 1 : ORDER;
    }
  }

  // Keep the dots a constant size in pixels. Called every frame because the
  // camera zoom changes without the pose changing.
  function resize() {
    if (!group.visible) return;
    const metresPerPixel = (camera.top - camera.bottom) / camera.zoom / canvas.clientHeight;
    const size = HANDLE_PIXELS * metresPerPixel;
    for (const handle of handles) {
      const hot = handle === hovered || handle === drag?.handle;
      spriteFor(handle.id).scale.setScalar(hot ? size * 1.3 : size);
    }
  }

  // Call after every solve. Rebuilds the handle set when the planted segments
  // change (never mid-drag, so the grabbed handle keeps its meaning).
  function sync() {
    group.visible = stage.getView() !== 'orbit';
    if (!drag) {
      const names = [...new Set(ctx.frame.grounded.map((c) => c.segment))].sort();
      const key = names.join(',');
      if (key !== anchorKey) {
        anchorKey = key;
        anchors = new Set(names);
        handles = buildHandles(anchors);
        hovered = null;
        const live = new Set(handles.map((h) => h.id));
        for (const [id, sprite] of sprites) sprite.visible = live.has(id);
        for (const handle of handles) spriteFor(handle.id).visible = true;
        restyle();
      }
    }
    for (const handle of handles) handlePosition(handle, spriteFor(handle.id).position);
  }

  function pointerToWorld(event, target) {
    const rect = canvas.getBoundingClientRect();
    target.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
      0
    );
    return target.unproject(camera);
  }

  function pick(event) {
    if (!group.visible) return null;
    const rect = canvas.getBoundingClientRect();
    const limit = HIT_RADIUS[event.pointerType] || HIT_RADIUS.mouse;
    let best = null;
    let bestScore = Infinity;
    for (const handle of handles) {
      handlePosition(handle, _a);
      const depth = _a.distanceTo(camera.position);
      _a.project(camera);
      const dx = ((_a.x + 1) / 2) * rect.width - (event.clientX - rect.left);
      const dy = ((1 - _a.y) / 2) * rect.height - (event.clientY - rect.top);
      const distance = Math.hypot(dx, dy);
      if (distance > limit) continue;
      // Overlapping handles (left and right limbs in profile): nearest wins.
      const score = distance + depth * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = handle;
      }
    }
    return best;
  }

  function rotate(segments, q) {
    for (const name of segments) ctx.pose[name].premultiply(q);
  }

  function dragTo(event) {
    const { handle, moving, twin } = drag;
    const axis = stage.getViewAxis();
    const pivot = handle.rock ? ctx.pinPosition() : ctx.frame.origins[handle.pivot];

    // Angle, about the view axis, from the handle to the pointer as seen from the pivot.
    handlePosition(handle, _a).sub(pivot);
    pointerToWorld(event, _b).sub(pivot);
    _a.addScaledVector(axis, -_a.dot(axis));
    _b.addScaledVector(axis, -_b.dot(axis));
    if (_a.lengthSq() < 1e-6 || _b.lengthSq() < 1e-6) return;
    const angle = Math.atan2(axis.dot(_c.crossVectors(_a, _b)), _a.dot(_b));
    if (Math.abs(angle) < 1e-5) return;

    // Take as much of the step as stays out of the floor and within the
    // joint limits. A step is allowed if it does not make things worse, so a
    // pose that is already out of range can always be dragged back.
    for (const name of ALL) drag.saved[name].copy(ctx.pose[name]);
    const attempt = (fraction) => {
      for (const name of ALL) ctx.pose[name].copy(drag.saved[name]);
      if (fraction > 0) {
        _q.setFromAxisAngle(axis, angle * fraction);
        rotate(moving, _q);
        if (twin && ctx.isMirrored()) {
          // Same motion reflected left-to-right.
          _q2.set(_q.x, -_q.y, -_q.z, _q.w);
          rotate(twin, _q2);
        }
      }
      return ctx.settle();
    };
    const allowed = drag.cost + 1e-3;
    let cost = attempt(1);
    if (cost > allowed) {
      let low = 0;
      let high = 1;
      for (let i = 0; i < 6; i++) {
        const middle = (low + high) / 2;
        if (attempt(middle) <= allowed) low = middle;
        else high = middle;
      }
      cost = attempt(low);
    }
    drag.cost = Math.min(cost, drag.cost);
    ctx.poseChanged();
  }

  function onPointerDown(event) {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const handle = pick(event);
    if (!handle) return;
    event.preventDefault();

    const all = ALL;
    const moving = handle.rock ? new Set(all) : movingSet(handle.segment, handle.pivot, anchors);
    // A free limb's opposite number mirrors the motion when it is not already
    // being carried along.
    let twin = null;
    const other = mirrorName(handle.segment);
    if (!handle.rock && other !== handle.segment && !moving.has(other)) {
      twin = movingSet(other, mirrorName(handle.pivot), anchors);
      // ...unless that limb is planted, or shares parts with this one.
      if ([...twin].some((name) => moving.has(name) || anchors.has(name))) twin = null;
    }

    const saved = {};
    for (const name of all) saved[name] = new THREE.Quaternion();
    drag = { handle, moving, twin, saved, cost: 0, pointerId: event.pointerId };
    controls.enabled = false;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Not every pointer can be captured; the drag still works over the canvas.
    }
    canvas.style.cursor = 'grabbing';
    // Prefer to pin a contact beyond the joint being turned: that part of the
    // body is what this drag pivots on.
    const beyondPivot = handle.rock ? new Set() : sideOf(handle.segment, handle.pivot);
    ctx.beginDrag(
      new Set(all.filter((name) => !beyondPivot.has(name))),
      new Set(all.filter((name) => !moving.has(name))),
      { holdLimbs: !handle.rock }
    );
    drag.cost = ctx.settle();
    restyle();
  }

  function onPointerMove(event) {
    if (drag) {
      if (event.pointerId === drag.pointerId) dragTo(event);
      return;
    }
    if (event.pointerType !== 'mouse') return;
    const handle = pick(event);
    if (handle !== hovered) {
      hovered = handle;
      canvas.style.cursor = handle ? 'grab' : '';
      restyle();
    }
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    controls.enabled = true;
    canvas.style.cursor = hovered ? 'grab' : '';
    ctx.endDrag();
    restyle();
  }

  // Capture phase, so a grab disables the camera controls before they see it.
  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  return { group, sync, resize, isDragging: () => Boolean(drag) };
}
