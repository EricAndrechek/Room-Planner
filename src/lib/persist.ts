import { track } from './analytics';

const PERSIST_ASKED_KEY = 'room-planner-persist-asked';

/**
 * Ask the browser not to evict our storage. Called once, after the first
 * successful project save (a moment when there is something worth keeping).
 */
export async function requestPersistentStorageOnce(): Promise<void> {
  try {
    if (localStorage.getItem(PERSIST_ASKED_KEY) === '1') return;
  } catch {
    return;
  }
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage || typeof storage.persist !== 'function') return;
  try {
    localStorage.setItem(PERSIST_ASKED_KEY, '1');
  } catch {
    /* ignore */
  }
  try {
    const granted = (await storage.persisted?.()) || (await storage.persist());
    track('storage_persist_result', { granted });
  } catch {
    track('storage_persist_result', { granted: false });
  }
}
