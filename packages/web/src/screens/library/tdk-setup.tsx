import { useEffect, useId, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";

import { api, type ProvisioningCheck } from "../../api.js";
import { useProject } from "../../context.jsx";
import {
  Button,
  Code,
  Field,
  Inline,
  Link,
  PayloadBlock,
  Select,
  Stack,
  Text,
  WhatWentWrong,
} from "../../design/index.js";

/**
 * Mounting `@populace/tdk`, made as small as it can honestly be made (ADR-0038).
 *
 * The recommendation to use this way in is conditional on the integration being *simple*, and a
 * form asking for an address and a secret is not the integration — it is the last two fields of
 * it. What stands between a reader and a working endpoint is: knowing what to paste, inventing a
 * secret and getting it into two places, and finding out whether any of it worked. This panel is
 * those three things.
 *
 * **The secret is generated here, once, and it fills both places at the same time.** Asking a
 * reader to invent a shared secret and then paste it identically into a form and an environment
 * file is asking for a typo that presents, three screens later, as `unauthorized`. So populace
 * makes one — 32 bytes from the browser's own CSPRNG, which is a better secret than a human will
 * type — puts it in the field and prints it in the snippet. It is shown plainly because it has to
 * be copied; it is the app's from the moment it is pasted, and rotating it is one line.
 *
 * **The check is offered before Save.** `GET /` at the kit's mount point creates nobody and
 * registers nothing, which is precisely what ADR-0036's rule permits doing without a button
 * press being a write on somebody else's system — so the two fields most likely to be wrong can
 * be right in five seconds rather than at the end of a run.
 *
 * **Only the stacks the kit can actually serve are offered.** `Mounted` is an Express middleware
 * carrying `fetch` and `handle`, so those are the mounts: Express (and a bare Node server), a
 * platform `fetch` route handler (Next, Workers, Deno, Bun), and Hono. A fourth framework in the
 * picker would be a promise the package has not made.
 */

type Stack = "express" | "next" | "hono";

const STACKS: readonly { value: Stack; label: string }[] = [
  { value: "express", label: "Express, or a bare Node server" },
  { value: "next", label: "Next.js route handler" },
  { value: "hono", label: "Hono, Workers, Deno or Bun" },
];

/**
 * 32 bytes of the browser's own randomness, base64url.
 *
 * Long enough that a constant-time compare is the only interesting attack on it, and short enough
 * to sit on one line of an env file. `crypto.getRandomValues` is the one CSPRNG a browser has;
 * `Math.random` is not one and must never be reached for here, however throwaway the deployment.
 */
function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The three functions only the app can write, spelled the same way in every mount.
 *
 * **No ORM, and one comment per hook saying what goes there.** This is a block somebody pastes
 * into their own server, so a `db.users.create` is a guess about their stack that reads as an
 * instruction, and an invented `createUser()` is a function they will look for and not find. A
 * sentence naming the work is honest about the one thing the sample cannot know.
 *
 * What the fields MEAN, where they come from and what `attributes` is for are prose on this screen
 * and in TARGET-SETUP.md. They were comments here once; at the width this renders they wrapped
 * into thirty-six lines and the well folded the code away behind "show all".
 *
 * `refreshPerson` earns its three lines: a sample showing only `createPerson` teaches that a
 * session is made once and lasts forever, which is untrue of every token with an expiry on it.
 */
const HOOKS = `  async createPerson({ email, displayName, password }) {
    // Create the user in your system here, however you already do it,
    // then return their id and a token they can call your MCP server with.
    return { userId, bearerToken };
  },
  async refreshPerson({ userId }) {
    // Mint a fresh token for a user you already made.
    return { bearerToken };
  },
  async removePerson({ userId }) {
    // Delete the user. A sweep may call this twice, so make it safe to repeat.
  },`;

function snippetFor(stack: Stack): string {
  if (stack === "next") {
    return `// app/api/populace/[...tdk]/route.ts
import { populaceProvisioning } from "@populace/tdk";

const kit = populaceProvisioning({
  secret: process.env.POPULACE_SECRET,
  // A fetch handler is never told where it was mounted, so the kit is.
  basePath: "/api/populace",
${HOOKS}
});

export const GET = kit.fetch;
export const POST = kit.fetch;`;
  }
  if (stack === "hono") {
    return `import { populaceProvisioning } from "@populace/tdk";

const kit = populaceProvisioning({
  secret: process.env.POPULACE_SECRET,
  basePath: "/populace",
${HOOKS}
});

app.all("/populace", (c) => kit.fetch(c.req.raw));
app.all("/populace/*", (c) => kit.fetch(c.req.raw));`;
  }
  return `import { populaceProvisioning } from "@populace/tdk";

app.use("/populace", populaceProvisioning({
  secret: process.env.POPULACE_SECRET,
${HOOKS}
}));`;
}

export interface TdkSetupProps {
  /** The address the kit is mounted at, as typed. The check asks this one. */
  url: string;
  /** The secret as typed in the form. Empty and unstored means one has not been made yet. */
  secret: string;
  /** A secret is already held server-side, so nothing is generated and nothing is printed. */
  secretSet: boolean;
  /** Fills the form's own secret field. Called once, with a secret nobody has to invent. */
  onSecret: (secret: string) => void;
  /** A saved target, so the check can use the stored secret the form has never been shown. */
  targetId: string | null;
}

export function TdkSetup({ url, secret, secretSet, onSecret, targetId }: TdkSetupProps): ReactNode {
  const { key } = useProject();
  const [stack, setStack] = useState<Stack>("express");
  const [found, setFound] = useState<ProvisioningCheck | null>(null);
  /** Named by the button at a bound, so the reason is reachable from the control (§6). */
  const reasonId = useId();

  /**
   * One secret, made the moment this branch is open and empty.
   *
   * Guarded on `secretSet` as well as on the value: a saved target's secret is never sent to the
   * browser, so an ungated generator would silently replace a working secret with a new one every
   * time somebody opened the editor — and the app would then refuse populace with no change
   * anybody made on purpose.
   */
  useEffect(() => {
    if (secret === "" && !secretSet) onSecret(newSecret());
    // Runs on the transitions that matter — this branch becoming visible, and the secret being
    // cleared — and not on every keystroke elsewhere in the form.
  }, [secret, secretSet, onSecret]);

  const asking = useMutation({
    mutationFn: () => api.checkProvisioning(key, { url, ...(secret === "" ? {} : { secret }), ...(targetId === null ? {} : { target: targetId }) }),
    onSuccess: setFound,
  });

  return (
    <Stack gap={6}>
      <Stack gap={3}>
        <Field label="Where it goes in your app" hint="Fifteen lines. Everything else — the wire, the auth, the run tags, expiry, teardown, the dev-only guard — is the package.">
          {({ id, describedBy }) => (
            <Select
              id={id}
              describedBy={describedBy}
              value={stack}
              onChange={(v) => {
                setStack(STACKS.find((s) => s.value === v)?.value ?? "express");
              }}
              options={STACKS.map((s) => ({ value: s.value, label: s.label }))}
            />
          )}
        </Field>
        <Text size="read-sm" tone="soft" as="p">
          Install it with <Code inProse>npm i @populace/tdk</Code>, then:
        </Text>
        <PayloadBlock caption="Paste this into your app" value={snippetFor(stack)} />
        {/*
          What the sample deliberately does not say in comments. A paste block should be paste-able;
          the meaning belongs out here, where it can wrap without folding the code away.
        */}
        <Text size="read-sm" tone="soft" as="p">
          The three comments are your work — the rest is the package. populace invents the person
          and sends you who they are: <Code inProse>displayName</Code> is the name a
          screenshot will show, <Code inProse>email</Code> and <Code inProse>tag</Code> carry the
          run so a sweep can find them again, and <Code inProse>attributes</Code> holds whatever
          differs between one person and the next — a plan tier, a seat count — for a product that
          needs it.
        </Text>
        <Text size="read-sm" tone="soft" as="p">
          <Code inProse>refreshPerson</Code> is called when a token is about to go stale, never
          mid-visit. Leave it out and every session has to outlive the whole run.
        </Text>
        {secretSet && secret === "" ? (
          <Text size="read-sm" tone="soft" as="p">
            A secret is already stored for this target, so none has been made. Type a new one in
            the field below to rotate it, and change <Code inProse>POPULACE_SECRET</Code> in your app to
            match.
          </Text>
        ) : (
          <Stack gap={2}>
            <PayloadBlock caption="And this in your app's environment" value={`POPULACE_SECRET=${secret}`} />
            <Text size="read-sm" tone="soft" as="p">
              populace made that secret and it is now yours. It is the whole authority populace has
              over that endpoint — it can make and remove throwaway accounts on the deployment you
              mounted the kit in, and nothing else. Rotate it by changing those two places.
            </Text>
          </Stack>
        )}
      </Stack>

      <Stack gap={2}>
        <Inline gap={3} align="center">
          <Button
            variant="secondary"
            onClick={() => {
              asking.mutate();
            }}
            pending={asking.isPending}
            atBound={url.trim() === ""}
            aria-describedby={url.trim() === "" ? reasonId : undefined}
          >
            Check this endpoint
          </Button>
          <Text size="meta" tone="muted" id={reasonId}>
            {url.trim() === "" ? "Fill in the address above first." : "It asks the address what it can do. Nobody is made and nothing is saved."}
          </Text>
        </Inline>
        {asking.isError ? <WhatWentWrong says="populace could not ask. Nothing was saved." error={asking.error} /> : null}
        {found === null ? null : <WhatItSaid found={found} />}
      </Stack>

      <Text size="read-sm" tone="soft" as="p">
        The whole thing is written out in{" "}
        <Link href="https://github.com/nickrunner/populace/blob/main/docs/TARGET-SETUP.md" size="read-sm">
          setting up a target
        </Link>
        , including what to check when it does not answer.
      </Text>
    </Stack>
  );
}

/**
 * What the handshake found, in the register first contact uses: the product's sentence, and the
 * machine's own words in the one well beneath when there are any (DESIGN-SYSTEM §7.4).
 */
function WhatItSaid({ found }: { found: ProvisioningCheck }): ReactNode {
  return (
    <Stack gap={2}>
      <Text size="read" tone={found.outcome === "answered" ? "ink" : "critical"} as="p">
        {found.summary}
      </Text>
      {found.detail === null ? null : <PayloadBlock caption="What came back" value={found.detail} error />}
    </Stack>
  );
}
