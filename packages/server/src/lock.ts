import type { Store } from "@populace/core";
import { z } from "zod";

/**
 * `populace serve` is the single SQLite writer (ADR-0022). `node:sqlite`'s `DatabaseSync` is
 * synchronous, so a second writing process means `SQLITE_BUSY` under exactly the conditions that
 * most need to be reliable — a run in flight while someone clicks in the browser.
 *
 * The lock is a row rather than a file so it travels with the database: a store on a different
 * path is a different lock, with no separate bookkeeping to get out of step.
 */
export const LOCK_KEY = "serve.lock";

const LockSchema = z.object({ pid: z.number().int(), startedAt: z.iso.datetime(), host: z.string() });
export type ServeLock = z.infer<typeof LockSchema>;

export async function readLock(store: Store): Promise<ServeLock | undefined> {
  const raw = await store.getControl(LOCK_KEY);
  if (raw === undefined) return undefined;
  // eslint-disable-next-line no-restricted-syntax -- control row is JSON text written by `takeLock`.
  const parsed = LockSchema.safeParse(JSON.parse(raw) as unknown);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A lock whose process is gone is stale, and the common way to produce one is Ctrl-C at the wrong
 * moment. On this machine that is checkable, so a stale lock is taken over silently rather than
 * making the user pass `--force` to recover from a crash they did not cause. A lock from another
 * host is never assumed dead.
 */
function holderIsAlive(lock: ServeLock, host: string): boolean {
  if (lock.host !== host) return true;
  try {
    // Signal 0 tests for the process without touching it.
    globalThis.process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class StoreLocked extends Error {
  constructor(readonly lock: ServeLock) {
    super(`another populace process (pid ${lock.pid} on ${lock.host}, since ${lock.startedAt}) is already writing this store; stop it, or start with --force to take over`);
    this.name = "StoreLocked";
  }
}

export async function takeLock(store: Store, options: { force?: boolean } = {}): Promise<ServeLock> {
  const host = globalThis.process.env.HOSTNAME ?? "this machine";
  const existing = await readLock(store);
  if (existing && !options.force && holderIsAlive(existing, host)) throw new StoreLocked(existing);
  const lock: ServeLock = { pid: globalThis.process.pid, startedAt: new Date().toISOString(), host };
  await store.setControl(LOCK_KEY, JSON.stringify(lock));
  return lock;
}

/** Only the holder releases it, so a `--force` takeover does not have its lock dropped later. */
export async function releaseLock(store: Store, lock: ServeLock): Promise<void> {
  const current = await readLock(store);
  if (current?.pid === lock.pid && current.startedAt === lock.startedAt) await store.deleteControl(LOCK_KEY);
}
