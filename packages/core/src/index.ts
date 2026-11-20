/** Pure state and geometry: no dependencies on DOM, renderer or DSP. */
export type Pose = Readonly<{ x: number; y: number; z: number }>;
export type PoseAxis = keyof Pose;
export type RegionName = 'PUNCH' | 'TONE' | 'CLIP' | 'CRUSH' | 'GLUE';
export type RegionWeight = Readonly<{ name: RegionName; weight: number }>;
export type ParameterId = 'surface_x' | 'surface_y' | 'surface_z';
export type ParameterValue = Readonly<{ id: ParameterId; value: number }>;

export interface ParameterBridge {
  beginGesture(id: ParameterId): void | Promise<void>;
  setParameter(id: ParameterId, value: number): void | Promise<void>;
  endGesture(id: ParameterId): void | Promise<void>;
}

export const NEUTRAL_POSE: Pose = Object.freeze({ x: 0, y: 0, z: 0.5 });
export const PARAMETER_IDS: readonly ParameterId[] = Object.freeze(['surface_x', 'surface_y', 'surface_z']);

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

export function clampPose(pose: Pose): Pose {
  let x = clamp(pose.x, -1, 1);
  let y = clamp(pose.y, -1, 1);
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  return { x, y, z: clamp(pose.z, 0, 1) };
}

export function equalPose(a: Pose, b: Pose, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) < epsilon
    && Math.abs(a.y - b.y) < epsilon
    && Math.abs(a.z - b.z) < epsilon;
}

export function toParameters(pose: Pose): readonly ParameterValue[] {
  const p = clampPose(pose);
  return [
    { id: 'surface_x', value: (p.x + 1) / 2 },
    { id: 'surface_y', value: (p.y + 1) / 2 },
    { id: 'surface_z', value: p.z },
  ];
}

export function fromParameters(x: number, y: number, z: number): Pose {
  return clampPose({ x: clamp(x, 0, 1) * 2 - 1, y: clamp(y, 0, 1) * 2 - 1, z });
}

const REGION_DIRECTIONS: readonly (readonly [RegionName, number, number])[] = [
  ['PUNCH', 0, -1],
  ['TONE', Math.sin(Math.PI * 2 / 5), -Math.cos(Math.PI * 2 / 5)],
  ['CLIP', Math.sin(Math.PI * 4 / 5), -Math.cos(Math.PI * 4 / 5)],
  ['CRUSH', Math.sin(Math.PI * 6 / 5), -Math.cos(Math.PI * 6 / 5)],
  ['GLUE', Math.sin(Math.PI * 8 / 5), -Math.cos(Math.PI * 8 / 5)],
];

/** Normalised positive region proximity. Weights sum to 1 away from neutral. */
export function regionWeights(pose: Pose): readonly RegionWeight[] {
  const p = clampPose(pose);
  const radius = Math.hypot(p.x, p.y);
  if (radius < 1e-8) return REGION_DIRECTIONS.map(([name]) => ({ name, weight: 0 }));
  const amounts = REGION_DIRECTIONS.map(([name, dx, dy]) => ({
    name,
    weight: Math.pow(Math.max(0, (1 + (p.x * dx + p.y * dy) / radius) / 2), 4),
  }));
  const total = amounts.reduce((sum, entry) => sum + entry.weight, 0);
  return amounts.map((entry) => ({ name: entry.name, weight: entry.weight / total }));
}

/** Radial distance, independent of which processor region dominates. */
export function intensity(pose: Pose): number {
  const p = clampPose(pose);
  return Math.hypot(p.x, p.y);
}

/** Protect host state: never send invalid IDs or unbounded values. */
export function sanitizedParameter(id: ParameterId, value: number): ParameterValue {
  if (!PARAMETER_IDS.includes(id)) throw new Error(`Unknown parameter: ${String(id)}`);
  return { id, value: clamp(value, 0, 1) };
}
