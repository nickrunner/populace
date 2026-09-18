import { describe, expect, it } from "vitest";
import { TaskletApp, parseRepairs } from "./app.js";

/** Signs up a user and gives them one task, so each case starts from the same place. */
function seed(app: TaskletApp): { user: ReturnType<TaskletApp["signUp"]>["user"]; taskId: string } {
  const { user } = app.signUp({ email: "a@b.test", displayName: "A", password: "pw-12345678" });
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
});
