import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, type Persona } from "../../api.js";
import { Avatar, Button, Card, Empty, Failed, Loading, Mono, Problem, Section, Stepper } from "../../components/ui.jsx";

/**
 * Who goes: the starter library, the counts, and the way in to each person's own screen.
 *
 * A count of zero keeps someone written down but leaves them at home, which is how you park a
 * person between runs without losing them.
 */
export function People() {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const personas = useQuery({ queryKey: ["personas"], queryFn: () => api.personas() });
  const starters = useQuery({ queryKey: ["starters"], queryFn: () => api.starters() });

  const refresh = async (): Promise<void> => {
    await queries.invalidateQueries();
  };

  const add = useMutation({ mutationFn: (slug: string) => api.addStarter(slug, 1), onSuccess: refresh });
  const setCount = useMutation({
    mutationFn: async ({ personaId, count }: { personaId: string; count: number }) => {
      const current = await api.population();
      const others = current.members.filter((m) => m.personaId !== personaId);
      const members = [...others.map((m) => ({ personaId: m.personaId, count: m.count })), ...(count > 0 ? [{ personaId, count }] : [])];
      return api.savePopulation({ members });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.removePersona(id), onSuccess: refresh });
  // Someone written from scratch opens straight into the editor: the fields below are prompts for
  // what to write, not content, and every one of them is meant to be replaced before a run.
  const write = useMutation({
    mutationFn: async (slug: string) =>
      api.savePersona(null, {
        slug,
        spec: { name: "Someone new", role: "what they do", backstory: "where they are coming from", goals: ["what they came to do"], constraints: [], patience: 3, budgetUsd: 0, traits: {}, tools: { allow: [], deny: [], destructive: "confirm" }, model: {} },
      }),
    onSuccess: async (person) => {
      await refresh();
      void navigate(`/setup/people/${encodeURIComponent(person.id)}`);
    },
  });

  if (personas.isPending || starters.isPending) return <Loading what="the people" />;
  if (personas.isError) return <Failed error={personas.error} />;
  if (starters.isError) return <Failed error={starters.error} />;

  const mine = personas.data.items;
  const taken = new Set(mine.map((p) => p.slug));
  const going = mine.reduce((sum, p) => sum + p.count, 0);

  return (
    <div>
      <header className="mb-7">
        <h1 className="t-title">The people</h1>
        <p className="t-body text-ink-soft mt-2 max-w-[68ch]">
          Who goes to the target, and how many of each. They arrive knowing only what the product says about itself, and they behave like the person described here — not like a test script.
        </p>
      </header>

      {setCount.isError ? <Problem>{setCount.error.message}</Problem> : null}
      {add.isError ? <Problem>{add.error.message}</Problem> : null}
      {write.isError ? <Problem>{write.error.message}</Problem> : null}

      <Section title="Going on the next run" sub={going === 0 ? "nobody yet" : `${going} ${going === 1 ? "person" : "people"}`}>
        {mine.length === 0 ? (
          <Card className="p-4">
            <Empty>Nobody here yet. Start from someone below.</Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-rule">
            {mine.map((persona) => (
              <PersonRow key={persona.id} persona={persona} onCount={(count) => setCount.mutate({ personaId: persona.id, count })} onRemove={() => remove.mutate(persona.id)} />
            ))}
          </Card>
        )}
      </Section>

      <Section title="Start from someone" sub="six people who find different things">
        <Card className="divide-y divide-rule">
          <div className="p-3.5 flex items-center gap-3">
            <span className="shrink-0 grid place-items-center size-7 rounded-full bg-well border border-rule t-label text-ink-soft">+</span>
            <div className="flex-1 min-w-0">
              <div className="t-body text-ink">Write someone from scratch</div>
              <div className="t-meta text-ink-muted">Start from a blank person and say who they are yourself</div>
            </div>
            <Button onClick={() => write.mutate(freeSlug(mine.map((p) => p.slug)))} disabled={write.isPending}>
              Write one
            </Button>
          </div>
          {starters.data.items.map((starter) => (
            <div key={starter.slug} className="p-3.5 flex items-center gap-3">
              <Avatar name={starter.name} />
              <div className="flex-1 min-w-0">
                <div className="t-body text-ink">
                  {starter.name} <span className="text-ink-muted">· {starter.role}</span>
                </div>
                <div className="t-meta text-ink-muted">{starter.summary}</div>
              </div>
              <Button onClick={() => add.mutate(starter.slug)} disabled={add.isPending}>
                {taken.has(starter.slug) ? "Add another" : "Add"}
              </Button>
            </div>
          ))}
        </Card>
      </Section>
    </div>
  );
}

/** The first `someone-new-N` nobody is using, so writing two in a row does not collide. */
function freeSlug(taken: string[]): string {
  const used = new Set(taken);
  if (!used.has("someone-new")) return "someone-new";
  for (let n = 2; ; n++) {
    const slug = `someone-new-${n}`;
    if (!used.has(slug)) return slug;
  }
}

function PersonRow({ persona, onCount, onRemove }: { persona: Persona; onCount: (count: number) => void; onRemove: () => void }) {
  return (
    <div className="p-3.5 flex items-start gap-3">
      <Avatar name={persona.spec.name} />
      <div className="flex-1 min-w-0">
        <div className="t-body text-ink">
          <Link to={`/setup/people/${encodeURIComponent(persona.id)}`} className="text-accent hover:underline">
            {persona.spec.name}
          </Link>{" "}
          <span className="text-ink-muted">· {persona.spec.role}</span>
        </div>
        <p className="t-body text-ink-soft mt-1 max-w-[60ch]">{persona.spec.backstory}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {persona.spec.goals.map((goal, i) => (
            <li key={i} className="t-meta text-ink-muted">
              {goal}
            </li>
          ))}
        </ul>
        {/* The slug is what agent ids are built from, so it is shown as the machine's name for
            this person: renaming them never moves it, and a continuation still finds them. */}
        <Mono className="text-[11px] text-ink-muted mt-2 block">{persona.slug}</Mono>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Stepper value={persona.count} onChange={onCount} />
        <Link to={`/setup/people/${encodeURIComponent(persona.id)}`} className="t-body px-3 py-1.5 rounded-md border bg-card text-ink-soft border-rule hover:bg-well">
          Edit
        </Link>
        <Button onClick={onRemove} title="Remove this person from the project">
          Remove
        </Button>
      </div>
    </div>
  );
}
