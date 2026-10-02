import { describe, expect, it } from "vitest";
import { TaskletApp, parseRepairs, type Repairable, type User } from "./app.js";

/** Signs up a user and gives them one task, so each case starts from the same place. */
function seed(app: TaskletApp): { user: User; taskId: string } {
  // Sign-up hands back the redacted public user; the domain methods take the full record.
  const user = app.userForToken(app.signUp({ email: "a@b.test", displayName: "A", password: "pw-12345678" }).token);
  const project = app.createProject(user, { name: "Home" });
  const task = app.createTask(user, { projectId: project.id, title: "Buy Groceries", dueDate: "2026-10-01" });
  return { user, taskId: task.id };
}

describe("planted defect repairs", () => {
  it("ships broken by default", () => {
    const app = new TaskletApp();
    const { user, taskId } = seed(app);
    expect(app.searchTasks(user, "groceries").tasks).toHaveLength(0);
    expect(app.updateTask(user, { taskId, dueDate: "2026-12-24" }).dueDate).toBe("2026-10-01");
    expect(app.listTasks(user, { page: 1 }).tasks).toHaveLength(0);
  });

  it("repairs only what it is asked to", () => {
    const app = new TaskletApp(undefined, parseRepairs("search-case"));
    const { user, taskId } = seed(app);
    expect(app.searchTasks(user, "groceries").tasks).toHaveLength(1);
    // The other two are untouched: a continuation run tests one fix at a time.
    expect(app.updateTask(user, { taskId, dueDate: "2026-12-24" }).dueDate).toBe("2026-10-01");
    expect(app.listTasks(user, { page: 1 }).tasks).toHaveLength(0);
  });

  it("repairs the dropped dueDate and the off-by-one page", () => {
    const app = new TaskletApp(undefined, parseRepairs("due-date,pagination"));
    const { user, taskId } = seed(app);
    expect(app.updateTask(user, { taskId, dueDate: "2026-12-24" }).dueDate).toBe("2026-12-24");
    // Page 1 is now the first page rather than the second, so the one task is on it.
    expect(app.listTasks(user, { page: 1 }).tasks).toHaveLength(1);
    expect(app.listTasks(user, { page: 2 }).tasks).toHaveLength(0);
  });

  it("rejects an unknown repair rather than silently ignoring it", () => {
    expect(() => parseRepairs("search-csae")).toThrow(/unknown repair/);
    expect(parseRepairs(undefined).size).toBe(0);
  });

  /**
   * The repairs are reachable from the PACKAGE ENTRY, not just from `./app.js`.
   *
   * Every other case in this file deep-imports `./app.js`, which is how the gap got in:
   * `startMockTarget` has taken a `repaired: ReadonlySet<Repairable>` option since it was written,
   * and `index.ts` re-exported neither the type that names its members nor the list they come from.
   * A consumer outside this package could therefore see the option and have no way to build a
   * value for it without importing past the entry point. This asserts the two names a caller
   * actually needs, through the entry, so dropping either from `index.ts` fails here at RUN time
   * rather than only in `tsc` — a type-only export can be deleted without vitest noticing.
   */
  it("names its repairs through the package entry, not only through the module inside", async () => {
    const entry = await import("./index.js");
    expect([...entry.REPAIRABLE]).toEqual(["search-case", "due-date", "pagination"]);

    // And the list is usable AS the option: one member of it, straight into a fresh app, repairs
    // exactly the defect it names and leaves the others planted.
    const onlySearch: ReadonlySet<Repairable> = new Set([entry.REPAIRABLE[0]]);
    const app = new entry.TaskletApp(undefined, onlySearch);
    const { user, taskId } = seed(app);
    expect(app.searchTasks(user, "groceries").tasks).toHaveLength(1);
    expect(app.updateTask(user, { taskId, dueDate: "2026-12-24" }).dueDate).toBe("2026-10-01");
  });
});
