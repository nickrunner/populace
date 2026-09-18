#!/usr/bin/env node
import { Command } from "commander";
import { digest, init, kill, run, scale, serve, status, sweep, validate, wake } from "./commands.js";

// node:sqlite prints an ExperimentalWarning on Node 22; keep every other warning.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && /SQLite/.test(warning.message)) return;
  console.warn(`${warning.name}: ${warning.message}`);
});

const program = new Command("populace").description("Deploy a population of persona-seeded AI agents against an app's MCP server and digest what they find.").version("0.1.0");
program.option("-c, --config <path>", "config file", "populace.yaml").option("-r, --run <id>", "run id (default: the current run recorded next to the store)").option("-q, --quiet", "less output");

const globals = (): { config: string; run?: string; quiet?: boolean } => program.opts();

function fail(err: Error): never {
  console.error(`error: ${err.message}`);
  process.exit(1);
}

program
  .command("init [dir]")
  .description("write a populace.yaml pointing at the mock target with three personas")
  .option("--target <url>", "target base url", "http://127.0.0.1:4310")
  .option("--force", "overwrite an existing file")
  .action((dir: string | undefined, opts: { target: string; force?: boolean }) => {
    try {
      const file = init({ ...(dir ? { dir } : {}), target: opts.target, ...(opts.force ? { force: true } : {}) });
      console.log(`wrote ${file}\nnext: start the mock target (pnpm mock-target), then populace validate`);
    } catch (err) {
      fail(err as Error);
    }
  });

program
  .command("validate")
  .description("validate the config and connect to the target to list its tools")
  .option("--no-connect", "skip connecting to the target")
  .action(async (opts: { connect: boolean }) => {
    try {
      const result = await validate({ ...globals(), connect: opts.connect });
      for (const line of result.lines) console.log(line);
      if (!result.ok) process.exit(1);
    } catch (err) {
      fail(err as Error);
    }
  });

program
  .command("wake <agent>")
  .description("run one wake now for an agent id or persona id")
  .option("--effort <level>", "low | medium | high | xhigh | max")
  .option("--new-run", "start a new run id")
  .action(async (agent: string, opts: { effort?: string; newRun?: boolean }) => {
    try {
      await wake(agent, { ...globals(), ...opts });
    } catch (err) {
      fail(err as Error);
    }
  });

program
  .command("run")
  .description("start the local daemon: wake every agent on its cadence until all are retired or Ctrl-C")
  .option("--new-run", "start a new run id")
  .option("--continue-from <run id>", "carry a previous run's agents, memory and accounts into a new run; agents who gave up return if they said they would")
  .option("--max-wakes <n>", "stop after this many wakes in total", (v: string) => Number(v))
  .option("--once", "run one scheduler tick and exit")
  .action(async (opts: { newRun?: boolean; maxWakes?: number; once?: boolean; continueFrom?: string }) => {
    try {
      await run({ ...globals(), ...opts });
    } catch (err) {
      fail(err as Error);
    }
  });

program
  .command("scale <factor>")
  .description("set the population scale factor in the config and reconcile agents")
  .action(async (factor: string) => {
    try {
      await scale(factor, globals());
    } catch (err) {
      fail(err as Error);
    }
  });

program
  .command("digest")
  .description("verify pending findings, cluster them and write a digest")
  .option("--since <duration>", "window start, relative to now", "24h")
  .option("--until <duration>", "window end, relative to now (default: now)")
  .option("--no-verify", "skip verification")
  .option("--judge <kind>", "model | heuristic (default from config)")
  .option("--exporter <name>", "markdown-file", "markdown-file")
  .option("--out <dir>", "output directory (default: digestDir from config)")
  .option("--stdout", "print the Markdown instead of writing a file")
  .option("--all-runs", "include every run in the store, not just the current one")
  .option("--include-not-reproduced", "keep findings whose verification failed")
  .action(async (opts: { since: string; until?: string; verify: boolean; judge?: string; exporter: string; out?: string; stdout?: boolean; allRuns?: boolean; includeNotReproduced?: boolean }) => {
    try {
      await digest({ ...globals(), ...opts });
    } catch (err) {
      fail(err as Error);
    }
  });

program
  .command("sweep")
  .description("tear down every identity the run created and remove its data")
  .option("--dry-run", "list what would be removed")
  .option("--keep-data", "tear down identities but keep wakes, traces and findings")
  .option("--all-runs", "sweep every run in the store")
  .action(async (opts: { dryRun?: boolean; keepData?: boolean; allRuns?: boolean }) => {
    try {
      const result = await sweep({ ...globals(), ...opts });
      if (result.failures > 0) process.exit(1);
    } catch (err) {
      fail(err as Error);
    }
  });

program
  .command("kill")
  .description("engage the global kill switch (no wake starts or continues)")
  .option("--release", "release the kill switch")
  .option("--status", "show the kill switch state")
  .option("--reason <text>", "why")
  .action(async (opts: { release?: boolean; status?: boolean; reason?: string }) => {
    try {
      await kill({ ...globals(), ...opts });
    } catch (err) {
      fail(err as Error);
    }
  });

program
  .command("status")
  .description("show agents, wakes, findings and spend for the current run")
  .action(async () => {
    try {
      await status(globals());
    } catch (err) {
      fail(err as Error);
    }
  });

program
  .command("serve")
  .description("start the local HTTP API and dashboard: set up targets and people, start runs and watch them")
  .option("--port <n>", "port to listen on", (v: string) => Number.parseInt(v, 10))
  .option("--host <host>", "host to bind; defaults to 127.0.0.1 and should stay there")
  .option("--read-only", "serve the dashboard without the controls that start runs or change config")
  .option("--force", "take over the store lock from a populace process that is no longer running")
  .action(async (opts: { port?: number; host?: string; readOnly?: boolean; force?: boolean }) => {
    try {
      const server = await serve({ ...globals(), ...opts });
      const stop = (): void => void server.close().then(() => process.exit(0));
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    } catch (err) {
      fail(err as Error);
    }
  });

await program.parseAsync(process.argv);
