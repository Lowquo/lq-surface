import * as THREE from 'three';
import type { Pose } from '@lowquo/surface';
import {
  FOCUS_RING_RATIO, MARKER_RATIO, PALETTE, TRAVEL_RATIO, Z_RING_RATIO,
  gridLines, poseOrientation, twistAngle, twistIndexLine,
} from './geometry.js';
import type { Layout } from './geometry.js';
import type { SurfaceRenderer } from './renderer.js';

const OVERLAY_ORDER = 10;
const MARKER_ORDER = 20;

/** Flat, screen-aligned material for the fixed scales drawn in front of the ball. */
function overlayMaterial(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, opacity, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
}

function dynamicMesh(vertices: number, index: number[], material: THREE.Material): [THREE.Mesh, THREE.BufferAttribute] {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = OVERLAY_ORDER;
  return [mesh, position];
}

/** A flat arc band. Angles are screen angles, clockwise from 12 o'clock. */
class Arc {
  readonly mesh: THREE.Mesh;
  private readonly position: THREE.BufferAttribute;

  constructor(color: number, opacity: number, private readonly segments: number) {
    const index: number[] = [];
    for (let i = 0; i < segments; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    [this.mesh, this.position] = dynamicMesh((segments + 1) * 2, index, overlayMaterial(color, opacity));
  }

  set(radius: number, halfWidth: number, from: number, to: number): void {
    const a = this.position.array as Float32Array;
    for (let i = 0; i <= this.segments; i += 1) {
      const t = from + ((to - from) * i) / this.segments;
      const s = Math.sin(t);
      const c = Math.cos(t);
      const o = i * 6;
      a[o] = s * (radius - halfWidth); a[o + 1] = c * (radius - halfWidth); a[o + 2] = 0;
      a[o + 3] = s * (radius + halfWidth); a[o + 4] = c * (radius + halfWidth); a[o + 5] = 0;
    }
    this.position.needsUpdate = true;
  }
}

/** Radial tick marks. */
class Ticks {
  readonly mesh: THREE.Mesh;
  private readonly position: THREE.BufferAttribute;

  constructor(color: number, opacity: number, count: number) {
    const index: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const a = i * 4;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    [this.mesh, this.position] = dynamicMesh(count * 4, index, overlayMaterial(color, opacity));
  }

  set(i: number, angle: number, r0: number, r1: number, halfWidth: number): void {
    const a = this.position.array as Float32Array;
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const tx = c * halfWidth;
    const ty = -s * halfWidth;
    const corners = [[r0, -1], [r0, 1], [r1, -1], [r1, 1]] as const;
    corners.forEach(([r, side], k) => {
      const o = (i * 4 + k) * 3;
      a[o] = s * r + side * tx;
      a[o + 1] = c * r + side * ty;
      a[o + 2] = 0;
    });
    this.position.needsUpdate = true;
  }
}

/**
 * Three.js renderer with an orthographic camera, so the marker's projected
 * position equals the pose position. Throws if WebGL is unavailable.
 */
export class WebGLSurfaceRenderer implements SurfaceRenderer {
  readonly kind = 'webgl' as const;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  private readonly ball = new THREE.Group();
  private readonly boundary = new Arc(PALETTE.boundary, 0.7, 128);
  private readonly ticks = new Ticks(PALETTE.boundary, 0.7, 5);
  private readonly track = new Arc(PALETTE.track, 1, 96);
  private readonly value = new Arc(PALETTE.value, 1, 96);
  private readonly pointer = new Ticks(PALETTE.value, 1, 1);
  private readonly focus = new Arc(PALETTE.focus, 1, 128);
  private layout: Layout | null = null;
  private disposed = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.z = 10;

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48),
      new THREE.MeshStandardMaterial({ color: PALETTE.body, roughness: 0.37, metalness: 0.5 }),
    );
    const segments: number[] = [];
    for (const line of gridLines()) {
      for (let i = 1; i < line.length; i += 1) segments.push(...line[i - 1], ...line[i]);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({
      color: PALETTE.grid, transparent: true, opacity: 0.2, depthWrite: false,
    }));
    const indexCurve = new THREE.CatmullRomCurve3(twistIndexLine().map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const index = new THREE.Mesh(
      new THREE.TubeGeometry(indexCurve, 24, 0.0085, 6, false),
      new THREE.MeshBasicMaterial({ color: PALETTE.index }),
    );
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(MARKER_RATIO, 24, 16),
      new THREE.MeshBasicMaterial({ color: PALETTE.value, transparent: true, depthTest: false, depthWrite: false }),
    );
    marker.position.set(0, 0, 1);
    marker.renderOrder = MARKER_ORDER;
    this.ball.add(body, grid, index, marker);

    const overlay = new THREE.Group();
    overlay.position.z = 2;
    overlay.add(this.boundary.mesh, this.ticks.mesh, this.track.mesh, this.value.mesh, this.pointer.mesh, this.focus.mesh);

    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(-2, 3, 5);
    const rim = new THREE.DirectionalLight(0xb5a0e0, 1.1);
    rim.position.set(3, -2, -1);
    this.scene.add(this.ball, overlay, new THREE.AmbientLight(0xd8d7fa, 1.8), light, rim);
  }

  setSize(layout: Layout, pixelRatio: number): void {
    this.layout = layout;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(layout.width, layout.height, false);
    // World units are ball radii; the ball is centred in the canvas.
    const halfW = layout.width / 2 / layout.ball;
    const halfH = layout.height / 2 / layout.ball;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  render(pose: Pose, focusVisible: boolean): void {
    const layout = this.layout;
    if (this.disposed || !layout) return;
    const px = 1 / layout.ball; // one CSS pixel in world units
    const [qx, qy, qz, qw] = poseOrientation(pose);
    this.ball.quaternion.set(qx, qy, qz, qw);

    this.boundary.set(TRAVEL_RATIO, 0.625 * px, 0, Math.PI * 2);
    for (let i = 0; i < 4; i += 1) this.ticks.set(i, (i * Math.PI) / 2, TRAVEL_RATIO - 0.045, TRAVEL_RATIO + 0.045, 0.625 * px);
    this.ticks.set(4, 0, Z_RING_RATIO + 0.04, Z_RING_RATIO + 0.075, 0.625 * px);
    this.track.set(Z_RING_RATIO, 1.5 * px, -0.75 * Math.PI, 0.75 * Math.PI);
    const angle = twistAngle(pose.z);
    this.value.set(Z_RING_RATIO, 1.5 * px, 0, angle);
    this.value.mesh.visible = Math.abs(angle) > 1e-6;
    this.pointer.set(0, angle, Z_RING_RATIO - 0.05, Z_RING_RATIO + 0.05, px);
    this.focus.set(FOCUS_RING_RATIO, px, 0, Math.PI * 2);
    this.focus.mesh.visible = focusVisible;

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.traverse((object) => {
      const { geometry, material } = object as Partial<THREE.Mesh>;
      geometry?.dispose();
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
