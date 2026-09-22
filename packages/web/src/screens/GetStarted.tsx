import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type TargetCheck } from "../api.js";
import { q } from "../queries.js";
import { useProject } from "../context.jsx";
import { people as peopleWord, plural } from "../format.js";
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  CostEstimate,
  costBasisOf,
  Field,
  FieldGrid,
  Inline,
  Input,
  Link,
  MetaLine,
  MetaSentence,
  Mono,
  NumberInput,
  PayloadBlock,
  Radio,
  RadioGroup,
  Spacer,
  Stack,
  Stepper,
  Text,
  ToolName,
  Tooltip,
  visitPlanOf,
  WhatWentWrong,
  WizardPanel,
  type WizardStep,
} from "../design/index.js";

/**
 * The zero state, and the only path into a first execution (SPEC §7.5).
 *
 * It is a panel on project home rather than a mode the product puts you in: nothing here is a
 * wizard you have to finish before the rest of the product exists, and every step is also
 * somewhere in the library. A step opens when the one above it is satisfied, and collapses to a
 * line carrying its own answer — so the page reads as "what is left" rather than as a form.
 *
 * Behind it, step 2 creates personas and cohorts and step 3 names the simulation. The user never
 * sees those words until they need them.
 *
 * **Ported to the design system** — ATOMIC-INVENTORY §6.3, row 15. `WizardPanel` owns everything
 * the screen used to hand-roll: the numbered spine, the tick, the collapse-to-a-line, the done
 * summary and the explicit `<h2>` this panel needs because it has no `<h1>` of its own. What went
 * with it: the local `Step` component, the `border-b border-rule` sections, the `px-5 pb-5`
 * padding arithmetic, the two `ChoiceCard` sizes hand-drawn as `<button>`s, the raw
 * `<input type="checkbox">`, and the `max-w-[560px]` / `max-w-[320px]` control widths.
 *
 * What the port was told to keep, and keeps: it is a panel and not a takeover, steps collapse to
 * lines, it never says persona, cohort or population, **nothing spends money until the last
 * step**, the estimate names its own basis, and the two mode cards — the best copy in the repo —
 * are here word for word, now as the two options of one `RadioGroup` (§6.3, row 15).
 */
export function GetStarted() {
  const { project, href } = useProject();
  const done = { target: project.counts.targets > 0, people: project.counts.people > 0 };

  /**
   * Which step is open. The natural one is the first unanswered step — which is how the panel
   * moves itself along as each mutation lands — and a reader who clicks a line back open holds
   * it until they click another. `openId` is a string, so "nothing open" has no spelling.
   */
  const natural = !done.target ? "target" : !done.people ? "people" : "send";
  const [chosen, setChosen] = useState<string | null>(null);
  const openId = chosen ?? natural;

  const steps: readonly WizardStep[] = [
    {
      id: "target",
      label: "Point at your app",
      done: done.target,
      // Only once it is answered, so the summary's own query is not a cost of opening the page.
      summary: done.target ? <TargetSummary /> : undefined,
      body: <ConnectStep />,
    },
    {
      id: "people",
      label: "Pick who visits it",
      done: done.people,
      summary: done.people
        ? `${peopleWord(project.counts.people)} across ${plural(project.counts.cohorts, "kind of person", "kinds of person")}`
        : undefined,
      body: <PickStep />,
    },
    {
      id: "send",
      label: "Send them in",
      done: false,
      body:
        done.target && done.people ? (
          <RunStep />
        ) : (
          <Text size="read" tone="muted" as="p">
            Pick who goes first.
          </Text>
        ),
    },
  ];

  return (
    <Stack gap={4}>
      <MetaSentence>
        Three things, and then people start visiting {project.name}. Nothing spends money until the
        last one.
      </MetaSentence>

      <WizardPanel title="Get started" steps={steps} openId={openId} onOpen={setChosen} />

      <MetaLine
        facts={[
          {
            key: "library",
            node: (
              <Link size="meta" to={href("library/personas")}>
                Or write your own person from scratch
              </Link>
            ),
          },
          {
            key: "permanence",
            node: "everything above is in the library afterwards, and nothing here is permanent",
          },
        ]}
      />
    </Stack>
  );
}

/**
 * The answer step 1 holds, on the line, once it has one: the app's name and where it lives.
 *
 * With SEVERAL targets it says how many instead of naming one. It used to render `items[0]`
 * unconditionally, and `listTargets` orders `updated_at DESC` — so a project with a dev and a qa
 * endpoint had a step-1 summary that named whichever was edited last and silently changed its
 * mind when the other was touched. Naming one of two is worse than naming neither.
 */
function TargetSummary() {
  const { key } = useProject();
  const targets = useQuery(q.targets(key));
  const items = targets.data?.items ?? [];
  const target = items[0];
  if (target === undefined) return null;
  if (items.length > 1) return <MetaLine facts={[{ key: "count", node: plural(items.length, "target") }]} />;
  return (
    <MetaLine
      facts={[
        { key: "name", node: target.name },
        { key: "endpoint", node: <Mono size="code-sm">{target.mcp[0]?.url}</Mono> },
      ]}
    />
  );
}

/** Step 1. One address and one button; what comes back is the tool list, which is the answer. */
function ConnectStep() {
  const { key } = useProject();
  const queries = useQueryClient();
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<TargetCheck | null>(null);
  const connectErrorId = useId();

  const connect = useMutation({
    mutationFn: async () => {
      const result = await api.checkDraftTarget(key, { mcp: [{ name: "default", url }] });
      setCheck(result);
      if (!result.ok) return null;
      // A check that succeeded IS the connection: the tool list is what the identity fields are
      // guessed from, and guessing them here saves a form nobody can fill in before they have it.
      return api.saveTarget(key, null, {
        name: result.server?.name || new URL(url).host,
        mcp: [{ name: "default", url }],
        identity:
          result.identity.signupTool === null
            ? { strategy: "self-signup", signupTool: "", tokenPath: "token", emailDomain: "populace.test" }
            : {
                strategy: "self-signup",
                signupTool: result.identity.signupTool,
                tokenPath: result.identity.tokenPath ?? "token",
                ...(result.identity.userIdPath === null ? {} : { userIdPath: result.identity.userIdPath }),
                ...(result.identity.teardownTool === null ? {} : { teardownTool: result.identity.teardownTool }),
                emailDomain: "populace.test",
              },
      });
    },
    onSuccess: async () => {
      await queries.invalidateQueries();
    },
  });

  return (
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
            connect.mutate();
          }}
          pending={connect.isPending}
          disabled={connect.isPending || url === ""}
          aria-describedby={connect.isError ? connectErrorId : undefined}
        >
          Check
        </Button>
      </Inline>

      {connect.isError ? (
        <WhatWentWrong
          id={connectErrorId}
          says="Nothing was saved, and nobody has been sent anywhere."
          error={connect.error}
        />
      ) : null}

      {check === null ? null : check.ok ? (
        <Stack gap={1}>
          <Text size="read" as="p">
            {plural(check.tools.length, "tool")}
            {check.identity.signupTool === null ? (
              ", and nothing here looks like a sign-up, so nobody will have an account."
            ) : (
              <>
                , and they sign up with <ToolName name={check.identity.signupTool} />.
              </>
            )}
          </Text>
          {check.undescribed.length > 0 ? (
            <Text size="read-sm" tone="soft" as="p">
              {check.undescribed.length === 1
                ? "One of them has no description"
                : `${check.undescribed.length} of them have no description`}
              . People decide what to try from descriptions alone, so those will most likely never
              be touched.
            </Text>
          ) : null}
        </Stack>
      ) : (
        <Stack gap={2}>
          <Text size="read" tone="critical" as="p">
            Could not reach it. Nothing was saved; the address is still yours to fix.
          </Text>
          {check.errors.length === 0 ? null : (
            <PayloadBlock caption="What came back" value={check.errors.join("\n")} error />
          )}
        </Stack>
      )}
    </Stack>
  );
}

/** Step 2. Six people who find different things; tick two or three and say how many of each. */
function PickStep() {
  const { key } = useProject();
  const queries = useQueryClient();
  const starters = useQuery(q.starters(key));
  const [picked, setPicked] = useState<Record<string, number>>({});
  const addErrorId = useId();

  const add = useMutation({
    mutationFn: async () => {
      for (const [slug, count] of Object.entries(picked)) await api.addStarter(key, slug, count);
    },
    onSuccess: async () => {
      await queries.invalidateQueries();
    },
  });

  const total = Object.values(picked).reduce((sum, n) => sum + n, 0);

  return (
    <Stack gap={4}>
      <Stack gap={3}>
        {(starters.data?.items ?? []).map((starter) => {
          const count = picked[starter.slug];
          return (
            <Inline key={starter.slug} gap={3} align="center">
              <Checkbox
                checked={count !== undefined}
                onChange={() => {
                  setPicked((current) =>
                    starter.slug in current
                      ? Object.fromEntries(Object.entries(current).filter(([slug]) => slug !== starter.slug))
                      : { ...current, [starter.slug]: 1 },
                  );
                }}
                label={starter.name}
                hint={`${starter.role} — ${starter.summary}`}
              />

              <Spacer />

              {count === undefined ? null : (
                <Stepper
                  value={count}
                  onChange={(v) => {
                    setPicked((p) => ({ ...p, [starter.slug]: v }));
                  }}
                  min={1}
                  label={`How many people like ${starter.name}`}
                />
              )}
            </Inline>
          );
        })}
      </Stack>

      {add.isError ? (
        <WhatWentWrong
          id={addErrorId}
          says="Nobody was added. The counts above are still yours to send again."
          error={add.error}
        />
      ) : null}

      <Inline gap={3} align="center" wrap>
        <Button
          variant="primary"
          onClick={() => {
            add.mutate();
          }}
          pending={add.isPending}
          disabled={add.isPending || total === 0}
          aria-describedby={add.isError ? addErrorId : undefined}
        >
          {total === 0 ? "Tick someone" : `Take these ${peopleWord(total)}`}
        </Button>
        <Text size="meta" tone="muted">
          Each of them gets a name and a life of their own, and they keep it between executions.
        </Text>
      </Inline>
    </Stack>
  );
}

/** Step 3. The mode, what it will cost, and the one button on this page that spends anything. */
function RunStep() {
  const { key, href } = useProject();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const setup = useQuery(q.setup(key));
  const simulationId = setup.data?.simulationIds[0]?.id ?? "";
  const estimate = useQuery({ ...q.estimate(key, simulationId), enabled: simulationId !== "" });
  const [name, setName] = useState("First look");
  const [visits, setVisits] = useState(4);
  const [bounded, setBounded] = useState(true);
  const goErrorId = useId();
  const blockersId = useId();

  const go = useMutation({
    mutationFn: async () => {
      const simulation = await api.saveSimulation(key, simulationId, { name: name.trim() || "First look", visitsPerPerson: bounded ? visits : null });
      const started = await api.startRun(key, simulation.slug, {});
      return { slug: simulation.slug, runId: started.runId };
    },
    onSuccess: async (started) => {
      await queries.invalidateQueries();
      void navigate(`${href()}/s/${encodeURIComponent(started.slug)}/live`);
    },
  });

  const blockers = setup.data?.blockers ?? [];
  const stopped = setup.data?.killSwitch.engaged ?? false;
  const reading = estimate.data;

  return (
    <Stack gap={4}>
      {/*
        The two mode cards, verbatim (§6.3 row 15). They were two hand-drawn <button> cards with
        their own border and wash; they are one named group of two options now, which is the same
        choice with a fieldset, a legend and arrow keys around it.
      */}
      <RadioGroup
        value={bounded ? "bounded" : "unbounded"}
        onChange={(v) => {
          setBounded(v === "bounded");
        }}
        name="visiting-mode"
        // The legend is drawn here and hidden on `New simulation`, which is one rule and not two
        // conventions: `legendHidden` is set exactly when a visible caption immediately above the
        // group already carries the same words. Nothing above this panel's group does. The words
        // themselves are now the same on both screens — one decision, one name (§7.1).
        legend="How they visit"
      >
        <Radio
          value="bounded"
          label="A few visits each, then stop"
          hint="Everyone arrives knowing nothing, makes a set number of visits and is finished. Run it again after a fix and the two runs are independent."
        />
        <Radio
          value="unbounded"
          label="Keep coming back until I stop it"
          hint="People remember what happened last time and build on it. It runs until you pause it, and it can be picked back up."
        />
      </RadioGroup>

      <FieldGrid cols={2}>
        <Field label="Call it">
          {(ids) => (
            <Input
              value={name}
              onChange={setName}
              placeholder="First look"
              id={ids.id}
              describedBy={ids.describedBy}
              invalid={ids.invalid}
            />
          )}
        </Field>

        {bounded ? (
          <Field label="Visits each">
            {(ids) => (
              <NumberInput
                value={visits}
                onChange={setVisits}
                min={1}
                id={ids.id}
                describedBy={ids.describedBy}
                invalid={ids.invalid}
              />
            )}
          </Field>
        ) : null}
      </FieldGrid>

      {/*
        The estimate, as the one organism that knows how to say it (§6.3 rows 4 and 15). This was
        one of four hand-rolled renderings with three phrasings of the basis sentence between them;
        the basis now reads the same word for word here, on `Preflight` and on `People`, and the
        range is left off because the reader is still typing the headcount and the visit count this
        figure is drawn around.
      */}
      {reading === undefined ? null : (
        <CostEstimate
          layout="sentence"
          people={reading.agents}
          plan={bounded ? { kind: "capped", each: visits } : visitPlanOf(reading, null)}
          basis={costBasisOf(reading)}
        />
      )}

      {/* Not `medium`: the four severity tokens mean severity and nothing else (§4.1), and a
          blocker is not a finding with a level — it is a precondition that has not been met. The
          word arrives in a `Badge`, as §4.2 asks of any state, and the list carries the id the
          button below names in `aria-describedby` so the two are attached rather than merely
          near each other. `Preflight` says the same thing the same way. */}
      {blockers.length === 0 ? null : (
        <div id={blockersId}>
          <Stack gap={2}>
            {blockers.map((blocker) => (
              <Inline key={blocker} gap={2} align="baseline">
                <Badge variant="kind">blocker</Badge>
                <Text size="read" tone="soft" as="p" className="min-w-0">
                  {blocker}
                </Text>
              </Inline>
            ))}
          </Stack>
        </div>
      )}

      {go.isError ? (
        <WhatWentWrong
          id={goErrorId}
          says="Nobody was sent, and nothing has been spent."
          error={go.error}
        />
      ) : null}

      <Inline gap={3} align="center" wrap>
        {blockers.length === 0 ? (
          <Button
            variant="primary"
            onClick={() => {
              go.mutate();
            }}
            pending={go.isPending}
            disabled={go.isPending || simulationId === ""}
            aria-describedby={go.isError ? goErrorId : undefined}
          >
            Send them in
          </Button>
        ) : (
          // At a bound, not gone: a natively disabled button takes no pointer events, so the
          // tooltip that says why can never open, and it leaves the tab order, so a keyboard
          // reader never meets the control or its explanation (§6).
          <Tooltip
            content={
              blockers.length === 1
                ? "One thing still stops this, listed above."
                : `${String(blockers.length)} things still stop this, listed above.`
            }
          >
            <Button variant="primary" atBound aria-describedby={blockersId}>
              Send them in
            </Button>
          </Tooltip>
        )}
        {stopped ? <Chip tone="bad">everything is stopped</Chip> : null}
        {simulationId === "" ? null : (
          <Link
            size="meta"
            to={`${href()}/s/${encodeURIComponent(setup.data?.simulationIds[0]?.slug ?? "")}/preflight`}
          >
            Before you send them
          </Link>
        )}
      </Inline>
    </Stack>
  );
}
