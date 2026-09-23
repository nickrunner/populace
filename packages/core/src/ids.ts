const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomSuffix(length: number): string {
  // Web Crypto rather than node:crypto: core is imported by the browser bundle (ADR-0021).
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet.charAt(b % alphabet.length);
  return out;
}

/**
 * The base36 timestamp in the middle of every id — made STRICTLY increasing within a process, so
 * two rows minted in the same millisecond still sort in the order they were made. Sorting by
 * `createdAt` and then by id is how the default population is chosen (`ensurePopulation`), and
 * a tie at millisecond resolution broken by a random suffix picked the default at random.
 */
let lastStamp = 0;
function stamp(at: number = Date.now()): string {
  lastStamp = at > lastStamp ? at : lastStamp + 1;
  return lastStamp.toString(36);
}

/** Run ids look like `run_m1abc2de_x7k9q2`; the middle is a base36 timestamp so ids sort by time. */
export function newRunId(now: Date = new Date()): string {
  return `run_${stamp(now.getTime())}_${randomSuffix(6)}`;
}

export function newWakeId(): string {
  return `wake_${stamp()}_${randomSuffix(6)}`;
}

export function newFindingId(): string {
  return `fnd_${stamp()}_${randomSuffix(6)}`;
}

export function newIdentityId(): string {
  return `idn_${stamp()}_${randomSuffix(6)}`;
}

export function newJobId(): string {
  return `job_${stamp()}_${randomSuffix(6)}`;
}

/** Authored rows get surrogate ids so a slug can be renamed without the row moving. */
export function newProjectId(): string {
  return `prj_${stamp()}_${randomSuffix(6)}`;
}

export function newTargetId(): string {
  return `tgt_${stamp()}_${randomSuffix(6)}`;
}

export function newPersonaId(): string {
  return `psn_${stamp()}_${randomSuffix(6)}`;
}

export function newPopulationId(): string {
  return `pop_${stamp()}_${randomSuffix(6)}`;
}

export function newCohortId(): string {
  return `coh_${stamp()}_${randomSuffix(6)}`;
}

export function newSimulationId(): string {
  return `sim_${stamp()}_${randomSuffix(6)}`;
}

export const TAG_PREFIX = "populace:";

/** The tag a run stamps on every identity, wake and finding it creates. */
export function tagForRun(runId: string): string {
  return `${TAG_PREFIX}${runId}`;
}

export function runIdFromTag(tag: string): string | undefined {
  return tag.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : undefined;
}

export function isRunId(value: string): boolean {
  return /^run_[0-9a-z]+_[0-9a-z]{6}$/.test(value);
}

/**
 * The run, as an email local part can legally carry it.
 *
 * Every provider builds a person's address as `handle+<this>@domain`, and for a long time it used
 * the tag itself — but a tag is `populace:run_x_y` and **a colon is not legal in an unquoted local
 * part** (RFC 5321), so every address populace generated was invalid. Firebase tolerated it and
 * nothing else had been asked, until `@populace/tdk` validated one and refused it (ADR-0037).
 *
 * The run id is legal, stable and recoverable — prefix it with `populace:` to get the tag back.
 * `slugify` is the fallback for a tag that is not a run tag at all, which nothing produces today.
 */
export function emailTagFor(tag: string): string {
  return runIdFromTag(tag) ?? slugify(tag);
}

/** A safe slug for embedding in emails, usernames and file names. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
