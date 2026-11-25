import { describe, expect, it, vi } from 'vitest';
import { activateWaitingWorker, RELOAD_KEY, type StartUpdateEnv } from './swStart';

/** A fake service-worker container: `waiting` answers SKIP_WAITING by taking control (or not). */
function fakeEnv({
  controller = true,
  waiting = true,
  takesOver = true,
  stored = null as string | null,
  session = true,
} = {}) {
  const target = new EventTarget();
  const messages: unknown[] = [];
  const store = new Map<string, string>(stored ? [[RELOAD_KEY, stored]] : []);
  const reload = vi.fn();
  const worker = {
    postMessage: (m: unknown) => {
      messages.push(m);
      if (takesOver) queueMicrotask(() => target.dispatchEvent(new Event('controllerchange')));
    },
  };
  const env: StartUpdateEnv = {
    serviceWorker: {
      controller: controller ? ({} as ServiceWorker) : null,
      getRegistration: async () =>
        ({ waiting: waiting ? worker : null }) as unknown as ServiceWorkerRegistration,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    },
    session: session
      ? { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }
      : null,
    reload,
    now: () => 1_000_000,
    timeoutMs: 50,
  };
  return { env, messages, reload, store };
}

describe('activating a waiting service worker at start', () => {
  it('tells the waiting worker to take over and reloads once onto it', async () => {
    const { env, messages, reload, store } = fakeEnv();
    await expect(activateWaitingWorker(env)).resolves.toBe(true);
    expect(messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get(RELOAD_KEY)).toBe('1000000');
  });

  it('carries on when nothing is waiting, or on a first visit (no controller)', async () => {
    for (const opts of [{ waiting: false }, { controller: false }]) {
      const { env, messages, reload } = fakeEnv(opts);
      await expect(activateWaitingWorker(env)).resolves.toBe(false);
      expect(messages).toEqual([]);
      expect(reload).not.toHaveBeenCalled();
    }
  });

  it('never loops: a reload tried within the last minute is not tried again', async () => {
    const { env, messages, reload } = fakeEnv({ stored: String(1_000_000 - 5_000) });
    await expect(activateWaitingWorker(env)).resolves.toBe(false);
    expect(messages).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    // An hour later (a new start in the same tab) it may try again.
    const later = fakeEnv({ stored: String(1_000_000 - 3_600_000) });
    await expect(activateWaitingWorker(later.env)).resolves.toBe(true);
  });

  it('gives up without reloading when the worker does not take over in time', async () => {
    const { env, reload } = fakeEnv({ takesOver: false });
    await expect(activateWaitingWorker(env)).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing without session storage (the loop guard needs it) or service workers', async () => {
    const { env, reload } = fakeEnv({ session: false });
    await expect(activateWaitingWorker(env)).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
    await expect(activateWaitingWorker(null)).resolves.toBe(false);
    await expect(activateWaitingWorker({ reload })).resolves.toBe(false);
  });
});
