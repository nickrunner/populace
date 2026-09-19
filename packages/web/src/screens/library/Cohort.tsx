import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type PersonView } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { people as peopleWord } from "../../format.js";
import { Breadcrumb, Button, Card, Empty, Failed, Field, Input, Loading, Mono, NumberInput, Problem, Section, Stepper } from "../../components/ui.jsx";

/**
 * One cohort and the people in it.
 *
 * This is the first screen in the product that names anybody, and it does it because this is
 * where you decide who they are. A person carries a name, a handle and a sentence — nothing else.
 * Goals and tool policy belong to the persona; the moment a person could carry those, the persona
 * would stop being a template and the cohort would stop meaning anything (SPEC §9).
 */
export function Cohort() {
  const { key, href } = useProject();
  const { cohortSlug = "" } = useParams();
  const queries = useQueryClient();
  const cohorts = useQuery(q.cohorts(key));
  const cohort = cohorts.data?.items.find((row) => row.slug === cohortSlug);
  const people = useQuery({ ...q.cohortPeople(key, cohort?.id ?? ""), enabled: cohort !== undefined });

  const [size, setSize] = useState<number | null>(null);
  const [every, setEvery] = useState<number | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [told, setTold] = useState("");

  useEffect(() => {
    if (cohort === undefined || size !== null) return;
    setSize(cohort.size);
    setEvery(cohort.cadence?.every === undefined ? 0 : Math.round(cohort.cadence.every / 1000));
    setCap(cohort.maxWakes ?? 0);
  }, [cohort, size]);

  const watched = useQuery({ ...q.job(job ?? ""), enabled: job !== null, refetchInterval: 1_000 });
  const writing = watched.data?.status === "queued" || watched.data?.status === "running";

  useEffect(() => {
    if (job === null || watched.data === undefined || writing) return;
    // Without an API key the writer succeeds with the free seeded cast, so what it managed is
    // said out loud rather than left to be inferred from rows that did not change.
    setTold(watched.data.error ?? watched.data.progress.label);
    setJob(null);
    void queries.invalidateQueries();
  }, [job, watched.data, writing, queries]);

  const refresh = async (): Promise<void> => {
    await queries.invalidateQueries();
  };
  const save = useMutation({
    mutationFn: () =>
      api.saveCohort(key, cohort?.id ?? "", {
        size: size ?? cohort?.size ?? 0,
        cadence: every === null || every === 0 ? null : { every: every * 1000 },
        maxWakes: cap === null || cap === 0 ? null : cap,
      }),
    onSuccess: refresh,
  });
  const write = useMutation({ mutationFn: () => api.writePeople(key, cohort?.id ?? ""), onSuccess: (started) => setJob(started.id) });
  const recast = useMutation({ mutationFn: () => api.recastPeople(key, cohort?.id ?? ""), onSuccess: (started) => setJob(started.id) });

  if (cohorts.isPending) return <Loading what="this cohort" />;
  if (cohorts.isError) return <Failed error={cohorts.error} />;
  if (cohort === undefined) return <Failed error={new Error(`no cohort called ${cohortSlug}`)} />;

  const roster = (people.data?.items ?? []).filter((person) => !person.archived);
  const putAside = (people.data?.items ?? []).filter((person) => person.archived);
  const unwritten = roster.filter((person) => person.details === "").length;

  return (
    <>
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <Breadcrumb items={[{ label: "The people", to: href("library/people") }, { label: cohort.name }]} />
          <h1 className="t-title mt-1">{cohort.name}</h1>
          <p className="t-body text-ink-soft mt-2 max-w-[68ch]">
            {peopleWord(cohort.size)} on{" "}
            <Link to={href(`library/personas/${encodeURIComponent(cohort.personaId)}`)} className="text-accent hover:underline">
              {cohort.personaName}
            </Link>
            . {cohort.usedByPopulations.length === 0 ? "No population holds them yet." : `In ${cohort.usedByPopulations.map((population) => population.name).join(", ")}.`}
          </p>
        </div>
        <div className="shrink-0">
          <Mono className="text-[11px] text-ink-muted">{cohort.slug}</Mono>
        </div>
      </header>

      {save.isError ? <Problem>{save.error.message}</Problem> : null}
      {write.isError ? <Problem>{write.error.message}</Problem> : null}
      {recast.isError ? <Problem>{recast.error.message}</Problem> : null}

      <Section title="How many, and how often">
        <Card className="p-4">
          <div className="grid grid-cols-3 gap-4 items-end">
            <Field label="People in this cohort" hint="Shrinking puts people aside rather than deleting them, so growing back meets the same cast.">
              <Stepper value={size ?? cohort.size} onChange={setSize} max={999} />
            </Field>
            <Field label="A visit every… (seconds)" hint="Zero follows the simulation's own cadence.">
              <NumberInput value={every ?? 0} onChange={setEvery} />
            </Field>
            <Field label="Stop each of them after… (visits)" hint="Zero follows the simulation.">
              <NumberInput value={cap ?? 0} onChange={setCap} />
            </Field>
          </div>
          <Button tone="go" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </Card>
      </Section>

      <Section title="Who they are" sub={`${peopleWord(roster.length)}${unwritten > 0 ? `, ${unwritten} without details` : ""}`}>
        <div className="flex items-center gap-3 mb-3">
          <Button onClick={() => write.mutate()} disabled={writing || write.isPending || unwritten === 0}>
            {writing ? "Writing them…" : "Have the AI write these people"}
          </Button>
          <Button onClick={() => recast.mutate()} disabled={writing || recast.isPending} title="Replaces everybody, including people past executions name">
            Re-cast all of them
          </Button>
          <span className="t-meta text-ink-muted">
            {told ? `${told}. ` : ""}Re-casting changes who these people are, so the same problem found by the same person in an earlier execution no longer has the same name against it.
          </span>
        </div>

        {people.isPending ? (
          <Loading what="the roster" />
        ) : roster.length === 0 ? (
          <Card className="p-4">
            <Empty>Nobody in this cohort yet.</Empty>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-x-6">
            {roster.map((person) => (
              <PersonRow key={person.id} person={person} cohortId={cohort.id} projectKey={key} />
            ))}
          </div>
        )}

        {putAside.length > 0 ? (
          <p className="t-meta text-ink-muted mt-4">
            {putAside.length} more are put aside: {putAside.map((person) => person.name).join(", ")}. Grow the cohort and they come back exactly as they were.
          </p>
        ) : null}
      </Section>
    </>
  );
}

function PersonRow({ person, cohortId, projectKey }: { person: PersonView; cohortId: string; projectKey: string }) {
  const queries = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [details, setDetails] = useState(person.details);

  const save = useMutation({
    mutationFn: () => api.savePerson(projectKey, cohortId, person.ordinal, { name, details }),
    onSuccess: async () => {
      setEditing(false);
      await queries.invalidateQueries();
    },
  });

  return (
    <div className="border-b border-rule py-2.5 flex items-start gap-3">
      <span className="t-meta text-ink-muted tabular-nums w-6 shrink-0">{person.ordinal + 1}</span>
      {editing ? (
        <div className="flex-1">
          <div className="mb-1.5">
            <Input value={name} onChange={setName} />
          </div>
          <div className="mb-1.5">
            <Input value={details} onChange={setDetails} placeholder="One sentence about them." />
          </div>
          <div className="flex items-center gap-2">
            <Button tone="go" onClick={() => save.mutate()} disabled={save.isPending}>
              Save
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </div>
          {save.isError ? <Problem>{save.error.message}</Problem> : null}
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <div className="t-body text-ink">{person.name}</div>
            <p className="t-meta text-ink-muted">{person.details || <span className="italic">no details yet</span>}</p>
            <Mono className="text-[11px] text-ink-muted">{person.handle}</Mono>
          </div>
          <button type="button" onClick={() => setEditing(true)} className="t-meta text-ink-muted hover:text-accent shrink-0" title={`Edit ${person.name}`}>
            edit
          </button>
        </>
      )}
    </div>
  );
}
