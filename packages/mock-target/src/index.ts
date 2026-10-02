export { startMockTarget, type MockTargetOptions, type RunningMockTarget } from "./server.js";
/**
 * `REPAIRABLE` and `Repairable` are part of the public surface because `MockTargetOptions.repaired`
 * already is: a caller who wants to start the target with a planted defect repaired has to build a
 * `ReadonlySet<Repairable>`, and until this line existed there was no way to NAME that type from
 * outside the package — the option was reachable and its value was not constructible without a
 * deep import past the entry point. `REPAIRABLE` comes with it so a caller can say "all of them"
 * without restating the list and drifting from it.
 */
export { TaskletApp, PRODUCT_INFO, AppError, REPAIRABLE, type Repairable } from "./app.js";
export { buildMcpServer } from "./mcp.js";
