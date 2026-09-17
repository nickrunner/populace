import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Digest } from "@populace/core";
import { renderDigestMarkdown } from "./render.js";

export interface ExportResult {
  exporter: string;
  location: string;
}

/** Plugin interface for digest destinations. Markdown file is the only Milestone 0 implementation. */
export interface Exporter {
  readonly name: string;
  export(digest: Digest, options: { outDir: string }): Promise<ExportResult>;
}

export class MarkdownFileExporter implements Exporter {
  readonly name = "markdown-file";

  export(digest: Digest, options: { outDir: string }): Promise<ExportResult> {
    mkdirSync(options.outDir, { recursive: true });
    const file = join(options.outDir, `${digest.generatedAt.slice(0, 10)}-${digest.id}.md`);
    writeFileSync(file, renderDigestMarkdown(digest));
    writeFileSync(file.replace(/\.md$/, ".json"), JSON.stringify(digest, null, 2));
    return Promise.resolve({ exporter: this.name, location: file });
  }
}

export const exporters: Record<string, () => Exporter> = {
  "markdown-file": () => new MarkdownFileExporter(),
};

export function exporterNamed(name: string): Exporter {
  const factory = exporters[name];
  if (!factory) throw new Error(`unknown exporter ${name}; known: ${Object.keys(exporters).join(", ")}`);
  return factory();
}
