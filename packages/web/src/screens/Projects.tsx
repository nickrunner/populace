import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { q } from "../queries.js";
import { usd, when } from "../format.js";
import { Button, Card, Chip, Empty, Failed, Field, Input, Loading, PageHeader, Problem, TextArea } from "../components/ui.jsx";

/**
 * The only screen outside a project, and the only one without the rail: there is nothing to
 * navigate to until you are inside one. A card says what is in a project, whether anything is
 * going on in it, and what it has cost this week — the three things that decide which one you
 * open (SPEC §7.6).
 */
export function Projects() {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const projects = useQuery(q.projects());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const writing = params.get("new") !== null;

  const create = useMutation({
    mutationFn: () => api.createProject({ name, ...(description ? { description } : {}) }),
    onSuccess: async (project) => {
      await queries.invalidateQueries({ queryKey: ["projects"] });
      void navigate(`/p/${encodeURIComponent(project.slug)}`);
    },
  });

  if (projects.isPending) return <Loading what="your projects" />;
  if (projects.isError) return <Failed error={projects.error} />;

  const items = projects.data.items.filter((project) => !project.archived);

  return (
    <div className="max-w-[860px] mx-auto px-10 py-12">
      <div className="t-meta text-ink-muted mb-1">populace</div>
      <PageHeader
        title="Your projects"
        lede="A project is one product you are testing: its target, the people who visit it, and everything they have found. Nothing is shared between projects — a persona written here stays here."
      />

      {writing ? (
        <Card className="p-5 mb-6">
          <Field label="What are you testing?">
            <Input value={name} onChange={setName} placeholder="Tasklet" />
          </Field>
          <Field label="A line about it" hint="Optional. It is what the projects list shows under the name.">
            <TextArea value={description} onChange={setDescription} rows={2} placeholder="The task manager we ship next month." />
          </Field>
          {create.isError ? <Problem>{create.error.message}</Problem> : null}
          <div className="flex items-center gap-2">
            <Button tone="go" onClick={() => create.mutate()} disabled={create.isPending || name.trim() === ""}>
              {create.isPending ? "Making it…" : "Make the project"}
            </Button>
            <Button onClick={() => setParams({})}>Never mind</Button>
          </div>
        </Card>
      ) : (
        <div className="mb-6">
          <Button tone="go" onClick={() => setParams({ new: "1" })}>
            New project
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <Card className="p-5">
          <Empty>Nothing here yet. A project is the first thing to make.</Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((project) => (
            <Link key={project.id} to={`/p/${encodeURIComponent(project.slug)}`} className="block">
              <Card className="p-4 hover:border-rule-strong">
                <div className="flex items-baseline gap-3">
                  <h2 className="t-section">{project.name}</h2>
                  {project.runningRunIds.length > 0 ? <Chip tone="live">● running</Chip> : null}
                  <span className="flex-1" />
                  <span className="t-meta text-ink-muted tabular-nums">{usd(project.costLast7dUsd)} this week</span>
                </div>
                {project.description ? <p className="t-body text-ink-soft mt-1 max-w-[68ch]">{project.description}</p> : null}
                <p className="t-meta text-ink-muted mt-2 tabular-nums">
                  {project.counts.simulations} {project.counts.simulations === 1 ? "simulation" : "simulations"} · {project.counts.people} people · {project.counts.personas} personas ·{" "}
                  {project.lastActivityAt === null ? "nothing has run yet" : `last active ${when(project.lastActivityAt)}`}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
