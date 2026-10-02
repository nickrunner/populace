import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError, PRODUCT_INFO, publicUser, type TaskletApp } from "./app.js";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function ok(value: object): CallToolResult {
  // Serialising through JSON keeps structuredContent a plain object for the SDK.
  // eslint-disable-next-line no-restricted-syntax -- app objects are plain data; the cast is to the SDK's record type.
  const structured = JSON.parse(JSON.stringify(value)) as { [k: string]: unknown };
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: structured };
}

function fail(code: string, message: string): CallToolResult {
  const body: Json = { error: { code, message } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

function guard(fn: () => object): CallToolResult {
  try {
    return ok(fn());
  } catch (err) {
    if (err instanceof AppError) return fail(err.code, err.message);
    return fail("internal", err instanceof Error ? err.message : String(err));
  }
}

const priority = z.enum(["low", "normal", "high"]);

/**
 * Builds the Tasklet MCP server. Auth is a bearer token from `sign_up`/`log_in`,
 * surfaced to handlers as `extra.authInfo.token`.
 *
 * `callerToken` is the bearer the HTTP request arrived with, and it is here because the TOOL LIST
 * depends on who is asking: a Pro account is shown `export_tasks` and a free one is not. Tasklet is
 * stateless over HTTP, so a server is built per request and the listing is simply a function of the
 * caller — which is what makes `upgrade_plan` a tool that changes the tool list, and therefore one
 * that has to say so with `notifications/tools/list_changed`.
 */
export function buildMcpServer(app: TaskletApp, callerToken?: string): McpServer {
  const server = new McpServer({ name: "tasklet", version: "0.1.0" });

  server.registerTool(
    "get_product_info",
    { description: "What Tasklet is, what it does and what it costs. No account needed.", annotations: { readOnlyHint: true } },
    () => ok(PRODUCT_INFO),
  );

  server.registerTool(
    "sign_up",
    {
      description: "Create a free Tasklet account. Returns a bearer token to use with every other tool.",
      inputSchema: { email: z.string().describe("Your email address"), displayName: z.string().describe("Name shown on your profile"), password: z.string().min(8).describe("At least 8 characters") },
    },
    (args) => guard(() => app.signUp(args)),
  );

  server.registerTool(
    "log_in",
    { description: "Log in to an existing account. Returns a bearer token.", inputSchema: { email: z.string(), password: z.string() } },
    (args) => guard(() => app.logIn(args)),
  );

  server.registerTool("get_me", { description: "Your profile and plan.", annotations: { readOnlyHint: true } }, (extra) =>
    guard(() => publicUser(app.userForToken(extra.authInfo?.token))),
  );

  server.registerTool(
    "upgrade_plan",
    { description: "Upgrade to the Pro plan ($6/month, unlimited projects). Billing is simulated; no card is charged." },
    async (extra) => {
      const result = guard(() => app.upgradePlan(app.userForToken(extra.authInfo?.token)));
      // The upgrade unlocks `export_tasks`, so the list the caller was handed at connect is now
      // wrong. It goes out through `extra.sendNotification` rather than `server.sendToolListChanged`
      // because this server has no standalone stream to notify on — it is built for this one
      // request — so the notification has to ride the response stream of this very call, ahead of
      // the result below. That is the shape a client has to cope with, and the reason it is here.
      if (result.isError !== true) await extra.sendNotification({ method: "notifications/tools/list_changed" });
      return result;
    },
  );

  server.registerTool(
    "create_project",
    { description: "Create a project. Free accounts can have up to 3 projects.", inputSchema: { name: z.string(), description: z.string().optional() } },
    (args, extra) => guard(() => app.createProject(app.userForToken(extra.authInfo?.token), args)),
  );

  server.registerTool("list_projects", { description: "List your projects with open/done task counts.", annotations: { readOnlyHint: true } }, (extra) =>
    guard(() => ({ projects: app.listProjects(app.userForToken(extra.authInfo?.token)) })),
  );

  server.registerTool(
    "delete_project",
    {
      description: "Permanently delete a project and every task and comment in it.",
      inputSchema: { projectId: z.string() },
      annotations: { destructiveHint: true },
    },
    (args, extra) => guard(() => app.deleteProject(app.userForToken(extra.authInfo?.token), args.projectId)),
  );

  server.registerTool(
    "create_task",
    {
      description: "Add a task to a project.",
      inputSchema: {
        projectId: z.string(),
        title: z.string(),
        notes: z.string().optional(),
        dueDate: z.string().optional().describe("YYYY-MM-DD"),
        priority: priority.optional().describe("low, normal (default) or high"),
      },
    },
    (args, extra) => guard(() => app.createTask(app.userForToken(extra.authInfo?.token), args)),
  );

  server.registerTool(
    "get_task",
    { description: "Fetch one task by id.", inputSchema: { taskId: z.string() }, annotations: { readOnlyHint: true } },
    (args, extra) => guard(() => app.getTask(app.userForToken(extra.authInfo?.token), args.taskId)),
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List your tasks, optionally filtered by project and status. Paginated: `page` is the 1-based page number (default 1), `pageSize` defaults to 20.",
      inputSchema: {
        projectId: z.string().optional(),
        status: z.enum(["open", "done"]).optional(),
        page: z.number().int().min(1).optional().describe("1-based page number"),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) => guard(() => app.listTasks(app.userForToken(extra.authInfo?.token), args)),
  );

  server.registerTool(
    "update_task",
    {
      description: "Change a task's title, notes, due date or priority. Only the fields you pass are changed.",
      inputSchema: {
        taskId: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        dueDate: z.string().nullable().optional().describe("YYYY-MM-DD, or null to clear"),
        priority: priority.optional(),
      },
    },
    (args, extra) => guard(() => app.updateTask(app.userForToken(extra.authInfo?.token), args)),
  );

  server.registerTool("complete_task", { description: "Mark a task as done.", inputSchema: { taskId: z.string() } }, (args, extra) =>
    guard(() => app.completeTask(app.userForToken(extra.authInfo?.token), args.taskId)),
  );

  server.registerTool("reopen_task", { description: "Mark a done task as open again.", inputSchema: { taskId: z.string() } }, (args, extra) =>
    guard(() => app.reopenTask(app.userForToken(extra.authInfo?.token), args.taskId)),
  );

  server.registerTool(
    "search_tasks",
    {
      description: "Search your tasks. Case-insensitive substring match on title and notes.",
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) => guard(() => app.searchTasks(app.userForToken(extra.authInfo?.token), args.query)),
  );

  server.registerTool("add_comment", { description: "Add a comment to a task.", inputSchema: { taskId: z.string(), body: z.string() } }, (args, extra) =>
    guard(() => app.addComment(app.userForToken(extra.authInfo?.token), args)),
  );

  server.registerTool(
    "list_comments",
    { description: "List comments on a task, oldest first.", inputSchema: { taskId: z.string() }, annotations: { readOnlyHint: true } },
    (args, extra) => guard(() => ({ comments: app.listComments(app.userForToken(extra.authInfo?.token), args.taskId) })),
  );

  server.registerTool("get_stats", { description: "Counts of projects, open, done and overdue tasks, and comments.", annotations: { readOnlyHint: true } }, (extra) =>
    guard(() => app.stats(app.userForToken(extra.authInfo?.token))),
  );

  server.registerTool(
    "delete_account",
    { description: "Permanently delete your account and everything in it.", annotations: { destructiveHint: true } },
    (extra) =>
      guard(() => {
        app.deleteAccount(app.userForToken(extra.authInfo?.token));
        return { deleted: true };
      }),
  );

  // Pro only, and therefore not in every caller's listing: this is the tool `upgrade_plan` adds.
  if (app.isPro(callerToken)) {
    server.registerTool(
      "export_tasks",
      { description: "Export every task you own as JSON. Pro plan only.", annotations: { readOnlyHint: true } },
      (extra) => guard(() => app.exportTasks(app.userForToken(extra.authInfo?.token))),
    );
  }

  // Intentionally missing: `delete_task`. The product info and landing page both promise it.
  return server;
}
