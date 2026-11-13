import './styles/main.scss';
import { createStage } from './scene.js';
import * as THREE from 'three';
import { SEGMENTS, SEGMENT_NAMES, createPose, createFrame, solvePose, shiftFrame } from './skeleton.js';
import { createMannequin } from './mannequin.js';
import { PRESETS, presetPose } from './presets.js';
import { createBalance, computeBalance } from './balance.js';
import { createBalanceViz } from './balanceViz.js';
import { createMassViz } from './massViz.js';
import { createHandles } from './handles.js';
import { placePinned, makePlants, holdPlants, floorDepth, limitExcess } from './constraints.js';

const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const POSING_HINT = TOUCH
  ? 'Drag the white dots to pose · drag elsewhere to pan · pinch to zoom'
  : 'Drag the white dots to move the body · drag elsewhere to pan · scroll to zoom';
const HINTS = {
  side: POSING_HINT,
  front: POSING_HINT,
  orbit: 'Drag to rotate · switch to Side or Front to pose',
};
const MASS_HINT = 'Purple dots mark each body part’s weight: the bigger the dot, the heavier the part';
const STATUS_LABELS = { balanced: 'Balanced', edge: 'Near the edge', unbalanced: 'Off balance' };
const POSE_TRANSITION_MS = 600;
const DEFAULT_PRESET = 'handstand';

const stage = createStage(document.getElementById('stage'));
const mannequin = createMannequin();
stage.scene.add(mannequin.group);
const balanceViz = createBalanceViz();
stage.scene.add(balanceViz.group);
const massViz = createMassViz();
stage.scene.add(massViz.group);

// --- Pose state -------------------------------------------------------------

const pose = createPose();
const frame = createFrame();
const scratchFrame = createFrame();
const balance = createBalance();
let poseTween = null;
// Where the figure stands. With no pin, the middle of its base of support is
// kept at the origin. Once the user starts dragging, one planted contact is
// pinned in place instead so the body moves around what is on the floor.
let pin = null; // { segment, local, x, z, position }
let plants = []; // hands and feet to keep planted during the current drag
let mirrored = true; // arms move together
let splitLegs = false; // legs move independently
let showMass = false;

const LEG_PARTS = ['thigh', 'shin', 'foot'];
const SPLIT_ANGLE = THREE.MathUtils.degToRad(14);
const SIDE_AXIS = new THREE.Vector3(1, 0, 0);
const _tilt = new THREE.Quaternion();

function copyPose(from, to = createPose()) {
  for (const name of SEGMENT_NAMES) to[name].copy(from[name]);
  return to;
}

// With the legs split, two legs in the same position would hide each other's
// handles in the side view. Swing the far (right) leg a little, whichever way
// lifts it further from the floor.
function separateLegs(target) {
  const together = LEG_PARTS.every((part) => target[part + 'L'].angleTo(mirrorQuat(target[part + 'R'])) < 0.1);
  if (!together) return target;
  let best = null;
  for (const sign of [1, -1]) {
    const candidate = copyPose(target);
    _tilt.setFromAxisAngle(SIDE_AXIS, sign * SPLIT_ANGLE);
    for (const part of LEG_PARTS) candidate[part + 'R'].premultiply(_tilt);
    solvePose(candidate, scratchFrame);
    const footHeight = scratchFrame.origins.footR.y - limitExcess(candidate, { splitLegs: true });
    if (!best || footHeight > best.footHeight) best = { candidate, footHeight };
  }
  return best.candidate;
}

// Bring the legs back together: the far leg takes up the near leg's position.
function joinLegs(target) {
  for (const part of LEG_PARTS) target[part + 'R'].copy(mirrorQuat(target[part + 'L']));
  return target;
}

const _mirror = new THREE.Quaternion();
function mirrorQuat(q) {
  return _mirror.set(q.x, -q.y, -q.z, q.w);
}

const _pinPoint = new THREE.Vector3();
function pinPosition() {
  return _pinPoint.copy(pin.local).applyQuaternion(pose[pin.segment]).add(frame.origins[pin.segment]);
}

// Redraw everything that depends on the solved pose.
function refresh() {
  mannequin.update(pose, frame);
  computeBalance(pose, frame, balance);
  balanceViz.update(balance);
  massViz.update(balance);
  handles.sync();
  updateStatus();
}

function applyPose() {
  solvePose(pose, frame);
  if (pin) {
    const p = pinPosition();
    shiftFrame(frame, pin.x - p.x, pin.z - p.z);
  } else {
    shiftFrame(frame, -frame.supportCentre.x, -frame.supportCentre.z);
  }
  refresh();
}

const handles = createHandles(stage, {
  pose,
  frame,
  // Arms follow the Mirror toggle; legs move together unless split.
  isMirrored: (segment) => (LEG_PARTS.some((part) => segment.startsWith(part)) ? !splitLegs : mirrored),
  pinPosition,
  poseChanged: applyPose,
  beginDrag(preferred, fixed, { holdLimbs }) {
    poseTween = null;
    clearPresetSelection();
    // Pin a planted contact that this drag will not move; failing that, any.
    const contact =
      frame.grounded.find((c) => preferred.has(c.segment)) ||
      frame.grounded.find((c) => fixed.has(c.segment)) ||
      frame.grounded[0];
    const def = SEGMENTS[contact.segment].contacts.find((c) => c.id === contact.id);
    pin = { segment: contact.segment, local: def.p, x: contact.position.x, z: contact.position.z };
    pin.position = pinPosition().clone();
    plants = holdLimbs ? makePlants(pose, frame) : [];
  },
  // Costs are in degrees; a millimetre into the floor counts like a degree.
  settle() {
    placePinned(pose, scratchFrame.origins, pin);
    holdPlants(pose, scratchFrame.origins, plants, pin);
    return floorDepth(pose, scratchFrame.origins) * 1000 + limitExcess(pose, { splitLegs });
  },
  endDrag() {
    plants = [];
  },
});
stage.scene.add(handles.group);
stage.onFrame(() => handles.resize());

function setPreset(preset, animate = true) {
  const to = presetPose(preset);
  tweenTo(splitLegs ? separateLegs(to) : to, animate);
}

// Move to a pose, recentring the figure over its base of support.
function tweenTo(to, animate = true) {
  pin = null;
  if (!animate) {
    for (const name of SEGMENT_NAMES) pose[name].copy(to[name]);
    poseTween = null;
    applyPose();
    return;
  }
  const from = copyPose(pose);
  // Blend the pelvis position too: from wherever the figure is now to where
  // the new pose stands when centred. solvePose leaves the pelvis above the
  // origin, so the centred pelvis offset is minus the support centre.
  const target = solvePose(to, scratchFrame).supportCentre;
  poseTween = {
    start: performance.now(),
    from,
    to,
    fromX: frame.origins.lowerTorso.x,
    fromZ: frame.origins.lowerTorso.z,
    toX: -target.x,
    toZ: -target.z,
  };
}

stage.onFrame((now) => {
  if (!poseTween) return;
  const tw = poseTween;
  const t = Math.min((now - tw.start) / POSE_TRANSITION_MS, 1);
  const e = t * t * (3 - 2 * t);
  for (const name of SEGMENT_NAMES) pose[name].slerpQuaternions(tw.from[name], tw.to[name], e);
  if (t === 1) {
    poseTween = null;
    applyPose();
    return;
  }
  solvePose(pose, frame);
  shiftFrame(frame, tw.fromX + (tw.toX - tw.fromX) * e, tw.fromZ + (tw.toZ - tw.fromZ) * e);
  refresh();
});

// --- UI ---------------------------------------------------------------------

const viewButtons = document.querySelectorAll('.view-switch__btn');
const presetBar = document.getElementById('presets');
const hint = document.getElementById('hint');
const statusEl = document.getElementById('status');
const statusLabel = statusEl.querySelector('.status__label');
const statusDetail = statusEl.querySelector('.status__detail');

function updateStatus() {
  const cm = Math.abs(balance.margin * 100);
  const distance = cm < 9.95 ? cm.toFixed(1) : cm.toFixed(0);
  statusEl.dataset.state = balance.state;
  statusLabel.textContent = STATUS_LABELS[balance.state];
  statusDetail.innerHTML =
    `<span class="status__prefix">Centre of gravity is </span>${distance} cm ` +
    (balance.balanced ? 'inside the base' : 'outside the base');
}

function clearPresetSelection() {
  presetBar.querySelectorAll('button').forEach((btn) => btn.setAttribute('aria-pressed', 'false'));
}

function selectView(view) {
  stage.setView(view);
  handles.sync();
  viewButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === view));
  });
  updateHint();
}

function updateHint() {
  hint.textContent = showMass ? MASS_HINT : HINTS[stage.getView()];
}

function selectPreset(preset, animate = true) {
  setPreset(preset, animate);
  if (stage.getView() !== 'orbit') selectView(preset.view);
  presetBar.querySelectorAll('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.preset === preset.id));
  });
}

viewButtons.forEach((btn) => {
  btn.addEventListener('click', () => selectView(btn.dataset.view));
});

const massToggle = document.getElementById('mass');
massToggle.addEventListener('click', () => {
  showMass = !showMass;
  massToggle.setAttribute('aria-pressed', String(showMass));
  massViz.setVisible(showMass);
  updateHint();
});

const splitToggle = document.getElementById('split');
splitToggle.addEventListener('click', () => {
  splitLegs = !splitLegs;
  splitToggle.setAttribute('aria-pressed', String(splitLegs));
  const target = copyPose(pose);
  tweenTo(splitLegs ? separateLegs(target) : joinLegs(target));
  clearPresetSelection();
});

const mirrorToggle = document.getElementById('mirror');
mirrorToggle.addEventListener('click', () => {
  mirrored = !mirrored;
  mirrorToggle.setAttribute('aria-pressed', String(mirrored));
});

for (const preset of PRESETS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'presets__btn';
  btn.dataset.preset = preset.id;
  btn.textContent = preset.name;
  btn.addEventListener('click', () => {
    selectPreset(preset);
    btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
  presetBar.append(btn);
}

selectView('side');
selectPreset(PRESETS.find((preset) => preset.id === DEFAULT_PRESET), false);

// Development aid: lets automated checks find handles on screen.
if (import.meta.env.DEV) {
  window.__balance = {
    balance,
    pose,
    frame,
    handlePoints() {
      const rect = stage.renderer.domElement.getBoundingClientRect();
      return handles.group.children
        .filter((s) => s.visible)
        .map((s) => {
          const p = s.position.clone().project(stage.camera);
          return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height, world: s.position.toArray() };
        });
    },
  };
}
