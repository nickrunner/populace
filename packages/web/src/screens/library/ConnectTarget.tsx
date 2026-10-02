import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { StoredTargetView, TargetInput } from "@populace/contract";
import { api, type FirstContact, type SignInStatus, type TargetCheck } from "../../api.js";
import { useThen } from "../../builders.js";
import { useProject } from "../../context.jsx";
import { plural } from "../../format.js";
import { keys, q } from "../../queries.js";
import {
  EMPTY_IDENTITY,
  identityDraftFrom,
  identityDraftFromCheck,
  identityFrom,
  identitySoFar,
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
 * and the dashboard's since-removed first-run panel had a second, better one that guessed the
 * identity strategy from the check. Two different target-creation UIs were reachable from the
 * same screen. This is the second one, promoted and finished; `Target.tsx` keeps the saved-target
 * editor and loses its branch, and the studies dashboard's "What needs doing" row for a missing
 * target leads here (ADR-0043, D7).
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
 *
 * **Connecting IS creating, and the page survives a refresh** (ADR-0040). Everything here used to
 * live in component state until Save, and a reload took all of it. The losses were not equal: an
 * address costs twenty seconds to retype, and the provisioning secret costs the reader their own
 * endpoint — it is generated in this browser, shown once, and pasted into their app's
 * environment, so after a refresh the app holds a credential populace has never seen and cannot
 * reproduce, and the endpoint refuses populace forever for a reason nothing on screen can
 * explain. **Never show somebody a secret you have not stored.** So a check that gets through
 * saves the target then and there, the id goes in the URL, a reload reads the row back, and the
 * secret is written the moment it is made rather than at Save. Save becomes "finish", and until
 * it is pressed the row honestly says `undecided`.
 *
 * **It is the one builder that saves at the start, and it chains anyway** (ADR-0043). The study
 * builder with no target to pick sends the reader here with `?then=`, and the row a check writes
 * is what they came for — so from the moment it exists, "Go back to the study" is offered, and it
 * returns with `?picked=<id>` so the study takes it. The `then` rides in the URL beside `t`, and
 * the write that puts `t` there must not drop it.
 */

/**
 * Which of this screen's three writes a save is. They differ only in what has to be SAID when one
 * fails: a target that would not save and a secret that was shown and not stored are the same
 * HTTP error and are not remotely the same news.
 */
type Keeping = "connected" | "secret" | "finish";

export function ConnectTarget() {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const navigate = useNavigate();
  /**
   * The target this page is about, in the URL, because the URL is the only part of a screen that
   * survives a refresh (ADR-0040). Connecting writes a target now, and a reader who reloads has to
   * come back to the row they made rather than to a blank form beside an app that is already
   * holding a secret populace would no longer have.
   */
  const [params, setParams] = useSearchParams();
  const openOn = params.get("t");
  /** Where the reader came from, when it was another builder; the target's own page otherwise. */
  const { returnTo, fromBuilder } = useThen();

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
  /** One is stored on the row and will never be sent back down, so the field says so and stays empty. */
  const [bearerStored, setBearerStored] = useState(false);
  const [name, setName] = useState("");
  const [check, setCheck] = useState<TargetCheck | null>(null);
  /** The row, once there is one — written by the first check that got through, not by Save. */
  const [saved, setSaved] = useState<StoredTargetView | null>(null);
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

  /**
   * The row this page already made, read back after a reload.
   *
   * Everything comes back except the two credentials, which go up and never come down: the
   * endpoint's bearer arrives as `authenticated` and the provisioning secret as `secretSet`. That
   * asymmetry is the rule and it does not bend here — what the screen owes the reader instead is
   * to say plainly that the stored secret cannot be shown again.
   */
  const reload = useQuery({ ...q.target(key, openOn ?? ""), enabled: openOn !== null });
  /**
   * The row this form has already been filled from. Without it the invalidation that follows every
   * save would re-hydrate the form out from under whoever is typing in it.
   */
  const filled = useRef<string | null>(null);
  useEffect(() => {
    const row = reload.data;
    if (!row || filled.current === row.id) return;
    filled.current = row.id;
    setSaved(row);
    setUrl(row.mcp[0]?.url ?? "");
    setBearerStored(row.mcp[0]?.authenticated ?? false);
    setName(row.name);
    setIdentity(identityDraftFrom(row.identity));
    setContact(row.firstContact);
  }, [reload.data]);

  /**
   * Every write this screen makes, which is three: the target the check creates, the provisioning
   * secret the moment it is generated, and the answer the reader finishes with.
   *
   * One mutation and not three, because they differ only in what they carry — the address, the
   * name and the token are the same fields in all three, and three copies of that body is three
   * places for them to drift. `why` is what the failure message branches on: "populace could not
   * store the secret it just showed you" and "it was not saved" are the same HTTP error and very
   * different sentences.
   */
  const keep = useMutation({
    mutationFn: (what: { identity: TargetInput["identity"]; name?: string; why: Keeping }) =>
      api.saveTarget(key, saved?.id ?? null, {
        name: (what.name ?? name).trim() || hostOf(url),
        mcp: [{ name: "default", url, ...(bearer === "" ? {} : { bearerToken: bearer }) }],
        identity: what.identity,
      }),
    onSuccess: async (target) => {
      // Marked filled BEFORE the invalidation below, which refetches the very row this came from.
      filled.current = target.id;
      setSaved(target);
      if (target.mcp[0]?.authenticated) setBearerStored(true);
      // Set on the params that are there, not in place of them: `then` is how this page knows
      // to offer the way back to the study, and replacing the whole query would drop it.
      if (openOn !== target.id) {
        setParams(
          (prev) => {
            prev.set("t", target.id);
            return prev;
          },
          { replace: true },
        );
      }
      // The targets list is what a study builder picks from, and it is invalidated BEFORE the
      // reader can go back so that `picked` finds the new row waiting (ADR-0043). The overview
      // and the setup needs count targets too. Specific keys, never a bare invalidation.
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.targets(key) }),
        queries.invalidateQueries({ queryKey: keys.target(key, target.id) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.setup(key) }),
      ]);
    },
  });

  /**
   * Ask the endpoint what it can do — and, when it answers, keep it.
   *
   * **A successful check IS the connection, so it is also the creation** (ADR-0040). The screen is
   * called "Connect a target"; everything after this point — what to call it, how people get
   * accounts — is configuration of something that now exists. What made this urgent was not the
   * retyping: it is that the next thing the reader may do is generate a provisioning secret and
   * paste it into their own app, and a secret populace has shown and not stored is a lock-out
   * nothing on screen can explain. There has to be a row to store it on, and this is where it
   * comes from.
   *
   * A check that did NOT get through still writes nothing. The address is the reader's to fix and
   * there is no evidence yet that there is anything at the end of it.
   */
  const ask = useMutation({
    mutationFn: () =>
      api.checkDraftTarget(key, {
        mcp: [{ name: "default", url, ...(bearer === "" ? {} : { bearerToken: bearer }) }],
        // Which row's stored token to reuse, for a check after a reload: the form no longer holds
        // the bearer it sent, because a credential never comes back down.
        ...(saved === null ? {} : { target: saved.id }),
      }),
    onSuccess: (result) => {
      setCheck(result);
      if (result.signIn) setSignedIn(result.signIn);
      if (!result.ok) return;
      // The guess fills an UNANSWERED question and never overwrites an answer. It used to replace
      // the draft outright, which was harmless while the draft was thrown away on every reload and
      // is not now: a second check would have reset a chosen way in — and the provisioning address
      // beside a secret already stored — back to nothing.
      const guessed = identity.strategy === "undecided" ? identityDraftFromCheck(result.identity) : identity;
      if (guessed !== identity) setIdentity(guessed);
      // The server's own name for itself is the best default there is, and the host is the
      // honest fallback. Only ever a DEFAULT — the field below is the reader's.
      const called = name.trim() || result.server?.name || hostOf(url);
      if (called !== name) setName(called);
      // `identitySoFar`, not `identityFrom`: this write happens before the question is answered,
      // and `undecided` is how the row says so honestly rather than being dressed as `none`.
      keep.mutate({ identity: identitySoFar(guessed), name: called, why: "connected" });
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
   * The secret, written the moment populace makes it.
   *
   * This is the rule the whole change exists for: never show somebody a secret you have not
   * stored. `TdkSetup` prints it in a block captioned "paste this into your app's environment", so
   * the instant it is on screen the reader's app may be about to accept only that value — and the
   * only copy populace had used to be a React state variable. It holds the generation back until
   * this can succeed, which is why there is always an address and always a row by the time it
   * fires.
   */
  const rememberSecret = (secret: string): void => {
    keep.mutate(
      {
        identity: { strategy: "provision-url", url: identity.provisionUrl, secret, emailDomain: identity.emailDomain || "populace.test" },
        why: "secret",
      },
      {
        onSuccess: () => {
          setIdentity((d) => ({ ...d, provisionSecretSet: true }));
        },
      },
    );
  };

  const contacting = useMutation({
    mutationFn: () => api.firstContact(key, saved?.id ?? ""),
    onSuccess: async (result) => {
      setContact(result);
      // First contact is stored on the row and summarised on the overview's target list.
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.targets(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.setup(key) }),
      ]);
    },
  });

  const result = check;
  /** Something is on screen to configure: a check came back, or a row was read on the way in. */
  const found = result !== null || saved !== null;
  /** The last question has an answer and the row carries it. Until then the target is unfinished. */
  const finished = saved !== null && saved.identity.strategy !== "undecided";
  /** What is keeping Save at a bound, in the reader's words, or null when nothing is. */
  const missing = name.trim() === "" ? "a name" : whatIdentityNeeds(identity);
  /** Which write failed and with what, or null. Both halves, because both are needed to say it. */
  const failure = keep.error;
  const failedAt = keep.isError ? keep.variables?.why : undefined;

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Connect a target"
          lede="An address your product answers on. Dev and qa are two targets in one project, not two projects — a study names the one it visits."
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
              stored={bearerStored}
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
                pending={ask.isPending || (keep.isPending && keep.variables?.why === "connected")}
                disabled={ask.isPending || url === ""}
                aria-describedby={ask.isError ? checkErrorId : undefined}
              >
                Check
              </Button>
            </Inline>

            {ask.isError ? (
              <WhatWentWrong
                id={checkErrorId}
                says={saved === null ? "Nothing was saved, and nobody has been sent anywhere." : "Nobody has been sent anywhere, and nothing about the saved target changed."}
                error={ask.error}
              />
            ) : null}

            {result === null ? null : result.ok ? (
              <Stack gap={1}>
                {signedIn?.connected ? (
                  <Text size="read-sm" tone="soft" as="p">
                    Signed in as you{signedIn.resourceName ? ` to ${signedIn.resourceName}` : ""}
                    {signedIn.renewable ? ", and it will stay signed in" : ", until that session expires"}. That
                    is how populace reads this list. The people a study sends need accounts of
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
              <WouldNotAnswer reached={result.reached} errors={result.errors} url={url} kept={saved !== null} />
            )}

            {/*
              Said here, under the check, because this is the moment it becomes true: the reader
              has a row, and everything from here on is theirs whatever the browser does. It is
              also the honest place to say that the target exists before it is finished — a
              half-answered target shows up in the targets list saying so.
            */}
            {saved === null ? null : (
              <Text size="read-sm" tone="soft" as="p">
                Kept as {saved.name}. Reload this page and it will still be here — and so will the
                provisioning secret below, if you make one.
                {/*
                  Offered from the moment there is a row, because the row is what the study
                  builder sent the reader here for (ADR-0043). It goes back with this target
                  picked; the open question below can be answered on the target itself later,
                  and the study's own page says so while it is.
                */}
                {fromBuilder ? (
                  <>
                    {" "}
                    <Link to={returnTo(saved.id, href(`library/targets/${encodeURIComponent(saved.id)}`))} size="read-sm">
                      Go back to the study
                    </Link>
                    {finished ? "" : " — it will take this target as it is, and the open question below can be answered later."}
                  </>
                ) : null}
              </Text>
            )}
            {failure !== null && failedAt === "connected" ? (
              <WhatWentWrong
                says="It answered, but populace could not keep it. Nothing below has anywhere to be stored yet — press Check again."
                error={failure}
              />
            ) : null}
          </Stack>
        </Section>

        {!found ? null : (
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

        {!found ? null : (
          <Section title="How will they get in?">
            <Stack gap={4}>
              <Text size="read-sm" tone="soft" as="p">
                Not the sign-in above — that one is yours, and it is how populace reads this tool
                list. This is how the people a study sends get accounts of their{" "}
                <em>own</em>, which is the whole point of sending them.
              </Text>
              {result === null ? null : <WhatTheCheckLearned check={result} gated={bearer.trim() !== "" || bearerStored} />}
              <Card>
                <WaysIn
                  draft={identity}
                  onChange={(patch) => setIdentity((d) => ({ ...d, ...patch }))}
                  check={result}
                  targetId={saved?.id ?? null}
                  onSecretGenerated={rememberSecret}
                />
              </Card>
              {/*
                The loudest failure on this screen, and the only one that is about a credential. If
                the write of a generated secret failed, the reader is looking at a value populace
                does not have — so the sentence tells them not to use it, rather than reporting a
                save that did not happen.
              */}
              {failure !== null && failedAt === "secret" ? (
                <WhatWentWrong
                  says="populace made that secret and could NOT store it. Do not paste it into your app yet — if you do and this page is reloaded, your endpoint will accept a credential populace no longer has. Press Check again, or reload and start with a fresh one."
                  error={failure}
                />
              ) : null}
              {whatIdentityWillNotDo(identity) === null ? null : (
                <FieldWarning>{whatIdentityWillNotDo(identity)}</FieldWarning>
              )}
              <Text size="read-sm" tone="soft" as="p">
                All of this can be changed later on the target itself.
              </Text>

              {/*
                Always here, in every state, which it was not before. It used to vanish the moment
                the target was saved — harmless while a reload emptied the form, and a trap now
                that a reload brings back a finished target with every field editable: the reader
                would have changed the way in and had nowhere to put it.
              */}
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
                      const chosen = identityFrom(identity);
                      // Unreachable while the button is at a bound, which swallows the press.
                      // Kept so that a future caller cannot make this the site that writes an
                      // `undecided` row while telling the reader it finished one.
                      if (chosen === null) return;
                      keep.mutate({ identity: chosen, why: "finish" });
                    }}
                    pending={keep.isPending && keep.variables?.why === "finish"}
                    atBound={missing !== null}
                    disabled={keep.isPending}
                    aria-describedby={missing === null ? undefined : missingId}
                  >
                    {saved === null ? "Save this target" : finished ? "Save changes" : "Finish this target"}
                  </Button>
                  {finished ? (
                    <Text size="read-sm" tone="soft">
                      Finished, and saved as {saved.name}.
                    </Text>
                  ) : null}
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
                {result !== null && !result.ok ? (
                  <Text size="read-sm" tone="soft" as="p">
                    Nothing has confirmed this address answers yet. Saving it anyway is fine —
                    the check, and one person through the front door, are both offered again on
                    the target itself.
                  </Text>
                ) : null}
              </Stack>

              {failure !== null && failedAt === "finish" ? <WhatWentWrong says="It was not saved." error={failure} /> : null}
            </Stack>
          </Section>
        )}

        {!finished ? null : (
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
              {/*
                The way out, and which one is primary depends on where the reader came from: a
                study builder that sent them here gets them back with this target picked
                (ADR-0043); anybody else opens the target they just made.
              */}
              <Inline gap={3} align="center">
                {fromBuilder ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      void navigate(returnTo(saved.id, href(`library/targets/${encodeURIComponent(saved.id)}`)));
                    }}
                  >
                    Go back to the study
                  </Button>
                ) : null}
                <Button
                  variant={fromBuilder ? "secondary" : "primary"}
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
  kept,
}: {
  reached: TargetCheck["reached"];
  errors: string[];
  url: string;
  /** A row already exists, so "nothing was saved" would be false (ADR-0040). */
  kept: boolean;
}) {
  const says = reached?.says ?? null;
  // The one clause that changes once connecting writes a target. Everything a failed check says
  // about the ADDRESS is unchanged; what it must not go on claiming is that there is no row.
  const wrote = kept ? "The target you already connected is untouched." : "Nothing was saved.";
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
            Either the address is wrong or the server is not running. {wrote}
          </Text>
        </>
      ) : (
        <>
          <Text size="read" tone="critical" as="p">
            It answered, and then the connection failed.
          </Text>
          <Text size="read-sm" tone="soft" as="p">
            The address is right enough to reach something that speaks MCP, so this is the server
            itself refusing. Its own words are below. {wrote}
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
 * and it is what populace connects with to read a tool list. It is not how the people a study
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
          populace can read the tool list. The people a study sends need accounts of their
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
