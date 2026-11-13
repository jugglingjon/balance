import './styles/main.scss';
import { createStage } from './scene.js';
import { SEGMENT_NAMES, createPose, createFrame, solvePose, shiftFrame } from './skeleton.js';
import { createMannequin } from './mannequin.js';
import { PRESETS, presetPose } from './presets.js';

const HINTS = {
  side: 'Side view · scroll to zoom, right-drag to pan',
  front: 'Front view · scroll to zoom, right-drag to pan',
  orbit: 'Orbit view · drag to rotate, scroll to zoom',
};
const POSE_TRANSITION_MS = 600;

const stage = createStage(document.getElementById('stage'));
const mannequin = createMannequin();
stage.scene.add(mannequin.group);

// --- Pose state -------------------------------------------------------------

const pose = createPose();
const frame = createFrame();
const scratchFrame = createFrame();
let poseTween = null;

// Solve the pose and slide the figure so the middle of its base of support
// sits at (cx, cz) on the floor.
function applyPose(cx = 0, cz = 0) {
  solvePose(pose, frame);
  shiftFrame(frame, cx - frame.supportCentre.x, cz - frame.supportCentre.z);
  mannequin.update(pose, frame);
}

function supportCentreOf(p) {
  return solvePose(p, scratchFrame).supportCentre.clone();
}

function setPreset(preset, animate = true) {
  const to = presetPose(preset);
  if (!animate) {
    for (const name of SEGMENT_NAMES) pose[name].copy(to[name]);
    poseTween = null;
    applyPose();
    return;
  }
  const from = createPose();
  for (const name of SEGMENT_NAMES) from[name].copy(pose[name]);
  poseTween = { start: performance.now(), from, to };
}

// While blending between two poses the set of grounded contacts changes, so
// the figure is positioned relative to its pelvis and the pelvis offset is
// blended between the two end poses. That keeps the motion free of jumps.
stage.onFrame((now) => {
  if (!poseTween) return;
  const t = Math.min((now - poseTween.start) / POSE_TRANSITION_MS, 1);
  const e = t * t * (3 - 2 * t);
  for (const name of SEGMENT_NAMES) pose[name].slerpQuaternions(poseTween.from[name], poseTween.to[name], e);
  const a = supportCentreOf(poseTween.from);
  const b = supportCentreOf(poseTween.to);
  solvePose(pose, frame);
  shiftFrame(frame, -(a.x + (b.x - a.x) * e), -(a.z + (b.z - a.z) * e));
  mannequin.update(pose, frame);
  if (t === 1) {
    poseTween = null;
    applyPose();
  }
});

// --- UI ---------------------------------------------------------------------

const viewButtons = document.querySelectorAll('.view-switch__btn');
const presetBar = document.getElementById('presets');
const hint = document.getElementById('hint');

function selectView(view) {
  stage.setView(view);
  viewButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === view));
  });
  hint.textContent = HINTS[view];
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
selectPreset(PRESETS[0], false);
