/**
 * Shared, renderer-independent trackball geometry. Both the WebGL and the 2D
 * canvas renderers draw from these numbers, so they look and respond the same.
 *
 * Model space: unit ball, x right, y up, z towards the viewer. Both renderers
 * use an orthographic projection, so a model point (mx, my) lands on screen at
 * (cx + ball * mx, cy - ball * my) exactly.
 */
import { clamp, clampPose } from '@lowquo/surface';
import type { Pose } from '@lowquo/surface';

/**
 * Pose (x, y) maps to the front-hemisphere point (k*x, -k*y, sqrt(1 - k^2 r^2)).
 * k < 1 keeps the marker visibly on the front face even at the rim.
 */
export const TRAVEL_RATIO = 0.8;
/** Radius of the z (twist) scale ring, in ball radii. */
export const Z_RING_RATIO = 1.12;
/** Radius of the keyboard focus ring, in ball radii. */
export const FOCUS_RING_RATIO = 1.22;
/** Half of the smaller canvas side, in ball radii (leaves room for both rings). */
export const EXTENT_RATIO = 1.3;
/** Marker bead radius, in ball radii. */
export const MARKER_RATIO = 0.06;
/** Total twist travel: z 0..1 maps to -135..+135 degrees, z 0.5 points straight up. */
export const TWIST_SPAN = Math.PI * 1.5;

/** Hardware-inspired palette shared by both renderers (hex RGB). */
export const PALETTE = Object.freeze({
  body: 0x3a3d50,
  grid: 0xb9b3d6,
  boundary: 0x918bad,
  track: 0x474a5e,
  value: 0xeac9ad,
  index: 0xc4b4df,
  focus: 0xe1ddeb,
});

export type Layout = Readonly<{
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** Ball radius in CSS pixels. */
  ball: number;
  /** Marker travel radius in CSS pixels: the screen distance of pose radius 1. */
  travel: number;
}>;

export function computeLayout(width: number, height: number): Layout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const ball = Math.max(1, Math.min(w, h) / (2 * EXTENT_RATIO));
  return { width: w, height: h, cx: w / 2, cy: h / 2, ball, travel: ball * TRAVEL_RATIO };
}

/** Screen position (CSS pixels) of the marker centre: what you see is the value. */
export function markerPoint(layout: Layout, pose: Pose): { x: number; y: number } {
  const p = clampPose(pose);
  return { x: layout.cx + layout.travel * p.x, y: layout.cy + layout.travel * p.y };
}

/** Twist angle in radians, clockwise from 12 o'clock as seen on screen. */
export function twistAngle(z: number): number {
  return (clamp(z, 0, 1) - 0.5) * TWIST_SPAN;
}

export type Vec3 = readonly [number, number, number];
/** Quaternion as [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];

function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Front-hemisphere point that the marker (model +Z pole) is rotated onto. */
export function markerDirection(pose: Pose): Vec3 {
  const p = clampPose(pose);
  const k = TRAVEL_RATIO;
  const r2 = Math.min(1, p.x * p.x + p.y * p.y);
  return [k * p.x, -k * p.y, Math.sqrt(Math.max(0, 1 - k * k * r2))];
}

/**
 * Ball orientation for a pose: the shortest rotation taking +Z onto the marker
 * direction, followed by the twist about that direction (clockwise on screen
 * as z increases).
 */
export function poseOrientation(pose: Pose): Quat {
  const [tx, ty, tz] = markerDirection(pose);
  // Shortest arc from (0, 0, 1) to t: axis (0,0,1) x t = (-ty, tx, 0), w = 1 + t.z (> 0 here).
  const ax = -ty;
  const ay = tx;
  const aw = 1 + tz;
  const n = Math.hypot(ax, ay, aw);
  const align: Quat = [ax / n, ay / n, 0, aw / n];
  const half = -twistAngle(pose.z) / 2; // negative: clockwise when viewed from +Z
  const s = Math.sin(half);
  const twist: Quat = [tx * s, ty * s, tz * s, Math.cos(half)];
  return multiply(twist, align);
}

/** Rotate v by the unit quaternion q. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 * (q.xyz x v); v' = v + w * t + q.xyz x t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

function spherePoint(polar: number, azimuth: number, radius: number): Vec3 {
  const s = Math.sin(polar);
  return [radius * s * Math.cos(azimuth), radius * s * Math.sin(azimuth), radius * Math.cos(polar)];
}

let cachedGrid: readonly (readonly Vec3[])[] | null = null;

/**
 * Engraved grid in model space, centred on the marker pole: meridians every
 * 30 degrees and three latitude circles. Rotates with the ball, so the twist
 * and the travel are both visible.
 */
export function gridLines(): readonly (readonly Vec3[])[] {
  if (cachedGrid) return cachedGrid;
  const lines: Vec3[][] = [];
  const r = 1.003;
  for (let m = 0; m < 12; m += 1) {
    const azimuth = (m * Math.PI) / 6;
    const line: Vec3[] = [];
    for (let i = 0; i <= 48; i += 1) line.push(spherePoint(0.16 + (i / 48) * (Math.PI - 0.16), azimuth, r));
    lines.push(line);
  }
  for (const polar of [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
    const line: Vec3[] = [];
    for (let i = 0; i <= 96; i += 1) line.push(spherePoint(polar, (i / 96) * Math.PI * 2, r));
    lines.push(line);
  }
  cachedGrid = lines;
  return lines;
}

/** Twist index: a short engraved arc from the marker towards model +Y (12 o'clock at z = 0.5). */
export function twistIndexLine(): readonly Vec3[] {
  const line: Vec3[] = [];
  for (let i = 0; i <= 16; i += 1) line.push(spherePoint(0.1 + (i / 16) * 0.34, Math.PI / 2, 1.004));
  return line;
}
