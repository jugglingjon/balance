import './styles/main.scss';
import { createStage } from './scene.js';

const HINTS = {
  side: 'Side view · scroll to zoom, right-drag to pan',
  front: 'Front view · scroll to zoom, right-drag to pan',
  orbit: 'Orbit view · drag to rotate, scroll to zoom',
};

const stage = createStage(document.getElementById('stage'));
const buttons = document.querySelectorAll('.view-switch__btn');
const hint = document.getElementById('hint');

function selectView(view) {
  stage.setView(view);
  buttons.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === view));
  });
  hint.textContent = HINTS[view];
}

buttons.forEach((btn) => {
  btn.addEventListener('click', () => selectView(btn.dataset.view));
});

selectView('side');
