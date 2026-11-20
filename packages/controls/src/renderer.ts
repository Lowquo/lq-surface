import type { Pose } from '@lowquo/surface';
import type { Layout } from './geometry.js';

/** Internal drawing back end. Rendering happens only when the Trackball asks. */
export interface SurfaceRenderer {
  readonly kind: 'webgl' | '2d';
  readonly canvas: HTMLCanvasElement;
  /** Resize the backing store to layout size x pixelRatio. Clears the canvas. */
  setSize(layout: Layout, pixelRatio: number): void;
  /** Draw one frame. */
  render(pose: Pose, focusVisible: boolean): void;
  /** Release every resource. Idempotent. */
  dispose(): void;
}

export function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  return canvas;
}

export function cssColor(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
