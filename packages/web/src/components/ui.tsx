import type { ReactNode } from "react";
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

export function Failed({ error }: { error: Error }) {
  const message = error.message;
  return (
    <Card className="p-4 border-critical/30">
      <p className="t-body text-critical">Could not read that.</p>
      <p className="t-meta text-ink-muted mt-1 font-mono">{message}</p>
    </Card>
  );
}

/** A payload as the machine returned it, wrapped so a long one does not stretch the page. */
export function Payload({ children }: { children: ReactNode }) {
  return <pre className="font-mono text-[11.5px] leading-[1.5] bg-well border border-rule rounded p-2.5 overflow-x-auto whitespace-pre-wrap break-words">{children}</pre>;
}
