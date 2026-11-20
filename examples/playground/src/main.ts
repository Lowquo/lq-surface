import { clampPose, NEUTRAL_POSE, regionWeights, intensity, toParameters } from '@lowquo/surface';
import type { Pose } from '@lowquo/surface';
import { Trackball } from '@lowquo/surface-controls';
import { createJuceBridge, SurfaceHostController } from '@lowquo/surface-juce';
import { getNativeFunction } from '@juce-framework/webview';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app not found');
app.innerHTML = `
  <main class="shell">
    <header class="masthead"><div><div class="eyebrow">lowquo / open source</div><h1>lq-surface<span class="version">0.1.0</span></h1><p>Expressive controls for audio software.</p></div><a class="git" href="https://github.com/Lowquo/lq-surface" target="_blank" rel="noopener noreferrer">GitHub ↗</a></header>
    <section class="panel" aria-labelledby="section-title">
      <div class="panel-top"><div><span class="eyebrow">COMPONENT 001</span><h2 id="section-title">trackball</h2></div><span class="note">3 axes / host-ready</span></div>
      <div class="scene"><div class="label label-top">PUNCH</div><div class="label label-left-up">GLUE</div><div class="label label-right-up">TONE</div><div class="label label-left-down">CRUSH</div><div class="label label-right-down">CLIP</div><div id="trackball" class="trackball"></div></div>
      <div class="readout" aria-live="polite"><span id="lead-region">NEUTRAL</span><span id="intensity">0% intensity</span></div>
      <div class="bars" id="bars"></div>
    </section>
    <section class="panel details" aria-label="Precision controls"><div class="heading-row"><h2>precision</h2><button id="reset" type="button">Reset to neutral ↺</button></div>
      <label>X — horizontal <output id="x-value">0.00</output><input id="x" type="range" min="-1" max="1" step="0.005" value="0" /></label>
      <label>Y — vertical <output id="y-value">0.00</output><input id="y" type="range" min="-1" max="1" step="0.005" value="0" /></label>
      <label>Z — character <output id="z-value">0.50</output><input id="z" type="range" min="0" max="1" step="0.005" value="0.5" /></label>
      <p class="hint">Drag to move · Shift-drag for precision · Alt/Option-drag or scroll for character · Arrow keys to adjust · 0 to reset · Double-click to centre.</p>
      <div class="readout mono" id="parameters" aria-label="Normalized host parameter values"></div>
    </section>
    <footer>MIT licensed UI toolkit · independent of DSP · <a href="https://lowquo.io" target="_blank" rel="noopener noreferrer">lowquo.io</a></footer>
  </main>`;

const q = <T extends HTMLElement>(selector: string): T => {
  const el = app!.querySelector<T>(selector);
  if (!el) throw new Error(`Expected ${selector}`);
  return el;
};
const axes = {
  x: q<HTMLInputElement>('#x'), y: q<HTMLInputElement>('#y'), z: q<HTMLInputElement>('#z'),
};
const bars = q<HTMLDivElement>('#bars');
const names = ['PUNCH', 'TONE', 'CLIP', 'CRUSH', 'GLUE'] as const;
for (const name of names) {
  const row = document.createElement('div');
  row.className = 'bar-row';
  row.innerHTML = `<span>${name}</span><div class="bar"><div data-fill="${name}"></div></div><output data-output="${name}">0%</output>`;
  bars.appendChild(row);
}

const isJuce = typeof (window as Window & { __JUCE__?: unknown }).__JUCE__ !== 'undefined';
const host = isJuce ? new SurfaceHostController(createJuceBridge(getNativeFunction)) : null;
let gestureActive = false;
let ball: Trackball;
function update(pose: Pose, notifyHost: boolean): void {
  const p = clampPose(pose);
  // Don't echo host automation when native host origin updates use setPose(false).
  ball.setPose(p);
  for (const axis of ['x', 'y', 'z'] as const) {
    axes[axis].value = String(p[axis]);
    q<HTMLOutputElement>(`#${axis}-value`).value = p[axis].toFixed(2);
  }
  const weights = regionWeights(p);
  const lead = weights.reduce((best, w) => w.weight > best.weight ? w : best);
  const power = intensity(p);
  q<HTMLElement>('#lead-region').textContent = power < .02 ? 'NEUTRAL' : lead.name;
  q<HTMLElement>('#intensity').textContent = `${Math.round(power * 100)}% intensity`;
  for (const entry of weights) {
    const percent = Math.round(entry.weight * power * 100);
    const fill = q<HTMLElement>(`[data-fill="${entry.name}"]`);
    fill.style.width = `${percent}%`;
    q<HTMLOutputElement>(`[data-output="${entry.name}"]`).value = `${percent}%`;
  }
  q<HTMLElement>('#parameters').textContent = toParameters(p).map((v) => `${v.id}: ${v.value.toFixed(3)}`).join('    ');
  if (notifyHost) host?.change(p);
}
ball = new Trackball(q('#trackball'), {
  value: NEUTRAL_POSE,
  onGestureStart: () => { gestureActive = true; host?.begin(); },
  onChange: (pose) => update(pose, true),
  onGestureEnd: () => { host?.end(); gestureActive = false; },
});
update(NEUTRAL_POSE, false);
for (const axis of ['x', 'y', 'z'] as const) {
  axes[axis].addEventListener('input', () => {
    host?.begin();
    update({ ...ball.getPose(), [axis]: Number(axes[axis].value) }, true);
    host?.end();
  });
}
q<HTMLButtonElement>('#reset').addEventListener('click', () => {
  host?.begin(); update(NEUTRAL_POSE, true); host?.end();
});

// Optional native-host automation state. The JUCE example emits the three values.
const hostWindow = window as Window & { __JUCE__?: { backend: { addEventListener: (name: string, cb: (v: unknown) => void) => unknown } } };
if (isJuce && hostWindow.__JUCE__) {
  hostWindow.__JUCE__.backend.addEventListener('surfaceHostState', (value: unknown) => {
    if (gestureActive || !value || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    if (![data.x, data.y, data.z].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    update({ x: Number(data.x) * 2 - 1, y: Number(data.y) * 2 - 1, z: Number(data.z) }, false);
  });
}
