import { ProvisionUrlProvider, TdkRefusal } from "@populace/adapters";
import type { ProvisioningCheck } from "@populace/contract";

/**
 * "Did I wire the kit up right?" — answered in a couple of seconds, before a target is saved and
 * before anybody is sent anywhere (ADR-0038).
 *
 * `ProvisionUrlProvider.describe()` is a `GET /` at the app's mount point, authenticated by the
 * shared secret. It creates nobody, registers nothing and lists nothing, which is exactly the
 * read-only check ADR-0036's rule was written to permit — so it can be offered beside the two
 * fields it checks rather than behind a save.
 *
 * The four outcomes are kept apart because they send the reader somewhere different: a wrong
 * address answers nothing, a wrong secret answers `unauthorized`, an app that mounted the kit in
 * production refuses every request including this one, and something that is not the kit answers
 * with a shape this cannot read. All four are already worded by the kit itself where the kit is
 * what answered, and its words are quoted rather than paraphrased.
 */
export async function checkProvisioning(url: string, secret: string | undefined): Promise<ProvisioningCheck> {
  if (secret === undefined || secret === "") {
    return {
      outcome: "refused",
      summary: "There is no secret to check with. Put the value your app reads as POPULACE_SECRET in the field above and ask again.",
      detail: null,
      tdk: null,
      environment: null,
      capabilities: null,
    };
  }
  // Built here and thrown away: the handshake is cached on the provider for a process, and a
  // cached answer is the wrong thing for a button whose whole purpose is "ask it again now".
  const provider = new ProvisionUrlProvider({ strategy: "provision-url", url, secret, emailDomain: "populace.test" });
  try {
    const handshake = await provider.describe();
    return {
      outcome: "answered",
      summary: sentenceFor(handshake),
      detail: null,
      tdk: handshake.tdk,
      environment: handshake.environment ?? null,
      capabilities: handshake.capabilities,
    };
  } catch (err) {
    // The kit's own refusals, carried with the code that says what a reader can do about it. Its
    // message is written to be shown to a human verbatim, so it is.
    if (err instanceof TdkRefusal) {
      return {
        outcome: err.code === "unknown" ? "not-a-kit" : "refused",
        summary:
          err.code === "unauthorized"
            ? "It answered, and the secret is not the one it expects. Check the value your app reads as POPULACE_SECRET against the field above."
            : err.code === "unknown"
              ? `Something answered at ${url}, but not as @populace/tdk. The address is the kit's mount point — the base it is mounted at, not a route under it.`
              : "It answered and refused.",
        detail: err.message,
        tdk: null,
        environment: null,
        capabilities: null,
      };
    }
    return {
      outcome: "unreachable",
      summary: `Nothing answered at ${url}. Either the address is wrong or the app is not running; nothing was saved and nobody was made.`,
      detail: err instanceof Error ? err.message : String(err),
      tdk: null,
      environment: null,
      capabilities: null,
    };
  }
}

/**
 * What it found, as one sentence.
 *
 * The capabilities are read out in the user's words rather than as three booleans, because
 * `teardown: false` is not a setting — it is the promise that a sweep will report accounts left
 * behind instead of claiming it removed them, and the reader should meet that here rather than
 * at the end of a run.
 */
function sentenceFor(handshake: { tdk: number; environment?: string | undefined; capabilities: { refresh: boolean; teardown: boolean; listByTag: boolean } }): string {
  const { refresh, teardown, listByTag } = handshake.capabilities;
  const can = [refresh ? "renew a session" : null, teardown ? "remove an account" : null, listByTag ? "list them again" : null].filter((s): s is string => s !== null);
  const cannot = [refresh ? null : "renew a session", teardown ? null : "remove an account", listByTag ? null : "list them again"].filter((s): s is string => s !== null);
  const where = handshake.environment === undefined ? "" : ` It says it is running in ${handshake.environment}.`;
  const does = can.length === 0 ? "It can make people and nothing else." : `It can ${join(can)}.`;
  const missing = cannot.length === 0 ? "" : ` It cannot ${join(cannot)} — populace will say so rather than pretend otherwise.`;
  return `Answered. It speaks TDK ${handshake.tdk}.${where} ${does}${missing}`;
}

function join(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}
