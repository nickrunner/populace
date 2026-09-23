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
  SecretField,
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
  /**
   * The ADDRESS's own credential, not a person's (ADR-0036's last open bullet).
   *
   * A server gated by a plain bearer with no OAuth to discover could not be connected at all: the
   * check posted no token, failed, and everything below — the identity section, the Save button —
   * rendered only behind a check that had succeeded. The one field that would have fixed it lived
   * on the saved-target editor, which is reachable only for a target that already exists. It is
   * here now, beside the address it belongs to, and it goes up with both the check and the save.
   */
  const [bearer, setBearer] = useState("");
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
  /** Named by the Save button while it is at a bound, so the reason is reachable from it. */
  const missingId = useId();

  /** Ask the endpoint what it can do. Nothing is written; the address stays the reader's to fix. */
  const ask = useMutation({
    mutationFn: () => api.checkDraftTarget(key, { mcp: [{ name: "default", url, ...(bearer === "" ? {} : { bearerToken: bearer }) }] }),
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
      return api.saveTarget(key, null, {
        name: name.trim() || hostOf(url),
        mcp: [{ name: "default", url, ...(bearer === "" ? {} : { bearerToken: bearer }) }],
        identity: chosen,
      });
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
  /** What is keeping Save at a bound, in the reader's words, or null when nothing is. */
  const missing = name.trim() === "" ? "a name" : whatIdentityNeeds(identity);

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

            <SecretField
              label="A token this address needs"
              stored={false}
              value={bearer}
              onChange={setBearer}
              hint="Only for an address behind a static token — a QA gateway, an internal proxy. Every person uses it. If it publishes an OAuth sign-in instead, leave this empty and press Check."
            />

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
              <WouldNotAnswer reached={result.reached} errors={result.errors} url={url} />
            )}
          </Stack>
        </Section>

        {result === null ? null : (
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

        {result === null ? null : (
          <Section title="How will they get in?">
            <Stack gap={4}>
              <Text size="read-sm" tone="soft" as="p">
                Not the sign-in above — that one is yours, and it is how populace reads this tool
                list. This is how the people a simulation sends get accounts of their{" "}
                <em>own</em>, which is the whole point of sending them.
              </Text>
              <WhatTheCheckLearned check={result} gated={bearer.trim() !== ""} />
              <Card>
                <WaysIn
                  draft={identity}
                  onChange={(patch) => setIdentity((d) => ({ ...d, ...patch }))}
                  check={result}
                />
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
                    {/*
                      At a bound, not natively disabled (DESIGN-SYSTEM §6): the reason is a
                      sentence right below and `aria-describedby` is what makes it reachable from
                      the control rather than only findable by looking.
                    */}
                    <Button
                      variant="primary"
                      onClick={() => {
                        save.mutate();
                      }}
                      pending={save.isPending}
                      atBound={missing !== null}
                      disabled={save.isPending}
                      aria-describedby={missing === null ? undefined : missingId}
                    >
                      Save this target
                    </Button>
                  </Inline>
                  {/*
                    Said here rather than sent to the server and rendered back as a schema error.
                    A reader who never chose self-signup should not be told what is too small
                    about `identity.signupTool`. The name counts too: a control at a bound names
                    what would release it, and "nothing happens when I press it" is the failure
                    that rule exists to prevent (DESIGN-SYSTEM §6).
                  */}
                  {missing === null ? null : (
                    <Text size="read-sm" tone="soft" as="p" id={missingId}>
                      It still needs {missing}.
                    </Text>
                  )}
                  {/*
                    A check that did not get through is no longer a wall. An address behind a
                    static token, or one that is simply not up yet, is a target worth saving — the
                    editor is where it gets fixed, and it is only reachable once it exists.
                  */}
                  {result.ok ? null : (
                    <Text size="read-sm" tone="soft" as="p">
                      Nothing has confirmed this address answers yet. Saving it anyway is fine —
                      the check, and one person through the front door, are both offered again on
                      the target itself.
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
                {identity.strategy === "none"
                  ? "One connection, one read-only call, with whatever the address itself carries — nobody is signed up. No model is called, so this costs nothing."
                  : "One person, one account, one read-only call. No model is called, so this costs nothing — and it is the difference between finding out now and finding out after forty people have been cast."}
              </Text>
              <Card>
                <FirstContactPanel
                  saved
                  makesAnAccount={identity.strategy !== "none"}
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
 * What the check learned about getting an account here, said before the options are offered.
 *
 * There was one sentence here and it had three errors in it: *"Nothing in the tool list looks
 * like a sign-up, so they cannot make their own accounts here. The other two ways both need
 * something from you."* The count was wrong — there were four ways and there are five now. The
 * framing was wrong: "something from you" is true of every option including the recommended one.
 * And the implication was wrong: a product whose accounts are not made through an MCP tool is the
 * ordinary case, not a problem the reader has to work around.
 *
 * So it branches on what the check ACTUALLY learned, which is two facts it has had all along and
 * never used together: whether a sign-up tool is on the list, and whether the address talked to
 * strangers at all. A server that answered anonymously and has no sign-up might genuinely have no
 * users; one that is gated certainly has some, and somebody will have to make them.
 */
function WhatTheCheckLearned({ check, gated }: { check: TargetCheck; gated: boolean }) {
  // Nothing to say about a tool list nobody got. "Nobody can sign up here" is not a thing to
  // conclude from a server that did not answer.
  if (!check.ok) return null;
  if (check.identity.signupTool !== null) return null;
  // Gated either because it refused strangers and we signed in, or because the reader put a token
  // on the address themselves. Both mean the same thing here: this product has users.
  const closed = check.signIn !== null || gated;
  return (
    <Text size="read-sm" tone="soft" as="p">
      {closed
        ? "Nothing here looks like a sign-up, so nobody can make their own account. Whoever runs this app will have to make them — the recommended way is the first one below."
        : "Nothing here looks like a sign-up, and this server answered without asking who we were. If it has no users at all, say so below and nobody will be signed up. If it does, your app will have to make them."}
    </Text>
  );
}

/**
 * The check did not get through, and which of the ways it did not is the whole message.
 *
 * There was one sentence here — "Could not reach it" — over four different situations, with the
 * machine's own words printed underneath in full. For a mistyped path that meant a reader was
 * shown a twelve-line HTML document from a router, whose one useful line was `Cannot POST /mpc`,
 * and a sentence that told them to check an address that was very nearly right.
 *
 * Each branch below says what was found and what to do about it. The target's words are still
 * shown, because a machine's own account of itself is evidence and paraphrasing it would be
 * worse — but reduced to the part a person can read.
 */
function WouldNotAnswer({
  reached,
  errors,
  url,
}: {
  reached: TargetCheck["reached"];
  errors: string[];
  url: string;
}) {
  const says = reached?.says ?? null;
  return (
    <Stack gap={2}>
      {reached?.kind === "not-mcp" ? (
        <>
          <Text size="read" tone="critical" as="p">
            Something answered at {hostOf(url)}, but not as an MCP server.
          </Text>
          <Text size="read-sm" tone="soft" as="p">
            The address is the MCP endpoint itself, not the product&rsquo;s home page — most servers
            answer on a path like <Mono size="code-sm">/mcp</Mono>. Check the path and the port.
          </Text>
        </>
      ) : reached?.kind === "nothing" ? (
        <>
          <Text size="read" tone="critical" as="p">
            Nothing answered at {hostOf(url)}.
          </Text>
          <Text size="read-sm" tone="soft" as="p">
            Either the address is wrong or the server is not running. Nothing was saved.
          </Text>
        </>
      ) : (
        <>
          <Text size="read" tone="critical" as="p">
            It answered, and then the connection failed.
          </Text>
          <Text size="read-sm" tone="soft" as="p">
            The address is right enough to reach something that speaks MCP, so this is the server
            itself refusing. Its own words are below. Nothing was saved.
          </Text>
        </>
      )}
      {says === null ? (
        errors.length === 0 ? null : <PayloadBlock caption="What came back" value={errors.join("\n")} error />
      ) : (
        <PayloadBlock caption="What came back" value={says} error />
      )}
    </Stack>
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
