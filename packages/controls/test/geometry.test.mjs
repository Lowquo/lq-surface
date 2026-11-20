import test from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL_POSE } from '@lowquo/surface';
import {
  TRAVEL_RATIO, computeLayout, markerDirection, markerPoint, poseOrientation, rotate, twistAngle,
} from '../dist/geometry.js';

const close = (actual, expected, message, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${message ?? ''} expected ${expected}, got ${actual}`);

/** Orthographic projection used by both renderers. */
const project = (layout, [mx, my]) => ({ x: layout.cx + layout.ball * mx, y: layout.cy - layout.ball * my });

const samplePoses = () => {
  const poses = [NEUTRAL_POSE, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 1 }, { x: -0.6, y: 0.8, z: 0.25 }];
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 200; i += 1) {
    const r = Math.sqrt(random());
    const a = random() * Math.PI * 2;
    poses.push({ x: r * Math.cos(a), y: r * Math.sin(a), z: random() });
  }
  return poses;
};

test('layout: centred ball sized from the smaller side', () => {
  const layout = computeLayout(510, 390);
  close(layout.cx, 255);
  close(layout.cy, 195);
  close(layout.ball, 390 / 2.6);
  close(layout.travel, layout.ball * TRAVEL_RATIO);
  assert.ok(computeLayout(0, -5).ball >= 1, 'degenerate sizes stay positive');
});

test('marker: neutral is the centre, screen y grows downwards', () => {
  const layout = computeLayout(400, 300);
  assert.deepEqual(markerPoint(layout, NEUTRAL_POSE), { x: 200, y: 150 });
  const right = markerPoint(layout, { x: 1, y: 0, z: 0.5 });
  close(right.x, 200 + layout.travel);
  const top = markerPoint(layout, { x: 0, y: -1, z: 0.5 });
  close(top.y, 150 - layout.travel, 'y = -1 (PUNCH) is the top');
});

test('what you see is the value: the rotated marker projects onto the pose position', () => {
  const layout = computeLayout(510, 390);
  for (const pose of samplePoses()) {
    const q = poseOrientation(pose);
    close(Math.hypot(...q), 1, 'unit quaternion');
    const tip = rotate(q, [0, 0, 1]);
    const direction = markerDirection(pose);
    for (let i = 0; i < 3; i += 1) close(tip[i], direction[i], `direction[${i}]`);
    assert.ok(tip[2] >= Math.sqrt(1 - TRAVEL_RATIO ** 2) - 1e-9, 'marker never goes edge-on');
    const screen = project(layout, tip);
    const expected = markerPoint(layout, pose);
    close(screen.x, expected.x, 'screen x', 1e-6);
    close(screen.y, expected.y, 'screen y', 1e-6);
  }
});

test('twist: z 0.5 points up, increasing z turns clockwise up to +135 degrees', () => {
  close(twistAngle(0.5), 0);
  close(twistAngle(0), -Math.PI * 0.75);
  close(twistAngle(1), Math.PI * 0.75);
  close(twistAngle(7), Math.PI * 0.75, 'clamped');
  for (const z of [0, 0.25, 0.5, 0.8, 1]) {
    const q = poseOrientation({ x: 0, y: 0, z });
    const index = rotate(q, [0, 1, 0]);
    // Screen angle clockwise from 12 o'clock: atan2(screen x, -screen y) = atan2(mx, my).
    close(Math.atan2(index[0], index[1]), twistAngle(z), `z ${z}`);
    close(index[2], 0, 'twist stays in the screen plane at the centre');
  }
});

test('twist does not move the marker', () => {
  for (const pose of samplePoses().slice(0, 40)) {
    const a = rotate(poseOrientation({ ...pose, z: 0 }), [0, 0, 1]);
    const b = rotate(poseOrientation({ ...pose, z: 1 }), [0, 0, 1]);
    for (let i = 0; i < 3; i += 1) close(a[i], b[i]);
  }
});
