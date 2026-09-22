import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api, type FirstContact, type TargetCheck } from "../../api.js";
import { useProject } from "../../context.jsx";
import { plural } from "../../format.js";
import {
  Button,
  Card,
  DocumentPage,
  Field,
  FieldGrid,
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
  const checkErrorId = useId();

  /** Ask the endpoint what it can do. Nothing is written; the address stays the reader's to fix. */
  const ask = useMutation({
    mutationFn: () => api.checkDraftTarget(key, { mcp: [{ name: "default", url }] }),
    onSuccess: (result) => {
      setCheck(result);
      // The server's own name for itself is the best default there is, and the host is the
      // honest fallback. Only ever a DEFAULT — the field below is the reader's.
      if (result.ok && name === "") {
        setName(result.server?.name || hostOf(url));
      }
    },
  });

  /**
   * Save it. The identity strategy comes from the check rather than from a form: `signupTool`,
   * `tokenPath`, `userIdPath` and `teardownTool` are all guesses made from the tool list, and a
   * reader who has not seen that list cannot make them.
   */
  const save = useMutation({
    mutationFn: () => {
      const guessed = check?.identity;
      return api.saveTarget(key, null, {
        name: name.trim() || hostOf(url),
        mcp: [{ name: "default", url }],
        identity:
          guessed === undefined || guessed.signupTool === null
            ? { strategy: "self-signup", signupTool: "", tokenPath: "token", emailDomain: "populace.test" }
            : {
                strategy: "self-signup",
                signupTool: guessed.signupTool,
                tokenPath: guessed.tokenPath ?? "token",
                ...(guessed.userIdPath === null ? {} : { userIdPath: guessed.userIdPath }),
                ...(guessed.teardownTool === null ? {} : { teardownTool: guessed.teardownTool }),
                emailDomain: "populace.test",
              },
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

              {saved === null ? (
                <Inline gap={3} align="center">
                  <Button
                    variant="primary"
                    onClick={() => {
                      save.mutate();
                    }}
                    pending={save.isPending}
                    disabled={save.isPending || name.trim() === ""}
                  >
                    Save this target
                  </Button>
                </Inline>
              ) : (
                <Text size="read" as="p">
                  Saved as {saved.name}.
                </Text>
              )}

              {save.isError ? (
                <WhatWentWrong says="It was not saved." error={save.error} />
              ) : null}
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
