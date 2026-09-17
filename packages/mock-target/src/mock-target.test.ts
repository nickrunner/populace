import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockTarget, type RunningMockTarget } from "./index.js";

let target: RunningMockTarget;

async function connect(token?: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  await client.connect(new StreamableHTTPClientTransport(new URL(target.mcpUrl), { requestInit: { headers } }));
  return client;
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, string> {
  return (result.structuredContent ?? {}) as Record<string, string>;
}

beforeAll(async () => {
  target = await startMockTarget({ quiet: true });
});
afterAll(async () => {
  await target.close();
});

describe("mock target", () => {
  it("serves a landing page and health", async () => {
    const html = await (await fetch(target.url)).text();
    expect(html).toContain("Tasklet");
    expect(html).toContain("Delete tasks you no longer need");
    expect((await (await fetch(`${target.url}/health`)).json()) as object).toEqual({ ok: true, name: "Tasklet" });
  });

  it("lists tools with annotations and no delete_task", async () => {
    const anon = await connect();
    const { tools } = await anon.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("sign_up");
    expect(names).toContain("search_tasks");
    expect(names).not.toContain("delete_task");
    expect(tools.find((t) => t.name === "delete_project")?.annotations?.destructiveHint).toBe(true);
    await anon.close();
  });

  it("requires auth, supports self-signup, and exhibits the planted bugs", async () => {
    const anon = await connect();
    const denied = await anon.callTool({ name: "get_me", arguments: {} });
    expect(denied.isError).toBe(true);

    const signup = await anon.callTool({ name: "sign_up", arguments: { email: "a+populace:run_1@populace.test", displayName: "A", password: "hunter2hunter2" } });
    expect(signup.isError).toBeFalsy();
    const token = structured(signup).token;
    expect(token).toMatch(/^tk_/);
    await anon.close();

    const me = await connect(token);
    const project = structured(await me.callTool({ name: "create_project", arguments: { name: "Home" } }));
    const task = structured(await me.callTool({ name: "create_task", arguments: { projectId: project.id, title: "Buy Groceries", dueDate: "2026-10-01" } }));
    expect(task.dueDate).toBe("2026-10-01");

    // Bug 1: case-sensitive search.
    const exact = await me.callTool({ name: "search_tasks", arguments: { query: "Groceries" } });
    const lower = await me.callTool({ name: "search_tasks", arguments: { query: "groceries" } });
    expect((exact.structuredContent as { tasks: object[] }).tasks).toHaveLength(1);
    expect((lower.structuredContent as { tasks: object[] }).tasks).toHaveLength(0);

    // Bug 2: update_task drops dueDate.
    const updated = structured(await me.callTool({ name: "update_task", arguments: { taskId: task.id, dueDate: "2026-12-24" } }));
    expect(updated.dueDate).toBe("2026-10-01");

    // Bug 3: explicit page 1 skips the first page.
    const implicit = await me.callTool({ name: "list_tasks", arguments: {} });
    const explicit = await me.callTool({ name: "list_tasks", arguments: { page: 1 } });
    expect((implicit.structuredContent as { tasks: object[] }).tasks).toHaveLength(1);
    expect((explicit.structuredContent as { tasks: object[] }).tasks).toHaveLength(0);

    // Admin listing by tag and teardown through the tool.
    const listed = (await (await fetch(`${target.url}/admin/users?tag=populace:run_1`, { headers: { "x-admin-token": target.adminToken } })).json()) as { users: object[] };
    expect(listed.users).toHaveLength(1);
    const gone = await me.callTool({ name: "delete_account", arguments: {} });
    expect(gone.isError).toBeFalsy();
    const after = await me.callTool({ name: "get_me", arguments: {} });
    expect(after.isError).toBe(true);
    await me.close();
  });
});
