import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { Avatar, Button, Card, Empty, Failed, Loading, Mono, PageHeader, Problem, Section } from "../../components/ui.jsx";

/**
 * A persona is a KIND of person, not a person: it has no name of its own, and the people in a
 * cohort are drawn from it. This screen is the library of kinds; how many of each go anywhere is
 * decided on "The people" (SPEC §7.6).
 */
export function Personas() {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const personas = useQuery(q.personas(key));
  const starters = useQuery(q.starters(key));

  const refresh = async (): Promise<void> => {
    await queries.invalidateQueries();
  };
  const add = useMutation({ mutationFn: (slug: string) => api.addStarter(key, slug, 1), onSuccess: refresh });

  if (personas.isPending || starters.isPending) return <Loading what="the personas" />;
  if (personas.isError) return <Failed error={personas.error} />;
  if (starters.isError) return <Failed error={starters.error} />;

  const mine = personas.data.items;
  const taken = new Set(mine.map((persona) => persona.slug));

  return (
    <>
      <PageHeader
        title="Personas"
        lede="Who the people are underneath: what they came to do, what they will put up with, and what they are allowed to touch. This is the setting that decides more than any other whether what comes back is worth reading."
      />

      {add.isError ? <Problem>{add.error.message}</Problem> : null}

      <Section title="In this project" sub={`${mine.length} ${mine.length === 1 ? "kind of person" : "kinds of person"}`}>
        {mine.length === 0 ? (
          <Card className="p-4">
            <Empty>Nobody written yet. Start from one below, or write your own.</Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-rule">
            {mine.map((persona) => (
              <Link key={persona.id} to={href(`library/personas/${encodeURIComponent(persona.id)}`)} className="block p-3.5 hover:bg-well">
                <div className="flex items-start gap-3">
                  <Avatar name={persona.spec.name} />
                  <div className="flex-1 min-w-0">
                    <div className="t-body text-ink">
                      {persona.spec.name} <span className="text-ink-muted">· {persona.spec.role}</span>
                    </div>
                    <p className="t-meta text-ink-muted mt-0.5 max-w-[68ch]">{persona.spec.goals.join(" · ")}</p>
                    <Mono className="text-[11px] text-ink-muted mt-1 block">{persona.slug}</Mono>
                  </div>
                  <span className="t-meta text-ink-muted shrink-0 tabular-nums">
                    {persona.count} {persona.count === 1 ? "person" : "people"}
                  </span>
                </div>
              </Link>
            ))}
          </Card>
        )}
        <Link to={href("library/personas/new")} className="inline-block mt-3 t-body text-accent hover:underline">
          Write your own
        </Link>
      </Section>

      <Section title="Start from someone" sub="six people who find different things">
        <Card className="divide-y divide-rule">
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
                {taken.has(starter.slug) ? "Add another cohort" : "Take them"}
              </Button>
            </div>
          ))}
        </Card>
      </Section>
    </>
  );
}
