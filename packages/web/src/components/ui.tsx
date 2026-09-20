import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { initials, verdictWords } from "../format.js";

/** Severity always carries its word; the colour never carries it alone (Foundations). */
const SEVERITY_INK: Record<string, string> = {
  critical: "text-critical",
  high: "text-high",
  medium: "text-medium",
  low: "text-low",
};

export function Severity({ value, kind }: { value: string; kind?: string }) {
  return (
    <span className={`t-label ${SEVERITY_INK[value] ?? "text-ink-muted"}`}>
      {value}
      {kind ? <span className="text-ink-muted"> {kind === "coverage-gap" ? "gap" : kind}</span> : null}
    </span>
  );
}

export function Verdict({ value }: { value: string | null }) {
  const words = verdictWords(value);
  return <span className={`t-meta ${value === "confirmed" ? "text-confirmed" : "text-ink-muted"}`}>{words}</span>;
}

/** Monospace is reserved for what the machine said or is named by. Never for prose. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono ${className}`}>{children}</span>;
}

/** The ochre call ref is the seam: wherever it appears, the instrument is right there. */
export function CallRef({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] text-evidence bg-evidence-wash rounded px-1 py-[1px]">{children}</span>;
}

export function ToolName({ name, missing = false }: { name: string; missing?: boolean }) {
  return (
    <Mono className="text-[12.5px] text-evidence">
      {name}
      {missing ? <span className="text-ink-muted"> — missing</span> : null}
    </Mono>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="shrink-0 grid place-items-center size-7 rounded-full bg-well border border-rule t-label text-ink-soft" title={name}>
      {initials(name)}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-card border border-rule rounded-lg ${className}`}>{children}</div>;
}

export function PageHeader({ title, lede, trail }: { title: string; lede?: string; trail?: ReactNode }) {
  return (
    <header className="mb-7">
      {trail ? <div className="t-meta text-ink-muted mb-1">{trail}</div> : null}
      <h1 className="t-title">{title}</h1>
      {lede ? <p className="t-body text-ink-soft mt-2 max-w-[68ch]">{lede}</p> : null}
    </header>
  );
}

export function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="t-section">{title}</h2>
        {sub ? <span className="t-meta text-ink-muted">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="t-label text-ink-muted mb-1.5">{label}</div>
      <div className="t-display">{value}</div>
      {sub ? <div className="t-meta text-ink-muted mt-1">{sub}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="t-body text-ink-muted italic">{children}</p>;
}

export function Loading({ what }: { what: string }) {
  return <p className="t-body text-ink-muted">Reading {what}…</p>;
}

export function Failed({ error }: { error: Error | null }) {
  // Nullable, because a screen reading two things reports whichever of them failed, and the
  // compiler cannot see that one of them did.
  const message = error?.message ?? "Something did not answer.";
  return (
    <Card className="p-4 border-critical/30">
      <p className="t-body text-critical">Could not read that.</p>
      <p className="t-meta text-ink-muted mt-1 font-mono">{message}</p>
    </Card>
  );
}

/**
 * What a 404 actually is: the thing named in the URL is not here. It is said in words, with a way
 * back, because a mistyped address and a bookmark to a problem a later execution stopped reporting
 * are both ordinary — neither is a failure, and "Could not read that" tells the reader nothing.
 */
export function Gone({ what, children }: { what: string; children?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="t-body text-ink">{what}</p>
      {children === undefined ? null : <div className="t-meta text-ink-muted mt-1.5">{children}</div>}
    </Card>
  );
}

/** A payload as the machine returned it, wrapped so a long one does not stretch the page. */
export function Payload({ children }: { children: ReactNode }) {
  return <pre className="font-mono text-[11.5px] leading-[1.5] bg-well border border-rule rounded p-2.5 overflow-x-auto whitespace-pre-wrap break-words">{children}</pre>;
}

/**
 * Buttons. `go` is the one action a screen wants you to take and there is at most one per screen;
 * `stop` is reserved for the two controls that end a run, because the design gives stopping its
 * own weight.
 */
export function Button({
  children,
  onClick,
  tone = "quiet",
  disabled = false,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "go" | "quiet" | "stop";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const tones = {
    go: "bg-accent text-white border-accent hover:opacity-90",
    quiet: "bg-card text-ink-soft border-rule hover:bg-well",
    stop: "bg-card text-critical border-critical/40 hover:bg-critical/5",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      {...(title === undefined ? {} : { title })}
      className={`t-body px-3 py-1.5 rounded-md border transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block mb-4">
      <span className="t-label text-ink-muted block mb-1.5">{label}</span>
      {children}
      {hint ? <span className="t-meta text-ink-muted block mt-1">{hint}</span> : null}
    </label>
  );
}

const INPUT = "w-full bg-card border border-rule rounded-md px-2.5 py-1.5 t-body text-ink outline-none focus:border-accent";

export function Input({ value, onChange, placeholder, mono = false, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: string }) {
  return <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${mono ? "font-mono text-[12.5px]" : ""}`} />;
}

export function NumberInput({ value, onChange, min = 0, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return <input type="number" value={value} min={min} step={step} onChange={(e) => onChange(Number(e.target.value))} className={`${INPUT} tabular-nums`} />;
}

export function TextArea({ value, onChange, rows = 4, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${INPUT} resize-y`} />;
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** How many of this person go into the next run. Zero means they stay written down but stay home. */
export function Stepper({ value, onChange, max = 99 }: { value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <span className="inline-flex items-center border border-rule rounded-md overflow-hidden">
      <button type="button" className="px-2 py-0.5 t-body text-ink-soft hover:bg-well disabled:opacity-30" disabled={value <= 0} onClick={() => onChange(value - 1)} aria-label="one fewer">
        −
      </button>
      <span className="px-2.5 t-body tabular-nums min-w-8 text-center">{value}</span>
      <button type="button" className="px-2 py-0.5 t-body text-ink-soft hover:bg-well disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="one more">
        +
      </button>
    </span>
  );
}

/** A state the reader needs to see at a glance: connected, running, stopped. */
export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "live" }) {
  const tones = {
    neutral: "text-ink-muted border-rule",
    good: "text-confirmed border-confirmed/40",
    bad: "text-critical border-critical/40",
    live: "text-accent border-accent/40 bg-accent-wash",
  };
  return <span className={`t-label inline-flex items-center gap-1.5 border rounded-full px-2 py-0.5 ${tones[tone]}`}>{children}</span>;
}

export function Saved({ at }: { at: string | null }) {
  if (at === null) return null;
  const seconds = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
  const words = seconds < 45 ? "just now" : seconds < 5400 ? `${Math.round(seconds / 60)} minutes ago` : `${Math.round(seconds / 3600)} hours ago`;
  return <span className="t-meta text-ink-muted">saved {words}</span>;
}

/** What went wrong with something the reader just did, said next to the thing they did it to. */
export function Problem({ children }: { children: ReactNode }) {
  return <p className="t-body text-critical mt-2">{children}</p>;
}

/**
 * One row of filters over a list, as chips that carry their own counts. Duplicated inline on the
 * findings and the visits screens before this existed; a count next to each is what makes a chip
 * worth clicking, so it is part of the primitive rather than an option.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  all = "Everything",
  allCount,
  trail,
}: {
  options: { value: T; label: string; count: number }[];
  value: T | null;
  onChange: (value: T | null) => void;
  all?: string;
  allCount?: number;
  trail?: ReactNode;
}) {
  const chip = (active: boolean): string =>
    `t-meta rounded-full border px-3 py-1 ${active ? "bg-accent-wash border-accent/30 text-accent" : "bg-card border-rule text-ink-soft hover:border-rule-strong"}`;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <button type="button" onClick={() => onChange(null)} className={chip(value === null)}>
        {all}
        {allCount === undefined ? null : <span className="tabular-nums text-ink-muted"> {allCount}</span>}
      </button>
      {options
        .filter((option) => option.count > 0)
        .map((option) => (
          <button key={option.value} type="button" onClick={() => onChange(value === option.value ? null : option.value)} className={chip(value === option.value)}>
            {option.label} <span className="tabular-nums text-ink-muted">{option.count}</span>
          </button>
        ))}
      {trail === undefined ? null : <span className="t-meta text-ink-muted ml-auto">{trail}</span>}
    </div>
  );
}

export interface Column<T> {
  header: ReactNode;
  /** Numbers right, words left. A column of figures that is not `tabular-nums` is a bug. */
  align?: "left" | "right";
  width?: string;
  cell: (row: T) => ReactNode;
}

/** The table shape the gaps and visits screens each hand-rolled, with one set of rules. */
export function DataTable<T>({ columns, rows, keyOf, empty }: { columns: Column<T>[]; rows: T[]; keyOf: (row: T) => string; empty: string }) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="t-label text-ink-muted border-b border-rule">
            {columns.map((column, i) => (
              <th key={i} className={`font-semibold px-4 py-2.5 ${column.align === "right" ? "text-right" : "text-left"} ${column.width ?? ""}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyOf(row)} className="border-b border-rule last:border-0 hover:bg-well">
              {columns.map((column, i) => (
                <td key={i} className={`px-4 py-3 ${column.align === "right" ? "text-right tabular-nums" : ""}`}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="t-body text-ink-muted italic p-4">{empty}</p> : null}
    </Card>
  );
}

/** Where you are, in the words of the levels above you. The last crumb is where you are and is not a link. */
export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="t-meta text-ink-muted flex items-center gap-1.5 flex-wrap">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden="true">›</span> : null}
          {item.to === undefined ? <span className="text-ink-soft">{item.label}</span> : <Link to={item.to} className="text-accent hover:underline">{item.label}</Link>}
        </span>
      ))}
    </nav>
  );
}

/**
 * How much of something, as a length. Every proportion in the product is drawn this way — the
 * cohort bars, the spend meter — so they read as one measurement rather than four charts.
 */
export function Bar({ value, of, tone = "accent" }: { value: number; of: number; tone?: "accent" | "evidence" | "quiet" }) {
  const proportion = of > 0 ? Math.min(1, Math.max(0, value / of)) : 0;
  const ink = { accent: "bg-accent", evidence: "bg-evidence", quiet: "bg-rule-strong" }[tone];
  return (
    <span className="block h-1 rounded bg-well overflow-hidden" role="presentation">
      <span className={`block h-full ${ink}`} style={{ width: `${(proportion * 100).toFixed(1)}%` }} />
    </span>
  );
}
