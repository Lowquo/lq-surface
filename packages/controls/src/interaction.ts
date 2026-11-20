/**
 * Pure interaction maths for the trackball: input deltas to poses, precision
 * scaling and gesture bookkeeping. No DOM, renderer or timer globals are
 * required, so every rule here is unit-testable in Node.
 */
import { clamp, clampPose, NEUTRAL_POSE } from '@lowquo/surface';
import type { Pose } from '@lowquo/surface';

/** Fine adjustment (Shift, Ctrl or Cmd held) divides every step by this ratio. */
export const FINE_RATIO = 10;
/** Arrow-key step on x/y in pose units: 1 % of the host parameter range. */
export const KEY_STEP_XY = 0.02;
/** Page Up/Down (or Alt + Up/Down) step on z: 1 % of its range. */
export const KEY_STEP_Z = 0.01;
/** Wheel: z change per pixel of wheel delta. A 100 px mouse-wheel notch moves z by 0.025. */
export const WHEEL_Z_PER_PIXEL = 0.00025;
/** Pixels assumed per wheel "line" (Firefox reports lines) and per "page". */
export const WHEEL_LINE_PIXELS = 33;
export const WHEEL_PAGE_PIXELS = 400;
/** Largest z change a single coarse wheel event may cause. */
export const WHEEL_MAX_STEP = 0.1;
/**
 * Vertical drag with Alt moves z by this fraction of the x/y rate, so that one
 * pixel changes every host parameter by the same normalised amount (x/y span 2, z spans 1).
 */
export const Z_DRAG_RATIO = 0.5;
/** Discrete input (keys, wheel, double-click) closes its coalesced gesture after this idle time. */
export const GESTURE_IDLE_MS = 400;

export type Modifiers = Readonly<{
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}>;

/** Shift, Ctrl and Cmd (Meta) all select fine adjustment. Alt selects the z axis instead. */
export function isFineAdjust(modifiers: Modifiers): boolean {
  return Boolean(modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey);
}

function precision(modifiers: Modifiers): number {
  return isFineAdjust(modifiers) ? 1 / FINE_RATIO : 1;
}

export type DragInput = Modifiers & Readonly<{
  /** Pointer movement in CSS pixels since the previous event; +y is down. */
  dx: number;
  dy: number;
  /** CSS pixels per pose unit at coarse speed (the trackball passes its marker travel radius). */
  pixelsPerUnit: number;
}>;

/**
 * Relative drag. Coarse speed moves the marker 1:1 with the pointer; fine speed
 * is FINE_RATIO times slower. With Alt, vertical movement changes z (up increases).
 */
export function applyDrag(pose: Pose, input: DragInput): Pose {
  const dx = Number.isFinite(input.dx) ? input.dx : 0;
  const dy = Number.isFinite(input.dy) ? input.dy : 0;
  const pixels = Number.isFinite(input.pixelsPerUnit) && input.pixelsPerUnit > 0 ? input.pixelsPerUnit : 100;
  const scale = precision(input) / pixels;
  if (input.altKey) return clampPose({ ...pose, z: pose.z - dy * scale * Z_DRAG_RATIO });
  return clampPose({ x: pose.x + dx * scale, y: pose.y + dy * scale, z: pose.z });
}

/**
 * Keyboard mapping. Returns null for keys the trackball does not handle, so the
 * caller can leave the browser default alone (Tab, Escape, shortcuts...).
 */
export function applyKey(pose: Pose, key: string, modifiers: Modifiers = {}): Pose | null {
  const fine = precision(modifiers);
  const xy = KEY_STEP_XY * fine;
  const z = KEY_STEP_Z * fine;
  switch (key) {
    case 'ArrowLeft': return clampPose({ ...pose, x: pose.x - xy });
    case 'ArrowRight': return clampPose({ ...pose, x: pose.x + xy });
    case 'ArrowUp': return clampPose(modifiers.altKey ? { ...pose, z: pose.z + z } : { ...pose, y: pose.y - xy });
    case 'ArrowDown': return clampPose(modifiers.altKey ? { ...pose, z: pose.z - z } : { ...pose, y: pose.y + xy });
    case 'PageUp': return clampPose({ ...pose, z: pose.z + z });
    case 'PageDown': return clampPose({ ...pose, z: pose.z - z });
    case 'Home': return NEUTRAL_POSE;
    // Leave Ctrl/Cmd+0 (browser zoom reset) and Alt+0 to the browser.
    case '0': return modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey ? null : NEUTRAL_POSE;
    default: return null;
  }
}

export type WheelInput = Modifiers & Readonly<{
  deltaY: number;
  deltaX?: number;
  /** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
  deltaMode?: number;
}>;

/** Wheel changes z: scrolling up (negative deltaY) increases it. */
export function applyWheel(pose: Pose, input: WheelInput): Pose {
  let delta = Number.isFinite(input.deltaY) ? input.deltaY : 0;
  // Browsers turn Shift+wheel into horizontal scrolling; keep Shift usable for fine steps.
  if (delta === 0 && input.shiftKey && Number.isFinite(input.deltaX)) delta = input.deltaX ?? 0;
  if (delta === 0) return pose;
  const unit = input.deltaMode === 1 ? WHEEL_LINE_PIXELS : input.deltaMode === 2 ? WHEEL_PAGE_PIXELS : 1;
  const coarse = clamp(-delta * unit * WHEEL_Z_PER_PIXEL, -WHEEL_MAX_STEP, WHEEL_MAX_STEP);
  return clampPose({ ...pose, z: pose.z + coarse * precision(input) });
}

/** Default accessible value text, e.g. "X 0.250, Y -0.400, Z 0.500". */
export function formatPose(pose: Pose): string {
  const p = clampPose(pose);
  const f = (v: number): string => (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3);
  return `X ${f(p.x)}, Y ${f(p.y)}, Z ${f(p.z)}`;
}

/** Minimal timer interface so the idle timeout can be driven by a fake clock in tests. */
export interface TimerApi {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: TimerApi = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export type GestureKind = 'continuous' | 'discrete';

export type GestureTrackerOptions = {
  /** Called exactly once when a gesture opens. */
  onStart?: () => void;
  /** Called exactly once when that gesture closes. */
  onEnd?: () => void;
  /** Idle time before a discrete gesture closes. Default GESTURE_IDLE_MS. */
  idleMs?: number;
  timers?: TimerApi;
};

/**
 * Keeps host gestures balanced and coalesced. At most one gesture is open:
 * - continuous (pointer drag): begin on down, end on up/cancel;
 * - discrete (keys, wheel, double-click): opened by the first input, kept open
 *   by later inputs, closed after `idleMs` without input.
 * Starting a continuous gesture closes an open discrete one first, so onStart is
 * never called twice without an onEnd in between. State changes before the
 * callbacks run, so callbacks may safely re-enter.
 */
export class GestureTracker {
  private state: GestureKind | null = null;
  private timer: unknown = null;
  private readonly idleMs: number;
  private readonly timers: TimerApi;

  constructor(private readonly options: GestureTrackerOptions = {}) {
    this.idleMs = Math.max(0, options.idleMs ?? GESTURE_IDLE_MS);
    this.timers = options.timers ?? defaultTimers;
  }

  /** The open gesture, if any. */
  get kind(): GestureKind | null { return this.state; }
  get active(): boolean { return this.state !== null; }

  /** Open a continuous gesture (idempotent). Ends a discrete gesture first. */
  beginContinuous(): void {
    if (this.state === 'continuous') return;
    if (this.state === 'discrete') this.end();
    this.state = 'continuous';
    this.options.onStart?.();
  }

  /** Close the continuous gesture if one is open. */
  endContinuous(): void {
    if (this.state === 'continuous') this.end();
  }

  /**
   * Record a discrete input. Opens a discrete gesture if none is open and
   * restarts its idle timer. During a continuous gesture this does nothing:
   * the input belongs to the open gesture.
   */
  touch(): void {
    if (this.state === 'continuous') return;
    const opening = this.state === null;
    this.state = 'discrete';
    this.arm();
    if (opening) this.options.onStart?.();
  }

  /** Close whatever is open now (blur, dispose). Idempotent. */
  end(): void {
    if (this.state === null) return;
    this.disarm();
    this.state = null;
    this.options.onEnd?.();
  }

  private arm(): void {
    this.disarm();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (this.state === 'discrete') this.end();
    }, this.idleMs);
  }

  private disarm(): void {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
