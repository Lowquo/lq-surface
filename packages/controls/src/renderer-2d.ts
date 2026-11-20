import type { Pose } from '@lowquo/surface';
import {
  FOCUS_RING_RATIO, MARKER_RATIO, PALETTE, TRAVEL_RATIO, Z_RING_RATIO,
  gridLines, markerPoint, poseOrientation, rotate, twistAngle, twistIndexLine,
} from './geometry.js';
import type { Layout, Vec3 } from './geometry.js';
import { cssColor } from './renderer.js';
import type { SurfaceRenderer } from './renderer.js';

/** Canvas angle (clockwise from +x) for a screen angle measured clockwise from 12 o'clock. */
const fromTop = (angle: number): number => angle - Math.PI / 2;

/**
 * 2D canvas renderer: used when WebGL is unavailable or its context is lost.
 * Draws the same geometry as the WebGL renderer (flat shaded).
 */
export class CanvasSurfaceRenderer implements SurfaceRenderer {
  readonly kind = '2d' as const;
  private layout: Layout | null = null;

  private constructor(readonly canvas: HTMLCanvasElement, private readonly ctx: CanvasRenderingContext2D) {}

  /** Returns null if the canvas cannot provide a 2D context. */
  static create(canvas: HTMLCanvasElement): CanvasSurfaceRenderer | null {
    const ctx = canvas.getContext('2d');
    return ctx ? new CanvasSurfaceRenderer(canvas, ctx) : null;
  }

  setSize(layout: Layout, pixelRatio: number): void {
    this.layout = layout;
    this.canvas.width = Math.max(1, Math.floor(layout.width * pixelRatio));
    this.canvas.height = Math.max(1, Math.floor(layout.height * pixelRatio));
  }

  render(pose: Pose, focusVisible: boolean): void {
    const { ctx, canvas, layout } = this;
    if (!layout) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / layout.width, 0, 0, canvas.height / layout.height, 0, 0);
    const { cx, cy, ball } = layout;
    const x = (v: Vec3): number => cx + ball * v[0];
    const y = (v: Vec3): number => cy - ball * v[1];

    // Ball body, lit from the upper left like the WebGL scene.
    const body = ctx.createRadialGradient(cx - 0.32 * ball, cy - 0.42 * ball, ball * 0.04, cx, cy, ball);
    body.addColorStop(0, '#666d88');
    body.addColorStop(0.62, cssColor(PALETTE.body));
    body.addColorStop(1, '#191b27');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, ball, 0, Math.PI * 2);
    ctx.fill();

    // Engraved grid and twist index on the visible (front) hemisphere.
    const q = poseOrientation(pose);
    const polyline = (points: readonly Vec3[]): void => {
      let prev: Vec3 | null = null;
      for (const point of points) {
        const r = rotate(q, point);
        if (prev && prev[2] >= 0 && r[2] >= 0) {
          ctx.moveTo(x(prev), y(prev));
          ctx.lineTo(x(r), y(r));
        }
        prev = r;
      }
    };
    ctx.lineCap = 'butt';
    ctx.strokeStyle = cssColor(PALETTE.grid, 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const line of gridLines()) polyline(line);
    ctx.stroke();
    ctx.strokeStyle = cssColor(PALETTE.index);
    ctx.lineWidth = Math.max(1.5, 0.017 * ball); // matches the WebGL index tube
    ctx.beginPath();
    polyline(twistIndexLine());
    ctx.stroke();

    // Fixed travel boundary (pose radius 1) with axis ticks.
    const travel = TRAVEL_RATIO * ball;
    ctx.strokeStyle = cssColor(PALETTE.boundary, 0.7);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(cx, cy, travel, 0, Math.PI * 2);
    for (let i = 0; i < 4; i += 1) {
      const a = (i * Math.PI) / 2;
      ctx.moveTo(cx + Math.sin(a) * (travel - 0.045 * ball), cy - Math.cos(a) * (travel - 0.045 * ball));
      ctx.lineTo(cx + Math.sin(a) * (travel + 0.045 * ball), cy - Math.cos(a) * (travel + 0.045 * ball));
    }
    ctx.stroke();

    // Marker: its centre is exactly the pose position.
    const marker = markerPoint(layout, pose);
    ctx.fillStyle = cssColor(PALETTE.value);
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, MARKER_RATIO * ball, 0, Math.PI * 2);
    ctx.fill();

    // z scale: 270 degree track, bipolar value arc from 12 o'clock, pointer, neutral notch.
    const ring = Z_RING_RATIO * ball;
    const angle = twistAngle(pose.z);
    ctx.lineWidth = 3;
    ctx.strokeStyle = cssColor(PALETTE.track);
    ctx.beginPath();
    ctx.arc(cx, cy, ring, fromTop(-0.75 * Math.PI), fromTop(0.75 * Math.PI));
    ctx.stroke();
    if (Math.abs(angle) > 1e-6) {
      ctx.strokeStyle = cssColor(PALETTE.value);
      ctx.beginPath();
      ctx.arc(cx, cy, ring, fromTop(0), fromTop(angle), angle < 0);
      ctx.stroke();
    }
    const tick = (a: number, r0: number, r1: number): void => {
      ctx.moveTo(cx + Math.sin(a) * r0 * ball, cy - Math.cos(a) * r0 * ball);
      ctx.lineTo(cx + Math.sin(a) * r1 * ball, cy - Math.cos(a) * r1 * ball);
    };
    ctx.strokeStyle = cssColor(PALETTE.boundary, 0.7);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    tick(0, Z_RING_RATIO + 0.04, Z_RING_RATIO + 0.075);
    ctx.stroke();
    ctx.strokeStyle = cssColor(PALETTE.value);
    ctx.lineWidth = 2;
    ctx.beginPath();
    tick(angle, Z_RING_RATIO - 0.05, Z_RING_RATIO + 0.05);
    ctx.stroke();

    if (focusVisible) {
      ctx.strokeStyle = cssColor(PALETTE.focus);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, FOCUS_RING_RATIO * ball, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  dispose(): void {
    this.layout = null;
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.canvas.remove();
  }
}
