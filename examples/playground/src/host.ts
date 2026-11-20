import type { Pose } from '@lowquo/surface';
import { NATIVE_FUNCTIONS, SurfaceHostSession } from '@lowquo/surface-juce';
import type { ErrorHandler, JuceEventBackend, NativeFunctionLookup } from '@lowquo/surface-juce';

export interface HostConnection {
  begin(): void;                    // open a user gesture on all axes (idempotent)
  change(pose: Pose): void;         // send a pose; outside a gesture it is wrapped in its own begin/end
  end(): void;                      // close the gesture (idempotent)
  onHostState(listener: (pose: Pose) => void): () => void; // host-authoritative updates, never echoes of our own changes; returns unsubscribe
  dispose(): void;
}

export interface ConnectHostOptions {
  /** Defaults to console.warn. */
  onError?: ErrorHandler;
}

/** Native functions the page cannot work without. surfaceGetState is optional (older native builds). */
const REQUIRED_FUNCTIONS = [NATIVE_FUNCTIONS.beginGesture, NATIVE_FUNCTIONS.setParameter, NATIVE_FUNCTIONS.endGesture];

type JuceGlobalShape = {
  backend?: Partial<JuceEventBackend>;
  initialisationData?: { __juce__functions?: unknown };
};

/**
 * Finds the integration object JUCE injects before any page script runs. It must be inspected
 * before '@juce-framework/webview' is imported, because that module installs a placeholder
 * `window.__JUCE__` when none exists.
 */
function detectJuce(): { backend: JuceEventBackend; functions: readonly string[] } | null {
  const juce = (globalThis as { __JUCE__?: JuceGlobalShape }).__JUCE__;
  const backend = juce?.backend;
  const functions = juce?.initialisationData?.__juce__functions;
  if (!backend || typeof backend.addEventListener !== 'function' || typeof backend.removeEventListener !== 'function') return null;
  if (!Array.isArray(functions) || !functions.every((f): f is string => typeof f === 'string')) return null;
  if (!REQUIRED_FUNCTIONS.every((name) => functions.includes(name))) return null;
  return { backend: backend as JuceEventBackend, functions };
}

/** Resolves to null outside a JUCE WebView (and if the connection cannot be set up). Never rejects. */
export async function connectHost(options: ConnectHostOptions = {}): Promise<HostConnection | null> {
  const handler: ErrorHandler = options.onError ?? ((error) => console.warn('[lq-surface] host bridge:', error));
  const onError: ErrorHandler = (error) => {
    try { handler(error); } catch { /* a faulty handler must not break the connection */ }
  };
  let juce: ReturnType<typeof detectJuce>;
  try {
    juce = detectJuce();
  } catch (error) {
    onError(error);
    return null;
  }
  if (!juce) return null;
  const { backend, functions } = juce;

  // '@juce-framework/webview' is AGPL-3.0-only OR JUCE-licensed: load it only inside a JUCE
  // WebView, as a separate chunk, never as part of the plain browser demo.
  let getNativeFunction: NativeFunctionLookup;
  try {
    ({ getNativeFunction } = await import('@juce-framework/webview'));
  } catch (error) {
    onError(error);
    return null;
  }

  // Calling a function the backend never registered would leave its promise pending forever.
  const lookup: NativeFunctionLookup = (name) => (functions.includes(name)
    ? getNativeFunction(name)
    : () => Promise.reject(new Error(`${name} is not registered by the native host`)));

  try {
    return new SurfaceHostSession({ lookup, backend, onError });
  } catch (error) {
    onError(error);
    return null;
  }
}
