import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api, type FirstContact, type SignInStatus, type TargetCheck } from "../../api.js";
import { useProject } from "../../context.jsx";
import { plural } from "../../format.js";
import {
  EMPTY_IDENTITY,
  identityDraftFromCheck,
  identityFrom,
  WaysIn,
  whatIdentityNeeds,
  whatIdentityWillNotDo,
  type IdentityDraft,
} from "./ways-in.js";
import {
  Button,
  Card,
  DocumentPage,
  Field,
  FieldGrid,
  FieldWarning,
  FirstContactPanel,
  Inline,
  Input,
  Link,
  Mono,
  PageHeader,
  PayloadBlock,
  Section,
  Stack,
  Text,
  ToolName,
  WhatWentWrong,
} from "../../design/index.js";

/**
 * Connecting a target, as a flow rather than a form — the first thing most people do in a project.
 *
 * **Why it is its own screen.** Connecting is the one step that can fail for reasons outside
 * populace: the endpoint does not answer, the bearer is wrong, there is no sign-up tool, the tool
 * list does not cover what the marketing page promises. That is also why it goes FIRST in the
 * product's order — `POST /targets/check` and `/first-contact` find all of it out for free, and
 * discovering it after casting forty people is the wrong way round.
 *
 * It was two places before this. `Target.tsx` had a `:t === "new"` branch — the full editor, every
 * field at once, including identity fields nobody can fill in before they have seen a tool list —
 * and `FirstRun`'s step 1 had a second, better one that guessed the identity strategy from the
 * check. Two different target-creation UIs were reachable from the same screen. This is the
 * second one, promoted and finished; `Target.tsx` keeps the saved-target editor and loses its
 * branch, and `FirstRun` step 1 links here.
 *
 * **The order is: ask nothing, then ask one thing.** Nothing is sent anywhere until Check is
 * pressed, and the address is still the reader's to fix if it fails. A check that succeeds IS the
 * connection — the tool list is what the identity fields are guessed from — so the form the reader
 * would not have been able to fill in arrives pre-filled and correctable.
 *
 * **First contact is offered, not forced.** It makes one real account against somebody else's
 * server, so it is a button and never a render (the same rule the rail and the dashboard band
 * keep). It costs no model spend, and the six outcome words are the product's most useful
 * sentence about a target, which is why it is offered here rather than left to be found.
 */
export function ConnectTarget() {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const navigate = useNavigate();

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [check, setCheck] = useState<TargetCheck | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const [contact, setContact] = useState<FirstContact | null>(null);
  const [signedIn, setSignedIn] = useState<SignInStatus | null>(null);
  /**
   * How the PEOPLE will get in — not the sign-in above, which is yours. Pre-filled from the tool
   * list when it turned up something that looks like a sign-up, and left unanswered when it did
   * not, because there is no honest default for a product whose accounts are not made over MCP.
   */
  const [identity, setIdentity] = useState<IdentityDraft>(EMPTY_IDENTITY);
  /** Set while the consent screen is open in another tab. Null the rest of the time. */
  const [waitingOn, setWaitingOn] = useState<string | null>(null);
  const checkErrorId = useId();

  /** Ask the endpoint what it can do. Nothing is written; the address stays the reader's to fix. */
  const ask = useMutation({
    mutationFn: () => api.checkDraftTarget(key, { mcp: [{ name: "default", url }] }),
    onSuccess: (result) => {
      setCheck(result);
      if (result.signIn) setSignedIn(result.signIn);
      if (result.ok) setIdentity(identityDraftFromCheck(result.identity));
      // The server's own name for itself is the best default there is, and the host is the
      // honest fallback. Only ever a DEFAULT — the field below is the reader's.
      if (result.ok && name === "") {
        setName(result.server?.name || hostOf(url));
      }
    },
  });

  /**
   * Sign in. The window is opened from inside the click handler that the user themselves made,
   * because a popup opened later — after the round trip — is a popup the browser blocks; the URL
   * is offered as a plain link underneath for when it blocks it anyway.
   */
  const signIn = useMutation({
    mutationFn: () => api.startSignIn(key, url),
    onSuccess: (result) => {
      setSignedIn(result.status);
      if (result.authorizeUrl === null) {
        // Already signed in: the grant we held was still good, and the check is the thing the
        // reader actually pressed a button for.
        ask.mutate();
        return;
      }
      window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
      setWaitingOn(result.authorizeUrl);
    },
  });

  /**
   * While the consent screen is open in the other tab, ask this one whether it has landed. There
   * is nothing to listen to — the tab that comes back is the server's page, not this app — so this
   * polls, and stops the moment it has an answer or the reader gives up on it.
   */
  const waiting = useRef(waitingOn);
  waiting.current = waitingOn;
  useEffect(() => {
    if (waitingOn === null) return;
    const timer = setInterval(() => {
      void api
        .signInStatus(key, url)
        .then((status) => {
          if (waiting.current === null || !status.connected) return;
          setSignedIn(status);
          setWaitingOn(null);
          ask.mutate();
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      clearInterval(timer);
    };
    // Keyed by the address being waited on, and nothing else: `ask` is a stable mutation object,
    // and putting it in here would restart the poll every time the check re-renders.
  }, [waitingOn, key, url]);

  /**
   * Save it. The identity strategy comes from the check rather than from a form: `signupTool`,
   * `tokenPath`, `userIdPath` and `teardownTool` are all guesses made from the tool list, and a
   * reader who has not seen that list cannot make them.
   */
  const save = useMutation({
    mutationFn: async () => {
      const chosen = identityFrom(identity);
      // The button is disabled while this is null, so reaching it means the two disagreed —
      // better to say which than to send a body the server will refuse in its own words.
      if (chosen === null) throw new Error("choose how the people get in before saving this target");
      return api.saveTarget(key, null, { name: name.trim() || hostOf(url), mcp: [{ name: "default", url }], identity: chosen });
    },
    onSuccess: async (target) => {
      await queries.invalidateQueries();
      setSaved({ id: target.id, name: target.name });
    },
  });

  const contacting = useMutation({
    mutationFn: () => api.firstContact(key, saved?.id ?? ""),
    onSuccess: async (result) => {
      setContact(result);
      await queries.invalidateQueries();
    },
  });

  const result = check;

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Connect a target"
          lede="An address your product answers on. Dev and qa are two targets in one project, not two projects — a simulation names the one it visits."
          crumbs={[{ label: "Targets", to: href("library/targets") }, { label: "Connect" }]}
        />
      }
    >
      <Stack gap={8}>
        <Section title="Its address">
          <Stack gap={3}>
            <Field label="Its MCP address" hint="Nothing is asked of it until you press Check.">
              {(ids) => (
                <Input
                  value={url}
                  onChange={setUrl}
                  placeholder="http://127.0.0.1:4310/mcp"
                  mono
                  id={ids.id}
                  describedBy={ids.describedBy}
                  invalid={ids.invalid}
                />
              )}
            </Field>

            <Inline gap={3} align="center">
              <Button
                variant="primary"
                onClick={() => {
                  ask.mutate();
                }}
                pending={ask.isPending}
                disabled={ask.isPending || url === ""}
                aria-describedby={ask.isError ? checkErrorId : undefined}
              >
                Check
              </Button>
            </Inline>

            {ask.isError ? (
              <WhatWentWrong
                id={checkErrorId}
                says="Nothing was saved, and nobody has been sent anywhere."
                error={ask.error}
              />
            ) : null}

            {result === null ? null : result.ok ? (
              <Stack gap={1}>
                {signedIn?.connected ? (
                  <Text size="read-sm" tone="soft" as="p">
                    Signed in as you{signedIn.resourceName ? ` to ${signedIn.resourceName}` : ""}
                    {signedIn.renewable ? ", and it will stay signed in" : ", until that session expires"}. That
                    is how populace reads this list. The people a simulation sends need accounts of
                    their own, which is the target&rsquo;s identity setting and comes later.
                  </Text>
                ) : null}
                <Text size="read" as="p">
                  {plural(result.tools.length, "tool")}
                  {result.identity.signupTool === null ? (
                    ", and nothing here looks like a sign-up, so nobody will have an account."
                  ) : (
                    <>
                      , and they sign up with <ToolName name={result.identity.signupTool} />.
                    </>
                  )}
                </Text>
                {result.undescribed.length > 0 ? (
                  <Text size="read-sm" tone="soft" as="p">
                    {result.undescribed.length === 1
                      ? "One of them has no description"
                      : `${result.undescribed.length} of them have no description`}
                    . People decide what to try from descriptions alone, so those will most likely
                    never be touched.
                  </Text>
                ) : null}
              </Stack>
            ) : result.signIn ? (
              <SignInNeeded
                status={result.signIn}
                pending={signIn.isPending}
                waitingOn={waitingOn}
                error={signIn.error}
                onSignIn={() => {
                  signIn.mutate();
                }}
                onGiveUp={() => {
                  setWaitingOn(null);
                }}
              />
            ) : (
              <Stack gap={2}>
                <Text size="read" tone="critical" as="p">
                  Could not reach it. Nothing was saved; the address is still yours to fix.
                </Text>
                {result.errors.length === 0 ? null : (
                  <PayloadBlock caption="What came back" value={result.errors.join("\n")} error />
                )}
              </Stack>
            )}
          </Stack>
        </Section>

        {result?.ok !== true ? null : (
          <Section title="What to call it">
            <Stack gap={4}>
              <Text size="read-sm" tone="soft" as="p">
                The name is how you will tell it apart from the others. Two endpoints of one
                product are usually its environments — <Mono size="code-sm">Stays — dev</Mono> and{" "}
                <Mono size="code-sm">Stays — qa</Mono>.
              </Text>
              <FieldGrid cols={2}>
                <Field label="Call it">
                  {(ids) => (
                    <Input
                      value={name}
                      onChange={setName}
                      id={ids.id}
                      describedBy={ids.describedBy}
                      invalid={ids.invalid}
                    />
                  )}
                </Field>
              </FieldGrid>

            </Stack>
          </Section>
        )}

        {result?.ok !== true ? null : (
          <Section title="How will they get in?">
            <Stack gap={4}>
              <Text size="read-sm" tone="soft" as="p">
                Not the sign-in above — that one is yours, and it is how populace reads this tool
                list. This is how the people a simulation sends get accounts of their{" "}
                <em>own</em>, which is the whole point of sending them.
              </Text>
              {result.identity.signupTool === null ? (
                <Text size="read-sm" tone="soft" as="p">
                  Nothing in the tool list looks like a sign-up, so they cannot make their own
                  accounts here. The other two ways both need something from you.
                </Text>
              ) : null}
              <Card>
                <WaysIn draft={identity} onChange={(patch) => setIdentity((d) => ({ ...d, ...patch }))} />
              </Card>
              {whatIdentityWillNotDo(identity) === null ? null : (
                <FieldWarning>{whatIdentityWillNotDo(identity)}</FieldWarning>
              )}
              <Text size="read-sm" tone="soft" as="p">
                All of this can be changed later on the target itself.
              </Text>

              {saved === null ? (
                <Stack gap={2}>
                  <Inline gap={3} align="center">
                    <Button
                      variant="primary"
                      onClick={() => {
                        save.mutate();
                      }}
                      pending={save.isPending}
                      disabled={save.isPending || name.trim() === "" || whatIdentityNeeds(identity) !== null}
                    >
                      Save this target
                    </Button>
                  </Inline>
                  {/*
                    Said here rather than sent to the server and rendered back as a schema error.
                    A reader who never chose self-signup should not be told what is too small
                    about `identity.signupTool`.
                  */}
                  {whatIdentityNeeds(identity) === null ? null : (
                    <Text size="read-sm" tone="soft" as="p">
                      It still needs {whatIdentityNeeds(identity)}.
                    </Text>
                  )}
                </Stack>
              ) : (
                <Text size="read" as="p">
                  Saved as {saved.name}.
                </Text>
              )}

              {save.isError ? <WhatWentWrong says="It was not saved." error={save.error} /> : null}
            </Stack>
          </Section>
        )}

        {saved === null ? null : (
          <Section title="Can anybody actually get in?">
            <Stack gap={4}>
              <Text size="read-sm" tone="soft" as="p">
                One person, one account, one read-only call. No model is called, so this costs
                nothing — and it is the difference between finding out now and finding out after
                forty people have been cast.
              </Text>
              <Card>
                <FirstContactPanel
                  saved
                  result={contact}
                  running={contacting.isPending}
                  error={contacting.error}
                  onRun={() => {
                    contacting.mutate();
                  }}
                />
              </Card>
              <Inline gap={3} align="center">
                <Button
                  variant="primary"
                  onClick={() => {
                    void navigate(href(`library/targets/${encodeURIComponent(saved.id)}`));
                  }}
                >
                  Open {saved.name}
                </Button>
                <Link to={href("library/targets")}>All targets</Link>
              </Inline>
            </Stack>
          </Section>
        )}
      </Stack>
    </DocumentPage>
  );
}

/**
 * The address answered, and it will not talk to strangers.
 *
 * This is a different outcome from "could not reach it" and it took its own branch for that
 * reason: one is an address to fix and the other is a door to knock on, and a screen that spelled
 * them the same way sent the reader to check their typing over a server that was working
 * perfectly. The sentence names the resource in its own words when it published a name.
 *
 * **It says whose sign-in this is, every time.** The credential this gets is the reader's own,
 * and it is what populace connects with to read a tool list. It is not how the people a simulation
 * sends get in — they are supposed to be strangers with accounts of their own — and the one place
 * that could be misread into "signed in, therefore ready to run" is right here.
 */
function SignInNeeded({
  status,
  pending,
  waitingOn,
  error,
  onSignIn,
  onGiveUp,
}: {
  status: SignInStatus;
  pending: boolean;
  waitingOn: string | null;
  error: Error | null;
  onSignIn: () => void;
  onGiveUp: () => void;
}) {
  const called = status.resourceName ?? hostOf(status.url);
  if (!status.supported) {
    return (
      <Stack gap={2}>
        <Text size="read" as="p">
          It answered, and it will not talk to strangers — but it does not publish where to sign
          in, so populace cannot do it for you.
        </Text>
        <Text size="read-sm" tone="soft" as="p">
          An address like this one needs a token you already hold, set on the target after it is
          saved. {status.error === null ? "" : `Looking for its sign-in said: ${status.error}`}
        </Text>
      </Stack>
    );
  }
  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <Text size="read" as="p">
          It answered, and it will not talk to strangers. {called} wants you to sign in.
        </Text>
        <Text size="read-sm" tone="soft" as="p">
          This signs in <em>you</em>, at {hostOf(status.authorizationServer ?? status.url)}, so
          populace can read the tool list. The people a simulation sends need accounts of their
          own — that is the target&rsquo;s identity setting, and it comes after this.
        </Text>
        {status.scopes.length === 0 ? null : (
          <Text size="read-sm" tone="soft" as="p">
            It will ask for {status.scopes.join(", ")}.
          </Text>
        )}
      </Stack>

      {waitingOn === null ? (
        <Inline gap={3} align="center">
          <Button variant="primary" onClick={onSignIn} pending={pending} disabled={pending}>
            Sign in to {called}
          </Button>
        </Inline>
      ) : (
        <Stack gap={1}>
          <Text size="read" as="p">
            Waiting for you to finish in the other tab.
          </Text>
          <Text size="read-sm" tone="soft" as="p">
            Nothing opened? <a href={waitingOn} target="_blank" rel="noreferrer">Open the sign-in
            page</a>, or <button type="button" onClick={onGiveUp}>stop waiting</button>.
          </Text>
        </Stack>
      )}

      {error === null ? null : (
        <WhatWentWrong says="The sign-in could not be started. Nothing was saved." error={error} />
      )}
    </Stack>
  );
}

/** The host, as an honest fallback name when the server does not offer one of its own. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // A URL the browser cannot parse is one `check` would already have refused; the raw string is
    // still better than an empty name, and the field above it is editable either way.
    return url;
  }
}
