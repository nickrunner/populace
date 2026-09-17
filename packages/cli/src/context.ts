import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { identityProviderFor } from "@populace/adapters";
import { isRunId, newRunId, type IdentityProvider, type Store } from "@populace/core";
import { AnthropicProvider, type ModelProvider } from "@populace/runner";
import { SqliteStore } from "@populace/store-sqlite";
import { loadConfig, storePath, type LoadedConfig } from "./config.js";

export interface CliContext {
  loaded: LoadedConfig;
  store: Store;
  identityProvider: IdentityProvider;
  /** Lazily constructed so commands that never call the model do not need an API key. */
  provider(): ModelProvider;
  runId: string;
  log(line: string): void;
  close(): Promise<void>;
}

function runIdFile(loaded: LoadedConfig): string {
  const path = storePath(loaded);
  return path === ":memory:" ? join(loaded.dir, ".populace", "current-run") : join(dirname(path), "current-run");
}

/** The current run id is kept in a file next to the store, so every command in a checkout agrees on it. */
export function currentRunId(loaded: LoadedConfig, options: { run?: string; newRun?: boolean } = {}): string {
  if (options.run) {
    if (!isRunId(options.run)) throw new Error(`not a run id: ${options.run}`);
    return options.run;
  }
  const file = runIdFile(loaded);
  if (!options.newRun && existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (isRunId(existing)) return existing;
  }
  const fresh = newRunId();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${fresh}\n`);
  return fresh;
}

export function openContext(options: { config?: string; run?: string; newRun?: boolean; quiet?: boolean }): CliContext {
  const loaded = loadConfig(options.config ?? "populace.yaml");
  const store = new SqliteStore(storePath(loaded));
  const identityProvider = identityProviderFor(loaded.config.identity);
  let provider: ModelProvider | null = null;
  const runId = currentRunId(loaded, options);
  return {
    loaded,
    store,
    identityProvider,
    runId,
    provider: () => {
      provider ??= new AnthropicProvider(loaded.config.model);
      return provider;
    },
    log: options.quiet ? () => undefined : (line) => console.log(line),
    close: () => store.close(),
  };
}

export function resolveFrom(loaded: LoadedConfig, path: string): string {
  return resolve(loaded.dir, path);
}
