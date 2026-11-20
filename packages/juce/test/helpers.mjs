// Shared fakes for the @lowquo/surface-juce tests. Not a test file itself (no .test.mjs suffix).

/** Lets queued promise callbacks and timers of the current turn run. */
export const tick = () => new Promise((resolve) => setImmediate(resolve));

export async function settle(times = 5) {
  for (let i = 0; i < times; i += 1) await tick();
}

/**
 * Fake JUCE native side. Keeps fake host parameter state ({ x, y, z } normalised).
 * In manual mode each call stays pending until released, like slow IPC.
 */
export function fakeNative({ manual = false, respond } = {}) {
  const state = { x: 0.5, y: 0.5, z: 0.5 };
  const calls = [];
  const pending = [];
  const lookups = [];
  let isManual = manual;

  const answer = (name, args) => {
    if (respond) {
      const custom = respond(name, args, state);
      if (custom !== undefined) return custom;
    }
    if (name === 'surfaceSetParameter') {
      state[String(args[0]).slice(-1)] = args[1];
      return true;
    }
    if (name === 'surfaceGetState') return { ...state };
    return true;
  };

  const lookup = (name) => {
    lookups.push(name);
    return (...args) => {
      calls.push([name, ...args]);
      if (!isManual) return Promise.resolve().then(() => answer(name, args));
      return new Promise((resolve, reject) => {
        pending.push({
          name,
          args,
          resolve: (value) => resolve(value === undefined ? answer(name, args) : value),
          reject,
        });
      });
    };
  };

  return {
    state,
    calls,
    pending,
    lookups,
    lookup,
    setManual(value) { isManual = value; },
    names() { return calls.map((c) => c[0]); },
    /** Releases pending calls one by one (in order) until none are left. */
    async releaseAll() {
      await settle(); // native calls are issued from a microtask
      while (pending.length > 0) {
        pending.shift().resolve();
        await settle();
      }
    },
  };
}

/** Fake window.__JUCE__.backend with JUCE's [eventId, id] handle semantics. */
export function fakeBackend() {
  const listeners = new Map();
  let nextId = 0;
  const removed = [];
  return {
    removed,
    addEventListener(eventId, fn) {
      if (!listeners.has(eventId)) listeners.set(eventId, new Map());
      const id = nextId++;
      listeners.get(eventId).set(id, fn);
      return [eventId, id];
    },
    removeEventListener(handle) {
      removed.push(handle);
      const [eventId, id] = handle;
      listeners.get(eventId)?.delete(id);
    },
    /** Like emitByBackend: payloads arrive JSON-parsed. */
    emit(eventId, payload) {
      for (const fn of [...(listeners.get(eventId)?.values() ?? [])]) fn(payload);
    },
    count(eventId) { return listeners.get(eventId)?.size ?? 0; },
  };
}

/** Fails the test if any promise rejection goes unhandled while `fn` runs. */
export async function withoutUnhandledRejections(fn) {
  const seen = [];
  const onRejection = (reason) => { seen.push(reason); };
  process.on('unhandledRejection', onRejection);
  try {
    await fn();
    await settle(10);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  if (seen.length > 0) throw new Error(`Unhandled rejection(s): ${seen.map(String).join(', ')}`);
}
