import { z } from "zod";
import type { JsonObject } from "./json.js";

/**
 * The version of the kit's wire contract, an integer, starting at 1.
 *
 * It versions the KIT and not one of its jobs, which is why the field is `tdk` rather than
 * anything about provisioning: a later capability — a reset hook, a conformance check — ships in
 * the same package behind the same handshake, and populace should have to ask once.
 *
 * populace reads it before anything else so an old kit against a new populace is a sentence the
 * reader can act on ("your @populace/tdk is older than this populace expects") rather than a
 * mystery 400 halfway through a run.
 */
export const TDK_CONTRACT_VERSION = 1;

export const HandshakeSchema = z.object({
  tdk: z.number().int().positive(),
  /** `development`, `test`, `production` — whatever the app calls where it is running. */
  environment: z.string().min(1),
  /** What this mount can actually do, by name. Honest: see `capabilitiesOf`. */
  capabilities: z.record(z.string(), z.boolean()),
});
export type Handshake = z.infer<typeof HandshakeSchema>;

export function handshake(environment: string, capabilities: Record<string, boolean>): JsonObject {
  return { tdk: TDK_CONTRACT_VERSION, environment, capabilities };
}
