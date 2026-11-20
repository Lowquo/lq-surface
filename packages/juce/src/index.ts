import { PARAMETER_IDS, fromParameters, sanitizedParameter, toParameters } from '@lowquo/surface';
import type { ParameterBridge, ParameterId, Pose } from '@lowquo/surface';

/** Pass JUCE's `getNativeFunction(name)` in from the client application. */
export type NativeFunctionLookup = (name: string) => (...args: (string | number)[]) => Promise<unknown>;

/** Receives errors that would otherwise be thrown or become unhandled promise rejections. */
export type ErrorHandler = (error: unknown) => void;

/** Native function names registered by the JUCE example (WebBrowserComponent::Options::withNativeFunction). */
export const NATIVE_FUNCTIONS = Object.freeze({
  beginGesture: 'surfaceBeginGesture',
  setParameter: 'surfaceSetParameter',
  endGesture: 'surfaceEndGesture',
  getState: 'surfaceGetState',
} as const);

/** Event the native side emits (WebBrowserComponent::emitEventIfBrowserIsVisible) when host-side values change. */
export const HOST_STATE_EVENT = 'surfaceHostState';

/** Default time after which an unanswered native call counts as failed, so the queue keeps moving. */
export const DEFAULT_NATIVE_TIMEOUT_MS = 5000;

/** A native call failed: it returned `false` (rejected by the native side), threw, or timed out. */
export class NativeCallError extends Error {
  readonly functionName: string;
  constructor(functionName: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NativeCallError';
    this.functionName = functionName;
  }
}

export interface JuceBridgeOptions {
  /** Milliseconds before an unanswered native call is rejected (default 5000). 0 or Infinity disables. */
  timeoutMs?: number;
}

type TimerHost = {
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, functionName: string): Promise<T> {
  const timers = globalThis as unknown as TimerHost;
  if (!(timeoutMs > 0) || !Number.isFinite(timeoutMs) || typeof timers.setTimeout !== 'function') return promise;
  return new Promise<T>((resolve, reject) => {
    const handle = timers.setTimeout!(() => {
      reject(new NativeCallError(functionName, `${functionName} did not complete within ${timeoutMs} ms`));
    }, timeoutMs);
    const clear = (): void => { timers.clearTimeout?.(handle); };
    promise.then((value) => { clear(); resolve(value); }, (error: unknown) => { clear(); reject(error); });
  });
}

/** Calls a native function; sync throws, `false` results and timeouts become NativeCallError rejections. */
async function invokeNative(functionName: string, call: () => Promise<unknown>, timeoutMs: number): Promise<unknown> {
  let result: unknown;
  try {
    result = await withTimeout(Promise.resolve().then(call), timeoutMs, functionName);
  } catch (error) {
    if (error instanceof NativeCallError) throw error;
    throw new NativeCallError(functionName, `${functionName} failed`, { cause: error });
  }
  if (result === false) throw new NativeCallError(functionName, `${functionName} was rejected by the native host`);
  return result;
}

function isParameterId(id: unknown): id is ParameterId {
  return typeof id === 'string' && (PARAMETER_IDS as readonly string[]).includes(id);
}

function isFinitePose(pose: unknown): pose is Pose {
  if (typeof pose !== 'object' || pose === null) return false;
  const { x, y, z } = pose as Record<string, unknown>;
  return [x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v));
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    && typeof (value as { then?: unknown }).then === 'function';
}

function report(onError: ErrorHandler | undefined, error: unknown): void {
  try { onError?.(error); } catch { /* an error handler must never break the caller */ }
}

type QueuedCall = {
  readonly kind: 'begin' | 'set' | 'end';
  readonly id: ParameterId;
  value: number;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
};

/**
 * JUCE native bridge.
 *
 * Calls run one at a time, in order. While a call is in flight, further `setParameter` calls for
 * the same ID are coalesced into the queued one (latest value wins), so a fast pointer cannot grow
 * the queue without bound when IPC is slow. Coalescing never crosses a begin/end of that ID.
 *
 * Invalid IDs and non-finite values are never forwarded: the returned promise rejects with a
 * TypeError/RangeError instead. A native result of `false` rejects with NativeCallError.
 */
export function createJuceBridge(lookup: NativeFunctionLookup, options: JuceBridgeOptions = {}): ParameterBridge {
  const native = {
    begin: lookup(NATIVE_FUNCTIONS.beginGesture),
    set: lookup(NATIVE_FUNCTIONS.setParameter),
    end: lookup(NATIVE_FUNCTIONS.endGesture),
  };
  const timeoutMs = options.timeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS;
  const queue: QueuedCall[] = [];
  const pendingSets = new Map<ParameterId, QueuedCall>();
  let running = false;

  const pump = (): void => {
    if (running) return;
    const next = queue.shift();
    if (!next) return;
    running = true;
    if (pendingSets.get(next.id) === next) pendingSets.delete(next.id);
    const [name, call] = next.kind === 'begin'
      ? [NATIVE_FUNCTIONS.beginGesture, () => native.begin(next.id)] as const
      : next.kind === 'end'
        ? [NATIVE_FUNCTIONS.endGesture, () => native.end(next.id)] as const
        : [NATIVE_FUNCTIONS.setParameter, () => native.set(next.id, next.value)] as const;
    invokeNative(name, call, timeoutMs)
      .then(() => next.resolve(), next.reject)
      .finally(() => { running = false; pump(); });
  };

  const enqueue = (kind: QueuedCall['kind'], id: ParameterId, value = 0): QueuedCall => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    const call: QueuedCall = { kind, id, value, promise, resolve, reject };
    queue.push(call);
    pump();
    return call;
  };

  const boundary = (kind: 'begin' | 'end', id: ParameterId): Promise<void> => {
    if (!isParameterId(id)) return Promise.reject(new TypeError(`Unknown parameter: ${String(id)}`));
    pendingSets.delete(id); // later sets must not be merged across this boundary
    return enqueue(kind, id).promise;
  };

  return {
    beginGesture(id) { return boundary('begin', id); },
    setParameter(id, value) {
      if (!isParameterId(id)) return Promise.reject(new TypeError(`Unknown parameter: ${String(id)}`));
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return Promise.reject(new RangeError(`Refusing to send non-finite value for ${id}`));
      }
      let safe: number;
      try {
        safe = sanitizedParameter(id, value).value;
      } catch (error) {
        return Promise.reject(error);
      }
      const pending = pendingSets.get(id);
      if (pending) {
        pending.value = safe;
        return pending.promise;
      }
      const call = enqueue('set', id, safe);
      // pump() may already have started it; only a still-queued call can absorb later values.
      if (queue.includes(call)) pendingSets.set(id, call);
      return call.promise;
    },
    endGesture(id) { return boundary('end', id); },
  };
}

export interface SurfaceHostControllerOptions {
  /** Receives bridge rejections and synchronous throws. Without it, errors are silently dropped. */
  onError?: ErrorHandler;
  /** Called whenever the controller becomes idle: no open gesture and no outstanding bridge call. */
  onIdle?: () => void;
}

/**
 * Safely pair gestures; all the axes are host-automatable.
 *
 * - Pointer gestures open/close all three axes together (`begin`/`end` are idempotent).
 * - `change()` outside a gesture is wrapped in its own begin/end, so the host never receives an
 *   un-gestured write.
 * - Within a gesture only axes whose value changed are sent (the first change of each gesture
 *   sends all three).
 * - Non-finite poses are dropped and reported, never forwarded.
 * - No method throws and no bridge rejection goes unhandled; errors go to `onError`.
 */
export class SurfaceHostController {
  private active = false;
  private disposed = false;
  private outstanding = 0;
  private readonly lastSent = new Map<ParameterId, number>();
  private readonly onError: ErrorHandler | undefined;
  private readonly onIdle: (() => void) | undefined;

  constructor(private readonly bridge: ParameterBridge, options: SurfaceHostControllerOptions = {}) {
    this.onError = options.onError;
    this.onIdle = options.onIdle;
  }

  /** True between `begin()` and `end()`. */
  get gestureActive(): boolean { return this.active; }
  /** Number of bridge calls that have not settled yet. */
  get pendingCalls(): number { return this.outstanding; }
  /** No open gesture and nothing in flight: host state can be trusted to reflect our writes. */
  get idle(): boolean { return !this.active && this.outstanding === 0; }

  begin(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    this.lastSent.clear();
    for (const id of PARAMETER_IDS) this.call(() => this.bridge.beginGesture(id));
  }

  change(pose: Pose): void {
    if (this.disposed) return;
    if (!isFinitePose(pose)) {
      report(this.onError, new RangeError('Ignoring pose with non-finite coordinates'));
      return;
    }
    let values: ReturnType<typeof toParameters>;
    try {
      values = toParameters(pose);
    } catch (error) {
      report(this.onError, error);
      return;
    }
    const wrap = !this.active;
    if (wrap) this.begin();
    for (const { id, value } of values) {
      if (!Number.isFinite(value)) {
        report(this.onError, new RangeError(`Ignoring non-finite value for ${id}`));
        continue;
      }
      if (this.lastSent.get(id) === value) continue;
      this.lastSent.set(id, value);
      this.call(() => this.bridge.setParameter(id, value));
    }
    if (wrap) this.end();
  }

  end(): void {
    if (!this.active) return;
    this.active = false;
    for (const id of PARAMETER_IDS) this.call(() => this.bridge.endGesture(id));
    this.notifyIfIdle();
  }

  /** Ends an open gesture; later calls are ignored. */
  dispose(): void {
    if (this.disposed) return;
    this.end();
    this.disposed = true;
  }

  private call(operation: () => void | Promise<void>): void {
    let result: unknown;
    try {
      result = operation();
    } catch (error) {
      report(this.onError, error);
      return;
    }
    if (!isThenable(result)) return;
    this.outstanding += 1;
    Promise.resolve(result)
      .then(undefined, (error: unknown) => report(this.onError, error))
      .then(() => {
        this.outstanding -= 1;
        this.notifyIfIdle();
      });
  }

  private notifyIfIdle(): void {
    if (!this.idle) return;
    try { this.onIdle?.(); } catch (error) { report(this.onError, error); }
  }
}

/** Normalised host parameter values as carried by the surfaceHostState / surfaceGetState payload. */
export type HostParameterState = Readonly<{ x: number; y: number; z: number }>;

/**
 * Validates an untrusted host-state payload `{ x, y, z }` of normalised [0, 1] parameter values.
 * Returns null for anything else (missing/extra-typed/out-of-range/non-finite fields, arrays,
 * throwing getters...). Extra fields are ignored. Never throws.
 */
export function parseHostParameters(payload: unknown): HostParameterState | null {
  try {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const values: Record<'x' | 'y' | 'z', number> = { x: 0, y: 0, z: 0 };
    for (const key of ['x', 'y', 'z'] as const) {
      if (!Object.prototype.hasOwnProperty.call(payload, key)) return null;
      const value: unknown = (payload as Record<string, unknown>)[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
      values[key] = value;
    }
    return Object.freeze(values);
  } catch {
    return null;
  }
}

/** Like parseHostParameters, converted to a (disk-constrained) Pose. */
export function parseHostState(payload: unknown): Pose | null {
  const params = parseHostParameters(payload);
  return params ? fromParameters(params.x, params.y, params.z) : null;
}

/** The subset of `window.__JUCE__.backend` this adapter uses (inject it; no global access here). */
export interface JuceEventBackend {
  addEventListener(eventId: string, listener: (payload: unknown) => void): unknown;
  removeEventListener(handle: unknown): void;
}

export interface HostStateSubscriptionOptions {
  /** Receives invalid payloads (as TypeError), listener throws and backend errors. */
  onError?: ErrorHandler;
  /** Defaults to HOST_STATE_EVENT. */
  eventId?: string;
}

function subscribeRaw(
  backend: JuceEventBackend,
  eventId: string,
  onPayload: (params: HostParameterState) => void,
  onError: ErrorHandler | undefined,
): () => void {
  let active = true;
  let handle: unknown;
  try {
    handle = backend.addEventListener(eventId, (payload: unknown) => {
      if (!active) return;
      const params = parseHostParameters(payload);
      if (!params) {
        report(onError, new TypeError(`Ignoring invalid ${eventId} payload`));
        return;
      }
      try { onPayload(params); } catch (error) { report(onError, error); }
    });
  } catch (error) {
    report(onError, error);
    return () => undefined;
  }
  return () => {
    if (!active) return;
    active = false;
    try { backend.removeEventListener(handle); } catch (error) { report(onError, error); }
  };
}

/**
 * Subscribes to validated host-state events. Invalid payloads are dropped. The listener never
 * runs after the returned unsubscribe function was called; unsubscribing twice is harmless.
 */
export function subscribeHostState(
  backend: JuceEventBackend,
  listener: (pose: Pose) => void,
  options: HostStateSubscriptionOptions = {},
): () => void {
  return subscribeRaw(
    backend,
    options.eventId ?? HOST_STATE_EVENT,
    (params) => listener(fromParameters(params.x, params.y, params.z)),
    options.onError,
  );
}

async function fetchHostParameters(
  lookup: NativeFunctionLookup,
  timeoutMs: number,
  onError: ErrorHandler | undefined,
): Promise<HostParameterState | null> {
  const name = NATIVE_FUNCTIONS.getState;
  try {
    const getState = lookup(name);
    const result = await invokeNative(name, () => getState(), timeoutMs);
    const params = parseHostParameters(result);
    if (!params) report(onError, new NativeCallError(name, `${name} returned an invalid payload`));
    return params;
  } catch (error) {
    report(onError, error);
    return null;
  }
}

/** Pulls the current host state via `surfaceGetState`. Resolves null on any failure; never rejects. */
export async function fetchHostState(
  lookup: NativeFunctionLookup,
  options: { onError?: ErrorHandler; timeoutMs?: number } = {},
): Promise<Pose | null> {
  const params = await fetchHostParameters(lookup, options.timeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS, options.onError);
  return params ? fromParameters(params.x, params.y, params.z) : null;
}

export interface SurfaceHostSessionOptions {
  /** JUCE's getNativeFunction. */
  lookup: NativeFunctionLookup;
  /** window.__JUCE__.backend. */
  backend: JuceEventBackend;
  onError?: ErrorHandler;
  /** Native call timeout, see JuceBridgeOptions. */
  timeoutMs?: number;
}

const STATE_EPSILON = 1e-6; // host parameters are stored as float

function sameState(a: HostParameterState, b: HostParameterState): boolean {
  return Math.abs(a.x - b.x) <= STATE_EPSILON && Math.abs(a.y - b.y) <= STATE_EPSILON && Math.abs(a.z - b.z) <= STATE_EPSILON;
}

/**
 * Complete UI-side host connection: gesture-balanced writes plus host-authoritative state.
 *
 * Host state reaches listeners only while the controller is idle (no gesture open, no write in
 * flight). Updates arriving while busy are not applied, because they may predate our own queued
 * writes; instead the state is pulled again with `surfaceGetState` as soon as the controller is
 * idle. Values equal to what the UI last sent or showed are not delivered (no echoes). Every new
 * listener receives the current host state once, from an initial pull.
 */
export class SurfaceHostSession {
  private readonly controller: SurfaceHostController;
  private readonly lookup: NativeFunctionLookup;
  private readonly backend: JuceEventBackend;
  private readonly onError: ErrorHandler | undefined;
  private readonly timeoutMs: number;
  private readonly listeners = new Set<(pose: Pose) => void>();
  private readonly unsynced = new Set<(pose: Pose) => void>();
  private unsubscribe: (() => void) | null = null;
  private uiState: HostParameterState | null = null;
  private dirty = false;
  private requesting = false;
  private requestAgain = false;
  private disposed = false;

  constructor(options: SurfaceHostSessionOptions) {
    this.lookup = options.lookup;
    this.backend = options.backend;
    this.onError = options.onError;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS;
    this.controller = new SurfaceHostController(
      createJuceBridge(options.lookup, { timeoutMs: this.timeoutMs }),
      { onError: options.onError, onIdle: () => this.handleIdle() },
    );
  }

  /** True when no gesture is open and no write is in flight. */
  get idle(): boolean { return this.controller.idle; }

  begin(): void { this.controller.begin(); }

  change(pose: Pose): void {
    if (this.disposed) return;
    this.controller.change(pose);
    if (isFinitePose(pose)) {
      const [x, y, z] = toParameters(pose);
      this.uiState = Object.freeze({ x: x!.value, y: y!.value, z: z!.value });
    }
  }

  end(): void { this.controller.end(); }

  onHostState(listener: (pose: Pose) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    this.unsynced.add(listener);
    if (!this.unsubscribe) {
      this.unsubscribe = subscribeRaw(this.backend, HOST_STATE_EVENT, (params) => this.handleHostState(params), this.onError);
    }
    this.resync();
    return () => {
      this.listeners.delete(listener);
      this.unsynced.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.controller.dispose();
    this.disposed = true;
    this.listeners.clear();
    this.unsynced.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private handleHostState(params: HostParameterState): void {
    if (this.disposed) return;
    if (!this.controller.idle) {
      this.dirty = true;
      return;
    }
    this.deliver(params);
  }

  private handleIdle(): void {
    if (this.disposed || !this.dirty) return;
    this.dirty = false;
    this.resync();
  }

  private resync(): void {
    if (this.disposed) return;
    if (this.requesting) {
      this.requestAgain = true;
      return;
    }
    this.requesting = true;
    void fetchHostParameters(this.lookup, this.timeoutMs, this.onError).then((params) => {
      this.requesting = false;
      if (this.disposed) return;
      if (params) {
        // A reply that arrives while we are busy may predate queued writes: retry when idle.
        if (this.controller.idle) this.deliver(params);
        else this.dirty = true;
      }
      if (this.requestAgain) {
        this.requestAgain = false;
        this.resync();
      }
    });
  }

  private deliver(params: HostParameterState): void {
    const changed = this.uiState === null || !sameState(params, this.uiState);
    this.uiState = params;
    const targets = changed ? [...this.listeners] : [...this.unsynced];
    this.unsynced.clear();
    if (targets.length === 0) return;
    const pose = fromParameters(params.x, params.y, params.z);
    for (const listener of targets) {
      if (!this.listeners.has(listener)) continue;
      try { listener(pose); } catch (error) { report(this.onError, error); }
    }
  }
}
