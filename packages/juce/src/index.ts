import { sanitizedParameter, toParameters } from '@lowquo/surface';
import type { ParameterId, ParameterBridge, Pose } from '@lowquo/surface';

/** Pass JUCE's `getNativeFunction(name)` in from the client application. */
export type NativeFunctionLookup = (name: string) => (...args: (string | number)[]) => Promise<unknown>;

/** JUCE native bridge. A serial promise queue preserves per-gesture ordering. */
export function createJuceBridge(lookup: NativeFunctionLookup): ParameterBridge {
  const begin = lookup('surfaceBeginGesture');
  const set = lookup('surfaceSetParameter');
  const end = lookup('surfaceEndGesture');
  let pending: Promise<unknown> = Promise.resolve();
  const enqueue = (op: () => Promise<unknown>): Promise<void> => {
    const next = pending.then(op);
    pending = next.catch(() => undefined);
    return next.then(() => undefined);
  };
  return {
    beginGesture(id) { return enqueue(() => begin(id)); },
    setParameter(id, value) {
      const safe = sanitizedParameter(id, value);
      return enqueue(() => set(safe.id, safe.value));
    },
    endGesture(id) { return enqueue(() => end(id)); },
  };
}

/** Safely pair gestures; all the axes are host-automatable. */
export class SurfaceHostController {
  private active = false;
  constructor(private readonly bridge: ParameterBridge) {}

  begin(): void {
    if (this.active) return;
    this.active = true;
    for (const id of ['surface_x', 'surface_y', 'surface_z'] as ParameterId[]) void this.bridge.beginGesture(id);
  }
  change(pose: Pose): void {
    for (const { id, value } of toParameters(pose)) void this.bridge.setParameter(id, value);
  }
  end(): void {
    if (!this.active) return;
    this.active = false;
    for (const id of ['surface_x', 'surface_y', 'surface_z'] as ParameterId[]) void this.bridge.endGesture(id);
  }
  dispose(): void { this.end(); }
}
