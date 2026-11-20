import { clampPose, equalPose, NEUTRAL_POSE } from '@lowquo/surface';
import type { Pose } from '@lowquo/surface';
import { computeLayout } from './geometry.js';
import type { Layout } from './geometry.js';
import { applyDrag, applyKey, applyWheel, formatPose, GestureTracker } from './interaction.js';
import { CanvasSurfaceRenderer } from './renderer-2d.js';
import { WebGLSurfaceRenderer } from './renderer-webgl.js';
import { createCanvas } from './renderer.js';
import type { SurfaceRenderer } from './renderer.js';

export type TrackballOptions = {
  /** Initial pose. Default NEUTRAL_POSE. */
  value?: Pose;
  /** Called for every user-originated change, and for setPose(value, true). */
  onChange?: (pose: Pose) => void;
  /** A user gesture opened: write host gestures (beginChangeGesture) from here. */
  onGestureStart?: () => void;
  /** The gesture closed. Always paired with exactly one onGestureStart. */
  onGestureEnd?: () => void;
  /**
   * Mouse wheel / trackpad scroll adjusts z and prevents page scrolling over
   * the control. Default true; pass false on scrolling web pages.
   */
  wheel?: boolean;
  /** Accessible name. Default "Surface position". */
  label?: string;
  /** Instructions exposed via aria-describedby. Default: English keyboard help. */
  description?: string;
  /** Value text for assistive technology. Default formatPose ("X 0.000, Y 0.000, Z 0.500"). */
  formatValue?: (pose: Pose) => string;
};

const DEFAULT_LABEL = 'Surface position';
const DEFAULT_DESCRIPTION = 'Arrow keys move the position. Page Up and Page Down, or Alt with Up and Down, '
  + 'change twist; the mouse wheel also changes twist. Hold Shift, Control or Command for fine steps. '
  + 'Home or 0 resets to the centre. Escape cancels a drag.';
/** Value text is refreshed, and user changes announced, this long after the last change. */
const TEXT_DELAY_MS = 350;
const MAX_PIXEL_RATIO = 2;
const VISUALLY_HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;'
  + 'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';

let instanceCount = 0;

type Drag = { id: number; x: number; y: number; start: Pose };

function hasForcedColors(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(forced-colors: active)').matches; }
  catch { return false; }
}

/**
 * Three-axis trackball. Renders on demand only (one frame per state change,
 * never while idle), with a 2D canvas fallback when WebGL is unavailable or lost.
 */
export class Trackball {
  private pose: Pose;
  private readonly options: TrackballOptions;
  private readonly surface: HTMLDivElement;
  private readonly assistive: HTMLDivElement;
  private readonly valueText: HTMLSpanElement;
  private readonly liveRegion: HTMLDivElement;
  private readonly gestures: GestureTracker;
  private readonly cleanup: (() => void)[] = [];
  private renderer: SurfaceRenderer | null = null;
  private webgl: WebGLSurfaceRenderer | null = null;
  private fallback: CanvasSurfaceRenderer | null = null;
  private layout: Layout | null = null;
  private pixelRatio = 0;
  private drag: Drag | null = null;
  private raf = 0;
  private textTimer: ReturnType<typeof setTimeout> | undefined;
  private announcePending = false;
  private pixelRatioQuery: MediaQueryList | null = null;
  private focusVisible = false;
  private pointerFocusing = false;
  private disposed = false;

  constructor(root: HTMLElement, options: TrackballOptions = {}) {
    this.options = options;
    this.pose = clampPose(options.value ?? NEUTRAL_POSE);
    this.gestures = new GestureTracker({
      onStart: () => this.options.onGestureStart?.(),
      onEnd: () => this.options.onGestureEnd?.(),
    });
    const id = `lq-trackball-${(instanceCount += 1)}`;

    // The focusable, interactive surface. The root's own styles are never touched.
    const surface = document.createElement('div');
    surface.className = 'lq-trackball';
    surface.tabIndex = 0;
    surface.setAttribute('role', 'application');
    surface.setAttribute('aria-roledescription', 'trackball');
    surface.setAttribute('aria-label', options.label ?? DEFAULT_LABEL);
    surface.setAttribute('aria-describedby', `${id}-value ${id}-help`);
    surface.style.cssText = 'position:relative;width:100%;height:100%;min-height:260px;overflow:hidden;'
      + 'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;cursor:grab;';
    // The focus ring is drawn by the renderer; keep the UA outline for forced-colours modes.
    if (!hasForcedColors()) surface.style.outline = 'none';
    this.surface = surface;

    this.assistive = document.createElement('div');
    this.assistive.style.cssText = VISUALLY_HIDDEN;
    this.valueText = document.createElement('span');
    this.valueText.id = `${id}-value`;
    this.valueText.textContent = this.describe();
    const help = document.createElement('span');
    help.id = `${id}-help`;
    help.textContent = options.description ?? DEFAULT_DESCRIPTION;
    this.liveRegion = document.createElement('div');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');
    this.assistive.append(this.valueText, help, this.liveRegion);
    root.append(surface, this.assistive);

    const canvas = createCanvas();
    surface.appendChild(canvas);
    try {
      this.webgl = new WebGLSurfaceRenderer(canvas);
    } catch (error) {
      // The failed attempt may have claimed the canvas; the fallback uses a fresh one.
      canvas.remove();
      console.warn('lq-surface: WebGL unavailable; using the 2D canvas renderer.', error);
    }
    if (this.webgl) {
      this.listen(canvas, 'webglcontextlost', this.onContextLost);
      this.listen(canvas, 'webglcontextrestored', this.onContextRestored);
    }

    this.listen(surface, 'pointerdown', this.onPointerDown);
    this.listen(surface, 'pointermove', this.onPointerMove);
    this.listen(surface, 'pointerup', this.onPointerUp);
    this.listen(surface, 'pointercancel', this.onPointerCancel);
    this.listen(surface, 'lostpointercapture', this.onLostPointerCapture);
    this.listen(surface, 'keydown', this.onKeyDown);
    this.listen(surface, 'dblclick', this.onDoubleClick);
    this.listen(surface, 'contextmenu', this.onContextMenu);
    this.listen(surface, 'focus', this.onFocus);
    this.listen(surface, 'blur', this.onBlur);
    if (options.wheel !== false) this.listen(surface, 'wheel', this.onWheel, { passive: false });
    this.listen(window, 'blur', this.onWindowBlur);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.resize());
      observer.observe(surface);
      this.cleanup.push(() => observer.disconnect());
    } else {
      this.listen(window, 'resize', () => this.resize());
    }
    this.watchPixelRatio();
    this.setRenderer(this.webgl ?? this.createFallback());
  }

  getPose(): Pose { return { ...this.pose }; }

  /**
   * Set the pose. Host automation should call this with notify = false (the
   * default): onChange is not called, so nothing is echoed back to the host.
   */
  setPose(value: Pose, notify = false): void {
    if (this.disposed) return;
    const next = clampPose(value);
    if (equalPose(this.pose, next)) return;
    this.pose = next;
    this.scheduleText(false);
    this.invalidate();
    if (notify) this.options.onChange?.(this.getPose());
  }

  /**
   * True between onGestureStart and onGestureEnd (pointer drag, or a coalesced
   * keyboard/wheel gesture). Apps should defer host updates while this is true.
   */
  isInteracting(): boolean { return this.gestures.active; }

  /** Remove the control and release every resource. Idempotent; ends an open gesture first. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.releaseDrag();
      this.gestures.end();
    } finally {
      if (this.textTimer !== undefined) clearTimeout(this.textTimer);
      this.textTimer = undefined;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.unwatchPixelRatio();
      for (const off of this.cleanup.splice(0)) off();
      this.fallback?.dispose();
      this.fallback = null;
      this.webgl?.dispose();
      this.webgl = null;
      this.renderer = null;
      this.surface.remove();
      this.assistive.remove();
    }
  }

  // ---- state ---------------------------------------------------------------

  /** Apply a user-originated pose inside the current gesture. */
  private commit(value: Pose): void {
    const next = clampPose(value);
    if (equalPose(this.pose, next)) return;
    this.pose = next;
    this.scheduleText(true);
    this.invalidate();
    this.options.onChange?.(this.getPose());
  }

  /** Keys, wheel and double-click: one coalesced gesture per burst of input. */
  private discrete(value: Pose): void {
    if (this.drag || equalPose(this.pose, clampPose(value))) return;
    this.gestures.touch();
    this.commit(value);
  }

  private describe(): string {
    return (this.options.formatValue ?? formatPose)(this.pose);
  }

  private scheduleText(announce: boolean): void {
    this.announcePending ||= announce;
    if (this.textTimer !== undefined) clearTimeout(this.textTimer);
    this.textTimer = setTimeout(this.flushText, TEXT_DELAY_MS);
  }

  private flushText = (): void => {
    this.textTimer = undefined;
    if (this.disposed) return;
    const text = this.describe();
    this.valueText.textContent = text;
    if (this.announcePending) this.liveRegion.textContent = text;
    this.announcePending = false;
  };

  // ---- rendering -------------------------------------------------------------

  private setRenderer(renderer: SurfaceRenderer | null): void {
    this.renderer = renderer;
    this.surface.dataset.renderer = renderer?.kind ?? 'none';
    this.layout = null; // force a size update on the new renderer
    this.resize();
  }

  private createFallback(): CanvasSurfaceRenderer | null {
    if (!this.fallback) {
      const canvas = createCanvas();
      this.surface.appendChild(canvas);
      this.fallback = CanvasSurfaceRenderer.create(canvas);
      if (!this.fallback) {
        canvas.remove();
        console.warn('lq-surface: no canvas renderer available; the control remains keyboard and pointer operable.');
      }
    }
    return this.fallback;
  }

  /** Schedule exactly one frame. Nothing runs while the state is unchanged. */
  private invalidate(): void {
    if (this.disposed || this.raf || !this.renderer) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!this.disposed && this.renderer && this.layout) this.renderer.render(this.pose, this.focusVisible);
  }

  private resize(): void {
    if (this.disposed || !this.renderer) return;
    const width = Math.max(1, this.surface.clientWidth);
    const height = Math.max(1, this.surface.clientHeight);
    const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 0.5), MAX_PIXEL_RATIO);
    if (this.layout && this.layout.width === width && this.layout.height === height && this.pixelRatio === pixelRatio) return;
    this.layout = computeLayout(width, height);
    this.pixelRatio = pixelRatio;
    this.renderer.setSize(this.layout, pixelRatio);
    // Resizing clears the canvas: redraw before the next paint to avoid a blank frame.
    this.renderNow();
  }

  /** ResizeObserver does not fire on devicePixelRatio changes; a resolution query does. */
  private watchPixelRatio(): void {
    this.unwatchPixelRatio();
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    if (typeof query.addEventListener === 'function') query.addEventListener('change', this.onPixelRatioChange);
    else query.addListener?.(this.onPixelRatioChange);
    this.pixelRatioQuery = query;
  }

  private unwatchPixelRatio(): void {
    const query = this.pixelRatioQuery;
    if (!query) return;
    if (typeof query.removeEventListener === 'function') query.removeEventListener('change', this.onPixelRatioChange);
    else query.removeListener?.(this.onPixelRatioChange);
    this.pixelRatioQuery = null;
  }

  private onPixelRatioChange = (): void => {
    if (this.disposed) return;
    this.watchPixelRatio(); // re-arm for the new ratio
    this.resize();
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault(); // allow the browser to restore the context
    if (this.disposed || !this.webgl) return;
    this.webgl.canvas.style.visibility = 'hidden';
    this.setRenderer(this.createFallback());
  };

  private onContextRestored = (): void => {
    if (this.disposed || !this.webgl) return;
    this.fallback?.dispose();
    this.fallback = null;
    this.webgl.canvas.style.visibility = '';
    this.setRenderer(this.webgl);
  };

  private setFocusVisible(visible: boolean): void {
    if (this.focusVisible === visible) return;
    this.focusVisible = visible;
    this.invalidate();
  }

  // ---- input -----------------------------------------------------------------

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag) return;
    event.preventDefault();
    this.pointerFocusing = true;
    this.surface.focus({ preventScroll: true });
    this.pointerFocusing = false;
    this.setFocusVisible(false);
    try { this.surface.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: this.pose };
    this.surface.style.cursor = 'grabbing';
    this.gestures.beginContinuous(); // closes an open keyboard/wheel gesture first
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (dx === 0 && dy === 0) return;
    const pixelsPerUnit = (this.layout ?? computeLayout(this.surface.clientWidth, this.surface.clientHeight)).travel;
    this.commit(applyDrag(this.pose, {
      dx, dy, pixelsPerUnit,
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey,
    }));
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.drag?.id === event.pointerId) this.finishDrag();
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (this.drag?.id === event.pointerId) this.finishDrag();
  };

  private onLostPointerCapture = (event: PointerEvent): void => {
    if (this.drag?.id === event.pointerId) this.finishDrag();
  };

  /** Drop pointer state without touching the gesture. */
  private releaseDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.surface.style.cursor = 'grab';
    try {
      if (this.surface.hasPointerCapture(drag.id)) this.surface.releasePointerCapture(drag.id);
    } catch { /* already released */ }
  }

  private finishDrag(): void {
    this.releaseDrag();
    this.gestures.endContinuous();
  }

  /** Escape: restore the pre-drag pose (sent to the host inside the gesture), then end it. */
  private cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.commit(drag.start);
    this.finishDrag();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (this.drag) {
        event.preventDefault();
        this.cancelDrag();
      }
      return;
    }
    const next = applyKey(this.pose, event.key, event);
    if (!next) return;
    event.preventDefault();
    this.setFocusVisible(true);
    this.discrete(next); // ignored while a drag owns the value
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.discrete(applyWheel(this.pose, event));
  };

  private onDoubleClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    this.discrete(NEUTRAL_POSE);
  };

  private onContextMenu = (event: Event): void => {
    // macOS turns Ctrl+click into a context menu; Ctrl is a fine-adjust modifier mid-drag.
    if (this.drag) event.preventDefault();
  };

  private onFocus = (): void => {
    if (this.pointerFocusing) return;
    let visible = true;
    try { visible = this.surface.matches(':focus-visible'); } catch { /* selector unsupported */ }
    this.setFocusVisible(visible);
  };

  private onBlur = (): void => {
    this.setFocusVisible(false);
    if (this.gestures.kind === 'discrete') this.gestures.end();
  };

  private onWindowBlur = (): void => {
    this.releaseDrag();
    this.gestures.end();
  };

  private listen<E extends Event>(
    target: EventTarget, type: string, handler: (event: E) => void, options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.cleanup.push(() => target.removeEventListener(type, listener, options));
  }
}
