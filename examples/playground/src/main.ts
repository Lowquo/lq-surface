import { clampPose, intensity, NEUTRAL_POSE, regionWeights, toParameters } from '@lowquo/surface';
import type { Pose, PoseAxis, RegionName } from '@lowquo/surface';
import { formatPose, GestureTracker, Trackball } from '@lowquo/surface-controls';
import { connectHost } from './host';
import type { HostConnection } from './host';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app not found');

const AXES: readonly PoseAxis[] = ['x', 'y', 'z'];
const REGIONS: readonly RegionName[] = ['PUNCH', 'TONE', 'CLIP', 'CRUSH', 'GLUE'];

const axisRow = (axis: PoseAxis, label: string, min: number, value: number): string => `
  <div class="axis">
    <label for="${axis}">${label}</label>
    <span class="value" id="${axis}-value" aria-hidden="true">${value.toFixed(3)}</span>
    <input id="${axis}" type="range" min="${min}" max="1" step="0.005" value="${value}" />
  </div>`;

app.innerHTML = `
  <main class="shell">
    <header class="masthead"><div><div class="eyebrow">lowquo / open source</div><h1>lq-surface<span class="version">0.1.0</span></h1><p>Expressive controls for audio software.</p></div><a class="git" href="https://github.com/Lowquo/lq-surface" target="_blank" rel="noopener noreferrer">GitHub ↗</a></header>
    <section class="panel" aria-labelledby="section-title">
      <div class="panel-top"><div><span class="eyebrow">COMPONENT 001</span><h2 id="section-title">trackball</h2></div><span class="note">3 axes / host-ready</span></div>
      <div class="scene">
        <div class="label label-top" aria-hidden="true">PUNCH</div><div class="label label-left-up" aria-hidden="true">GLUE</div><div class="label label-right-up" aria-hidden="true">TONE</div><div class="label label-left-down" aria-hidden="true">CRUSH</div><div class="label label-right-down" aria-hidden="true">CLIP</div>
        <div id="trackball" class="trackball"></div>
      </div>
      <div class="readout"><span id="lead-region">NEUTRAL</span><span id="intensity">0% intensity</span></div>
      <div class="bars" id="bars">${REGIONS.map((name) => `<div class="bar-row"><span>${name}</span><div class="bar"><div data-fill="${name}"></div></div><span class="percent" data-percent="${name}">0%</span></div>`).join('')}</div>
    </section>
    <section class="panel details" aria-labelledby="precision-title"><div class="heading-row"><h2 id="precision-title">precision</h2><button id="reset" type="button">Reset to neutral ↺</button></div>
      ${axisRow('x', 'X — horizontal', -1, 0)}
      ${axisRow('y', 'Y — vertical', -1, 0)}
      ${axisRow('z', 'Z — character', 0, 0.5)}
      <p class="hint">Drag to move · Shift, Ctrl or ⌘ for 10× finer control · Alt/Option-drag, scroll or Page Up/Down for character · Arrow keys to nudge · Esc cancels a drag · 0, Home or double-click to reset.</p>
      <div class="readout mono" id="parameters"></div>
    </section>
    <footer>MIT licensed UI toolkit · independent of DSP · <a href="https://lowquo.io" target="_blank" rel="noopener noreferrer">lowquo.io</a></footer>
  </main>`;

function q<T extends Element>(selector: string): T {
  const element = app!.querySelector<T>(selector);
  if (!element) throw new Error(`Expected ${selector}`);
  return element;
}

// DOM lookups are cached once; render() runs on every change.
const view = {
  inputs: { x: q<HTMLInputElement>('#x'), y: q<HTMLInputElement>('#y'), z: q<HTMLInputElement>('#z') },
  values: { x: q<HTMLElement>('#x-value'), y: q<HTMLElement>('#y-value'), z: q<HTMLElement>('#z-value') },
  lead: q<HTMLElement>('#lead-region'),
  intensity: q<HTMLElement>('#intensity'),
  parameters: q<HTMLElement>('#parameters'),
  reset: q<HTMLButtonElement>('#reset'),
  fills: new Map(REGIONS.map((name) => [name, q<HTMLElement>(`[data-fill="${name}"]`)])),
  percents: new Map(REGIONS.map((name) => [name, q<HTMLElement>(`[data-percent="${name}"]`)])),
};

const fixed = (value: number, digits: number): string => (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits);

function leadRegion(pose: Pose): { name: RegionName | 'NEUTRAL'; power: number } {
  const power = intensity(pose);
  const lead = regionWeights(pose).reduce((best, w) => (w.weight > best.weight ? w : best));
  return { name: power < 0.02 ? 'NEUTRAL' : lead.name, power };
}

function render(pose: Pose): void {
  const p = clampPose(pose);
  for (const axis of AXES) {
    view.inputs[axis].value = String(p[axis]);
    view.values[axis].textContent = fixed(p[axis], 3);
  }
  const { name, power } = leadRegion(p);
  view.lead.textContent = name;
  view.intensity.textContent = `${Math.round(power * 100)}% intensity`;
  for (const entry of regionWeights(p)) {
    const percent = Math.round(entry.weight * power * 100);
    view.fills.get(entry.name)!.style.width = `${percent}%`;
    view.percents.get(entry.name)!.textContent = `${percent}%`;
  }
  view.parameters.textContent = toParameters(p).map((v) => `${v.id}: ${v.value.toFixed(3)}`).join('    ');
}

// ---- host synchronisation ------------------------------------------------------
// Host parameter state is authoritative. The UI writes only inside user gestures;
// host updates are applied with setPose(..., false) and never echoed back. While
// the user is interacting, host updates are deferred until the gesture ends.

let host: HostConnection | null = null;
let openGestures = 0; // trackball + slider gestures sharing one host gesture
let sent = 0; // number of poses sent to the host
let deferred: { pose: Pose; sentBefore: number } | null = null;

function beginGesture(): void {
  openGestures += 1;
  if (openGestures === 1) host?.begin();
}

function endGesture(): void {
  if (openGestures === 0) return;
  openGestures -= 1;
  if (openGestures > 0) return;
  host?.end();
  const pending = deferred;
  deferred = null;
  // A deferred state that predates our last write is stale: the host will report
  // the final value itself. Apply it only if nothing was sent after it arrived.
  if (pending && pending.sentBefore === sent) applyHostState(pending.pose);
}

function send(pose: Pose): void {
  sent += 1;
  host?.change(pose);
}

function interacting(): boolean {
  return ball.isInteracting() || sliders.active;
}

function applyHostState(pose: Pose): void {
  if (interacting()) {
    deferred = { pose, sentBefore: sent };
    return;
  }
  ball.setPose(pose); // notify = false: no echo
  render(ball.getPose());
}

const sliders = new GestureTracker({ onStart: beginGesture, onEnd: endGesture });
const ball = new Trackball(q('#trackball'), {
  value: NEUTRAL_POSE,
  label: 'Sound-space trackball',
  formatValue: (pose) => {
    const { name, power } = leadRegion(pose);
    return `${name === 'NEUTRAL' ? 'Neutral' : `${name}, ${Math.round(power * 100)}% intensity`}. ${formatPose(pose)}`;
  },
  onGestureStart: beginGesture,
  onChange: (pose) => {
    render(pose);
    send(pose);
  },
  onGestureEnd: endGesture,
});
render(ball.getPose());

// Range sliders: pointer drags are one gesture (down to up/change); keyboard and
// assistive-technology adjustments are coalesced like the trackball's discrete input.
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
for (const axis of AXES) {
  const input = view.inputs[axis];
  input.addEventListener('pointerdown', () => sliders.beginContinuous());
  input.addEventListener('keydown', (event) => { if (SLIDER_KEYS.has(event.key)) sliders.touch(); });
  input.addEventListener('input', () => {
    if (sliders.kind !== 'continuous') sliders.touch();
    ball.setPose({ ...ball.getPose(), [axis]: Number(input.value) });
    const pose = ball.getPose();
    render(pose);
    send(pose);
  });
  input.addEventListener('change', () => sliders.endContinuous());
  // Focus moves between sliders on pointerdown: only a keyboard gesture ends on blur.
  input.addEventListener('blur', () => { if (sliders.kind === 'discrete') sliders.end(); });
}
window.addEventListener('pointerup', () => sliders.endContinuous());
window.addEventListener('pointercancel', () => sliders.endContinuous());
window.addEventListener('blur', () => sliders.end());

view.reset.addEventListener('click', () => {
  beginGesture();
  ball.setPose(NEUTRAL_POSE);
  render(NEUTRAL_POSE);
  send(NEUTRAL_POSE);
  endGesture();
});

void connectHost().then((connection) => {
  if (!connection) return;
  host = connection;
  if (openGestures > 0) connection.begin();
  connection.onHostState(applyHostState);
}).catch((error: unknown) => {
  console.warn('lq-surface playground: host connection failed', error);
});
