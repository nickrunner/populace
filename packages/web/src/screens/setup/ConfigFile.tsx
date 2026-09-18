import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ConfigImportResult, type ConfigRevision } from "../../api.js";
import { Button, Card, Chip, Empty, Failed, Loading, Mono, PageHeader, Payload, Problem, Saved, Section, TextArea } from "../../components/ui.jsx";

/**
 * The config as a file, and everything that has happened to it.
 *
 * From M2 the database is the source of truth and YAML is an exchange format (ADR-0025): a way to
 * put a config in a repository, hand it to a colleague, or drive the same population from CI. The
 * two directions are on one screen because they are one idea, and history is here with them
 * because it is what makes importing over your own work safe to do.
 */
export function ConfigFile() {
  const queries = useQueryClient();
  const exported = useQuery({ queryKey: ["config-export"], queryFn: () => api.exportConfig(), retry: false });
  const history = useQuery({ queryKey: ["config-history"], queryFn: () => api.history() });

  const refresh = async (): Promise<void> => {
    await queries.invalidateQueries();
  };

  return (
    <div>
      <PageHeader
        title="The config file"
        lede="Everything you have set up lives in this machine's database. This is the same thing as a file: take it out to put it in a repository, or bring one in to replace what is here."
      />

      <Section title="Take it out" sub="secrets become ${VAR} placeholders">
        {exported.isPending ? <Loading what="your config" /> : null}
        {exported.isError ? (
          <Card className="p-4">
            <Empty>{exported.error.message}</Empty>
          </Card>
        ) : null}
        {exported.data ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <a
                href={api.exportConfigUrl}
                download={exported.data.filename}
                className="t-body px-3 py-1.5 rounded-md border bg-card text-ink-soft border-rule hover:bg-well"
              >
                Download {exported.data.filename}
              </a>
              <Button onClick={() => void navigator.clipboard?.writeText(exported.data.yaml)}>Copy</Button>
            </div>
            {exported.data.placeholders.length ? (
              <Card className="p-3.5 mb-3">
                <div className="t-body text-ink">No credential is in this file.</div>
                <ul className="mt-1.5">
                  {exported.data.placeholders.map((line) => (
                    <li key={line} className="t-meta text-ink-muted">
                      <Mono className="text-[11px]">{line}</Mono>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <Payload>{exported.data.yaml}</Payload>
          </>
        ) : null}
      </Section>

      <Import onApplied={refresh} />

      <Section title="What has changed" sub="the last fifty edits, newest first">
        {history.isPending ? <Loading what="the history" /> : null}
        {history.isError ? <Failed error={history.error} /> : null}
        {history.data?.items.length === 0 ? (
          <Card className="p-4">
            <Empty>Nothing has been changed yet. Every edit from here on is recorded, and any of them can be put back.</Empty>
          </Card>
        ) : null}
        {history.data && history.data.items.length > 0 ? (
          <Card className="divide-y divide-rule">
            {history.data.items.map((revision) => (
              <RevisionRow key={revision.id} revision={revision} onRestored={refresh} />
            ))}
          </Card>
        ) : null}
      </Section>
    </div>
  );
}

/**
 * Bringing a file in. It is read and reported on first and written only when the person says so,
 * because this is the one control in the dashboard that can replace everything at once.
 */
function Import({ onApplied }: { onApplied: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<ConfigImportResult | null>(null);

  const check = useMutation({
    mutationFn: () => api.importConfig(text, false),
    onSuccess: (result) => setChecked(result),
  });
  const apply = useMutation({
    mutationFn: () => api.importConfig(text, true),
    onSuccess: async (result) => {
      setChecked(result);
      setText("");
      await onApplied();
    },
  });

  const readFile = async (file: File): Promise<void> => {
    setChecked(null);
    setText(await file.text());
  };

  return (
    <Section title="Bring one in" sub="this replaces what is here">
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <input
            type="file"
            accept=".yaml,.yml,text/yaml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
            className="t-meta text-ink-soft"
          />
          <span className="t-meta text-ink-muted">or paste it below</span>
        </div>
        <TextArea
          value={text}
          onChange={(value) => {
            setText(value);
            setChecked(null);
          }}
          rows={8}
          placeholder="version: 1&#10;target:&#10;  name: Tasklet"
        />
        <div className="flex items-center gap-2 mt-3">
          <Button onClick={() => check.mutate()} disabled={text.trim() === "" || check.isPending}>
            {check.isPending ? "Reading…" : "See what it would do"}
          </Button>
          {checked && !checked.applied ? (
            <Button tone="go" onClick={() => apply.mutate()} disabled={apply.isPending}>
              {apply.isPending ? "Importing…" : "Replace my config with this"}
            </Button>
          ) : null}
        </div>
        {check.isError ? <Problem>{check.error.message}</Problem> : null}
        {apply.isError ? <Problem>{apply.error.message}</Problem> : null}
        {checked ? (
          <div className="mt-3">
            <div className="t-body text-ink">{checked.applied ? "Imported." : "This is what it would do."}</div>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {checked.lines.map((line) => (
                <li key={line} className="t-meta text-ink-muted">
                  {line}
                </li>
              ))}
            </ul>
            {checked.missingEnv.length ? (
              <p className="t-meta text-critical mt-2">
                These are not set in this process, so they came through empty: <Mono className="text-[11px]">{checked.missingEnv.join(", ")}</Mono>
              </p>
            ) : null}
            {checked.applied ? <p className="t-meta text-ink-muted mt-2">The config you had before this is in the history below, and one click puts it back.</p> : null}
          </div>
        ) : null}
      </Card>
    </Section>
  );
}

const SOURCE: Record<ConfigRevision["source"], string> = {
  editor: "edited here",
  import: "from a file",
  restore: "put back",
  baseline: "where you started",
};

function RevisionRow({ revision, onRestored }: { revision: ConfigRevision; onRestored: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({ queryKey: ["config-revision", revision.id], queryFn: () => api.revision(revision.id), enabled: open });
  const restore = useMutation({
    mutationFn: () => api.restoreRevision(revision.id),
    onSuccess: onRestored,
  });

  return (
    <div className="p-3.5">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="t-body text-ink">{revision.summary}</span>
            {revision.current ? <Chip tone="good">what you have now</Chip> : null}
          </div>
          <div className="t-meta text-ink-muted mt-1">
            <Saved at={revision.at} /> · {SOURCE[revision.source]} · {revision.targetName ?? "no target"} · {revision.personaCount} written down, {revision.agentCount} going
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={() => setOpen(!open)}>{open ? "Hide" : "Read it"}</Button>
          {revision.current ? null : (
            <Button onClick={() => restore.mutate()} disabled={restore.isPending}>
              {restore.isPending ? "Putting it back…" : "Put this back"}
            </Button>
          )}
        </div>
      </div>
      {restore.isError ? <Problem>{restore.error.message}</Problem> : null}
      {open ? (
        <div className="mt-3">
          {detail.isPending ? <Loading what="that config" /> : null}
          {detail.isError ? <Failed error={detail.error} /> : null}
          {detail.data ? detail.data.renderable ? <Payload>{detail.data.yaml}</Payload> : <Empty>There was no target or nobody in the population at this point, so there is no config to show.</Empty> : null}
        </div>
      ) : null}
    </div>
  );
}
