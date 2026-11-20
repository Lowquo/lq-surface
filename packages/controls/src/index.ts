import * as THREE from 'three';
import { clampPose, equalPose, NEUTRAL_POSE } from '@lowquo/surface';
import type { Pose } from '@lowquo/surface';

export type TrackballOptions = {
  value?: Pose;
  onChange?: (pose: Pose) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
};

/** An interaction-driven Three.js control. No render loop when idle. */
export class Trackball {
  private pose: Pose;
  private readonly root: HTMLElement;
  private readonly layer: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private sphere: THREE.Group | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private raf = 0;
  private pointer: { id: number; x: number; y: number } | null = null;
  private disposed = false;
  private readonly options: TrackballOptions;

  constructor(root: HTMLElement, options: TrackballOptions = {}) {
    this.root = root;
    this.options = options;
    this.pose = clampPose(options.value ?? NEUTRAL_POSE);
    this.root.style.position = 'relative';
    this.root.style.minHeight = '260px';
    this.layer = document.createElement('div');
    this.layer.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;';
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', '3D trackball. Arrow keys adjust position; Alt plus up and down changes character; 0 resets.');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline-offset:4px;cursor:grab;';
    this.layer.appendChild(this.canvas);
    this.root.appendChild(this.layer);
    try { this.setup3d(); }
    catch (error) { this.setupFallback(); console.warn('lq-surface: WebGL unavailable; showing 2D control', error); }
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onLostCapture);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('keydown', this.onKeyDown);
    this.canvas.addEventListener('dblclick', this.onReset);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(root);
    }
    this.resize();
  }

  getPose(): Pose { return { ...this.pose }; }

  /** Host automation can call this method without echoing another host write. */
  setPose(value: Pose, notify = false): void {
    const next = clampPose(value);
    if (equalPose(this.pose, next)) return;
    this.pose = next;
    this.update3d();
    if (notify) this.options.onChange?.(this.getPose());
  }

  private setup3d(): void {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(37, 1, .1, 100);
    this.camera.position.z = 6.6;
    const ball = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.48, 64, 40), new THREE.MeshStandardMaterial({
      color: 0x3a3d50, roughness: .37, metalness: .5,
    }));
    ball.add(body);
    const meridians = new THREE.Mesh(new THREE.SphereGeometry(1.487, 16, 12), new THREE.MeshBasicMaterial({
      color: 0xb9b3d6, wireframe: true, transparent: true, opacity: .075, depthWrite: false,
    }));
    ball.add(meridians);
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.10, 24, 16), new THREE.MeshBasicMaterial({ color: 0xeac9ad }));
    marker.position.set(.31, .33, 1.42);
    ball.add(marker);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.67, .016, 9, 160), new THREE.MeshBasicMaterial({ color: 0x918bad }));
    scene.add(ring, ball);
    scene.add(new THREE.AmbientLight(0xd8d7fa, 1.8));
    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(-2, 3, 5);
    scene.add(light);
    const rim = new THREE.DirectionalLight(0xb5a0e0, 1.1);
    rim.position.set(3, -2, -1);
    scene.add(rim);
    this.sphere = ball;
    this.update3d();
  }

  private setupFallback(): void {
    this.canvas.style.background = 'radial-gradient(circle at 36% 25%, #777e99, #292c3e 70%, #141622)';
    this.canvas.style.borderRadius = '50%';
    this.canvas.style.width = 'min(84%, 300px)';
    this.canvas.style.height = 'auto';
    this.canvas.style.aspectRatio = '1';
    this.canvas.style.boxShadow = 'inset 0 0 30px #10131d, 0 0 0 2px #746e86';
  }

  private update3d(): void {
    if (this.sphere) this.sphere.rotation.set(-this.pose.y * .85, this.pose.x * .85, (this.pose.z - .5) * Math.PI * 1.5);
    this.invalidate();
  }

  private invalidate(): void {
    if (this.disposed || this.raf || !this.renderer || !this.scene || !this.camera) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.disposed && this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    });
  }

  private resize(): void {
    if (!this.renderer || !this.camera || this.disposed) return;
    const width = Math.max(1, this.root.clientWidth);
    const height = Math.max(1, this.root.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.pointer) return;
    event.preventDefault();
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.canvas.focus();
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.style.cursor = 'grabbing';
    this.options.onGestureStart?.();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    event.preventDefault();
    const dX = event.clientX - this.pointer.x;
    const dY = event.clientY - this.pointer.y;
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    const scale = (event.shiftKey ? .0015 : .0055) * (320 / Math.max(180, this.root.clientWidth));
    if (event.altKey) this.setPose({ ...this.pose, z: this.pose.z - dY * scale }, true);
    else this.setPose({ ...this.pose, x: this.pose.x + dX * scale, y: this.pose.y + dY * scale }, true);
  };

  private finishGesture(): void {
    if (!this.pointer) return;
    this.pointer = null;
    this.canvas.style.cursor = 'grab';
    this.options.onGestureEnd?.();
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.finishGesture();
  };
  private onLostCapture = (): void => this.finishGesture();

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.pointer) return;
    const factor = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 12 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 100 : 1;
    const step = Math.max(-.08, Math.min(.08, event.deltaY * factor * -.0007));
    this.options.onGestureStart?.();
    this.setPose({ ...this.pose, z: this.pose.z + step }, true);
    this.options.onGestureEnd?.();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '0', 'Home'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? .005 : .025;
    let next = this.pose;
    switch (event.key) {
      case 'ArrowLeft': next = { ...next, x: next.x - step }; break;
      case 'ArrowRight': next = { ...next, x: next.x + step }; break;
      case 'ArrowUp': next = event.altKey ? { ...next, z: next.z + step } : { ...next, y: next.y - step }; break;
      case 'ArrowDown': next = event.altKey ? { ...next, z: next.z - step } : { ...next, y: next.y + step }; break;
      case '0': case 'Home': next = NEUTRAL_POSE; break;
    }
    this.options.onGestureStart?.();
    this.setPose(next, true);
    this.options.onGestureEnd?.();
  };
  private onReset = (): void => {
    this.options.onGestureStart?.();
    this.setPose(NEUTRAL_POSE, true);
    this.options.onGestureEnd?.();
  };

  dispose(): void {
    if (this.disposed) return;
    this.finishGesture();
    this.disposed = true;
    this.resizeObserver?.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('lostpointercapture', this.onLostCapture);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('dblclick', this.onReset);
    if (this.scene) this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) material.dispose();
      }
    });
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.layer.remove();
  }
}
