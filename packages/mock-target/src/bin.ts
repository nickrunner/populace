#!/usr/bin/env node
import { startMockTarget } from "./server.js";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const port = Number(flag("port") ?? process.env.PORT ?? "4310");
const stateFile = flag("state") ?? process.env.MOCK_TARGET_STATE;
const running = await startMockTarget({ port, ...(stateFile ? { stateFile } : {}) });

const stop = (): void => {
  void running.close().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
