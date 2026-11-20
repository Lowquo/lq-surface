import test from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL_POSE, toParameters } from '@lowquo/surface';
// Imported from the module file directly: it must load without DOM or three.
import {
  FINE_RATIO, KEY_STEP_XY, KEY_STEP_Z, WHEEL_MAX_STEP, GESTURE_IDLE_MS,
  applyDrag, applyKey, applyWheel, formatPose, isFineAdjust, GestureTracker,
} from '../dist/interaction.js';

const close = (actual, expected, message, epsilon = 1e-12) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${message ?? ''} expected ${expected}, got ${actual}`);

const closePose = (actual, expected, epsilon = 1e-12) => {
  for (const axis of ['x', 'y', 'z']) close(actual[axis], expected[axis], `${axis}:`, epsilon);
};

/** Deterministic fake clock implementing TimerApi. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const queue = new Map();
  return {
    setTimeout(callback, ms) { seq += 1; queue.set(seq, { at: now + ms, callback }); return seq; },
    clearTimeout(id) { queue.delete(id); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const entry of queue) if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        queue.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
    },
    get pending() { return queue.size; },
  };
}

function tracker(options = {}) {
  const log = [];
  const timers = fakeTimers();
  const gestures = new GestureTracker({
    onStart: () => log.push('start'), onEnd: () => log.push('end'), timers, ...options,
  });
  return { log, timers, gestures };
}

test('fine adjustment: Shift, Ctrl and Cmd; Alt is not fine', () => {
  assert.equal(FINE_RATIO, 10);
  assert.equal(isFineAdjust({}), false);
  assert.equal(isFineAdjust({ altKey: true }), false);
  for (const key of ['shiftKey', 'ctrlKey', 'metaKey']) assert.equal(isFineAdjust({ [key]: true }), true, key);
});

test('drag: coarse speed moves one pose unit per pixelsPerUnit, y down is positive', () => {
  closePose(applyDrag(NEUTRAL_POSE, { dx: 10, dy: 0, pixelsPerUnit: 100 }), { x: 0.1, y: 0, z: 0.5 });
  closePose(applyDrag(NEUTRAL_POSE, { dx: 0, dy: 10, pixelsPerUnit: 100 }), { x: 0, y: 0.1, z: 0.5 });
  closePose(applyDrag(NEUTRAL_POSE, { dx: -25, dy: -50, pixelsPerUnit: 100 }), { x: -0.25, y: -0.5, z: 0.5 });
});

test('drag: fine ratio is exactly 10x for every fine modifier', () => {
  const coarse = applyDrag(NEUTRAL_POSE, { dx: 7, dy: -3, pixelsPerUnit: 120 });
  for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey']) {
    const fine = applyDrag(NEUTRAL_POSE, { dx: 7, dy: -3, pixelsPerUnit: 120, [modifier]: true });
    close(coarse.x / fine.x, FINE_RATIO, modifier, 1e-9);
    close(coarse.y / fine.y, FINE_RATIO, modifier, 1e-9);
  }
});

test('drag: Alt changes z only (up increases) at the same host-parameter rate as x', () => {
  const up = applyDrag(NEUTRAL_POSE, { dx: 30, dy: -10, pixelsPerUnit: 100, altKey: true });
  closePose(up, { x: 0, y: 0, z: 0.55 });
  const fineDown = applyDrag(NEUTRAL_POSE, { dx: 0, dy: 10, pixelsPerUnit: 100, altKey: true, shiftKey: true });
  close(fineDown.z, 0.495);
  // One pixel changes surface_x and surface_z by the same normalised amount.
  const base = toParameters(NEUTRAL_POSE);
  const moveX = toParameters(applyDrag(NEUTRAL_POSE, { dx: 1, dy: 0, pixelsPerUnit: 100 }));
  const moveZ = toParameters(applyDrag(NEUTRAL_POSE, { dx: 0, dy: -1, pixelsPerUnit: 100, altKey: true }));
  close(moveX[0].value - base[0].value, moveZ[2].value - base[2].value, 'per-pixel parameter rate', 1e-12);
});

test('drag: constrained to the disk; invalid input is ignored', () => {
  const far = applyDrag(NEUTRAL_POSE, { dx: 1000, dy: 1000, pixelsPerUnit: 100 });
  close(Math.hypot(far.x, far.y), 1, 'radius', 1e-9);
  closePose(applyDrag({ x: 0.2, y: 0.1, z: 0.3 }, { dx: NaN, dy: Infinity, pixelsPerUnit: 100 }), { x: 0.2, y: 0.1, z: 0.3 });
  const fallback = applyDrag(NEUTRAL_POSE, { dx: 10, dy: 0, pixelsPerUnit: 0 });
  assert.ok(Number.isFinite(fallback.x) && fallback.x > 0);
});

test('keys: arrows step x/y by 1 % of the parameter range, Shift 10x finer', () => {
  closePose(applyKey(NEUTRAL_POSE, 'ArrowRight'), { x: KEY_STEP_XY, y: 0, z: 0.5 });
  closePose(applyKey(NEUTRAL_POSE, 'ArrowLeft'), { x: -KEY_STEP_XY, y: 0, z: 0.5 });
  closePose(applyKey(NEUTRAL_POSE, 'ArrowUp'), { x: 0, y: -KEY_STEP_XY, z: 0.5 });
  closePose(applyKey(NEUTRAL_POSE, 'ArrowDown'), { x: 0, y: KEY_STEP_XY, z: 0.5 });
  closePose(applyKey(NEUTRAL_POSE, 'ArrowRight', { shiftKey: true }), { x: KEY_STEP_XY / 10, y: 0, z: 0.5 });
  closePose(applyKey(NEUTRAL_POSE, 'ArrowDown', { metaKey: true }), { x: 0, y: KEY_STEP_XY / 10, z: 0.5 });
  // 1 % of the host parameter: surface_x = (x + 1) / 2.
  close(toParameters(applyKey(NEUTRAL_POSE, 'ArrowRight'))[0].value - 0.5, 0.01);
});

test('keys: Page Up/Down and Alt+Up/Down change z; Home and 0 reset', () => {
  closePose(applyKey(NEUTRAL_POSE, 'PageUp'), { x: 0, y: 0, z: 0.5 + KEY_STEP_Z });
  closePose(applyKey(NEUTRAL_POSE, 'PageDown'), { x: 0, y: 0, z: 0.5 - KEY_STEP_Z });
  closePose(applyKey(NEUTRAL_POSE, 'PageUp', { shiftKey: true }), { x: 0, y: 0, z: 0.5 + KEY_STEP_Z / 10 });
  closePose(applyKey(NEUTRAL_POSE, 'ArrowUp', { altKey: true }), { x: 0, y: 0, z: 0.5 + KEY_STEP_Z });
  closePose(applyKey(NEUTRAL_POSE, 'ArrowDown', { altKey: true, ctrlKey: true }), { x: 0, y: 0, z: 0.5 - KEY_STEP_Z / 10 });
  const moved = { x: 0.3, y: -0.2, z: 0.9 };
  assert.deepEqual(applyKey(moved, 'Home'), NEUTRAL_POSE);
  assert.deepEqual(applyKey(moved, '0'), NEUTRAL_POSE);
});

test('keys: unhandled keys and browser shortcuts return null', () => {
  for (const key of ['Tab', 'Escape', 'Enter', ' ', 'a', 'End', '1']) assert.equal(applyKey(NEUTRAL_POSE, key), null, key);
  assert.equal(applyKey(NEUTRAL_POSE, '0', { ctrlKey: true }), null);
  assert.equal(applyKey(NEUTRAL_POSE, '0', { metaKey: true }), null);
});

test('keys: values stay within bounds', () => {
  closePose(applyKey({ x: 0, y: 0, z: 1 }, 'PageUp'), { x: 0, y: 0, z: 1 });
  closePose(applyKey({ x: 0, y: 0, z: 0 }, 'PageDown'), { x: 0, y: 0, z: 0 });
  const edge = applyKey({ x: 1, y: 0, z: 0.5 }, 'ArrowRight');
  closePose(edge, { x: 1, y: 0, z: 0.5 });
  let pose = NEUTRAL_POSE;
  for (let i = 0; i < 200; i += 1) pose = applyKey(pose, 'ArrowRight');
  close(pose.x, 1);
});

test('wheel: up increases z, modes normalised, steps capped, Shift fine via deltaX', () => {
  closePose(applyWheel(NEUTRAL_POSE, { deltaY: -100 }), { x: 0, y: 0, z: 0.525 });
  closePose(applyWheel(NEUTRAL_POSE, { deltaY: 100 }), { x: 0, y: 0, z: 0.475 });
  closePose(applyWheel(NEUTRAL_POSE, { deltaY: -3, deltaMode: 1 }), { x: 0, y: 0, z: 0.5 + 3 * 33 * 0.00025 });
  closePose(applyWheel(NEUTRAL_POSE, { deltaY: -1, deltaMode: 2 }), { x: 0, y: 0, z: 0.5 + WHEEL_MAX_STEP });
  closePose(applyWheel(NEUTRAL_POSE, { deltaY: -100000 }), { x: 0, y: 0, z: 0.5 + WHEEL_MAX_STEP });
  // Shift+wheel arrives as horizontal scrolling in browsers.
  closePose(applyWheel(NEUTRAL_POSE, { deltaY: 0, deltaX: -100, shiftKey: true }), { x: 0, y: 0, z: 0.5025 });
  closePose(applyWheel(NEUTRAL_POSE, { deltaY: -100, ctrlKey: true }), { x: 0, y: 0, z: 0.5025 });
  const still = { x: 0.1, y: 0.2, z: 0.3 };
  assert.equal(applyWheel(still, { deltaY: 0, deltaX: 50 }), still, 'horizontal scroll without Shift is ignored');
  closePose(applyWheel({ x: 0, y: 0, z: 0.99 }, { deltaY: -400 }), { x: 0, y: 0, z: 1 });
});

test('formatPose: fixed precision, no negative zero', () => {
  assert.equal(formatPose(NEUTRAL_POSE), 'X 0.000, Y 0.000, Z 0.500');
  assert.equal(formatPose({ x: -0.00001, y: -0.25, z: 1 }), 'X 0.000, Y -0.250, Z 1.000');
});

test('gestures: discrete input is coalesced and ends after the idle time', () => {
  const { log, timers, gestures } = tracker();
  for (let i = 0; i < 20; i += 1) { gestures.touch(); timers.advance(50); }
  assert.deepEqual(log, ['start']);
  assert.equal(gestures.kind, 'discrete');
  timers.advance(GESTURE_IDLE_MS - 51);
  assert.deepEqual(log, ['start']);
  timers.advance(1);
  assert.deepEqual(log, ['start', 'end']);
  assert.equal(gestures.active, false);
  assert.equal(timers.pending, 0);
  gestures.touch();
  assert.deepEqual(log, ['start', 'end', 'start'], 'input after the idle end opens a new gesture');
});

test('gestures: a pointer gesture interrupts a discrete one without overlap', () => {
  const { log, timers, gestures } = tracker();
  gestures.touch();
  gestures.beginContinuous();
  assert.deepEqual(log, ['start', 'end', 'start']);
  assert.equal(gestures.kind, 'continuous');
  gestures.touch(); // belongs to the drag
  gestures.beginContinuous(); // idempotent
  timers.advance(10_000);
  assert.deepEqual(log, ['start', 'end', 'start'], 'idle timer cleared; continuous gestures never time out');
  gestures.endContinuous();
  gestures.endContinuous();
  assert.deepEqual(log, ['start', 'end', 'start', 'end']);
});

test('gestures: end() is idempotent and cancels the idle timer', () => {
  const { log, timers, gestures } = tracker();
  gestures.end();
  gestures.touch();
  gestures.end();
  gestures.end();
  timers.advance(GESTURE_IDLE_MS * 2);
  assert.deepEqual(log, ['start', 'end']);
  gestures.touch();
  gestures.endContinuous(); // no effect on a discrete gesture
  assert.equal(gestures.kind, 'discrete');
});

test('gestures: callbacks may re-enter', () => {
  const log = [];
  const timers = fakeTimers();
  const gestures = new GestureTracker({
    timers,
    onStart: () => { log.push('start'); gestures.end(); },
    onEnd: () => log.push('end'),
  });
  gestures.beginContinuous();
  assert.deepEqual(log, ['start', 'end']);
  assert.equal(gestures.active, false);
});

test('gestures: random input sequences stay balanced', () => {
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const { log, timers, gestures } = tracker({ idleMs: 100 });
  const operations = [
    () => gestures.touch(), () => gestures.beginContinuous(), () => gestures.endContinuous(),
    () => gestures.end(), () => timers.advance(Math.floor(random() * 200)),
  ];
  let open = 0;
  const check = () => {
    for (const entry of log.splice(0)) {
      open += entry === 'start' ? 1 : -1;
      assert.ok(open === 0 || open === 1, 'never two open gestures');
    }
    assert.equal(open, gestures.active ? 1 : 0);
  };
  for (let i = 0; i < 5000; i += 1) {
    operations[Math.floor(random() * operations.length)]();
    check();
  }
  gestures.end();
  check();
  assert.equal(open, 0);
});
