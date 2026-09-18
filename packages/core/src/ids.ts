const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomSuffix(length: number): string {
  // Web Crypto rather than node:crypto: core is imported by the browser bundle (ADR-0021).
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet.charAt(b % alphabet.length);
  return out;
}

/** Run ids look like `run_m1abc2de_x7k9q2`; the middle is a base36 timestamp so ids sort by time. */
export function newRunId(now: Date = new Date()): string {
  return `run_${now.getTime().toString(36)}_${randomSuffix(6)}`;
}

export function newWakeId(): string {
  return `wake_${Date.now().toString(36)}_${randomSuffix(6)}`;
}

export function newFindingId(): string {
  return `fnd_${Date.now().toString(36)}_${randomSuffix(6)}`;
}

export function newIdentityId(): string {
  return `idn_${Date.now().toString(36)}_${randomSuffix(6)}`;
}

export function newJobId(): string {
  return `job_${Date.now().toString(36)}_${randomSuffix(6)}`;
}

/** Authored rows get surrogate ids so a slug can be renamed without the row moving. */
export function newProjectId(): string {
  return `prj_${Date.now().toString(36)}_${randomSuffix(6)}`;
}

export function newTargetId(): string {
  return `tgt_${Date.now().toString(36)}_${randomSuffix(6)}`;
}

export function newPersonaId(): string {
  return `psn_${Date.now().toString(36)}_${randomSuffix(6)}`;
}

export function newPopulationId(): string {
  return `pop_${Date.now().toString(36)}_${randomSuffix(6)}`;
}

export function newCohortId(): string {
  return `coh_${Date.now().toString(36)}_${randomSuffix(6)}`;
}

export function newSimulationId(): string {
  return `sim_${Date.now().toString(36)}_${randomSuffix(6)}`;
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

/** A safe slug for embedding in emails, usernames and file names. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
