# @populace/mock-target

**Tasklet** is a deliberately small task-list product with its own MCP server.
It exists so populace can be developed and tested without any external service.
Nothing in it references a real product.

## Run it

```bash
pnpm build
pnpm mock-target --port 4310            # MCP at http://127.0.0.1:4310/mcp
pnpm mock-target --port 4310 --state .populace/tasklet.json   # keep accounts across restarts
```

Endpoints:

| Path | What |
| --- | --- |
| `POST /mcp` | Streamable HTTP MCP endpoint (stateless, SSE responses). Bearer token from `sign_up`/`log_in`. |
| `GET /` | Landing page with the product pitch (used by the agent's web fetch). |
| `GET /health` | `{ ok: true }` |
| `GET /admin/users?tag=…` | List users whose email contains the tag. Header `x-admin-token` (default `admin`, env `MOCK_TARGET_ADMIN_TOKEN`). |
| `DELETE /admin/users/:id` | Delete a user and everything they own. |
| `POST /admin/reset` | Wipe all state. |

## Tools

`get_product_info`, `sign_up`, `log_in`, `get_me`, `upgrade_plan`, `create_project`, `list_projects`,
`delete_project` (destructive), `create_task`, `get_task`, `list_tasks`, `update_task`, `complete_task`,
`reopen_task`, `search_tasks`, `add_comment`, `list_comments`, `get_stats`, `delete_account` (destructive),
and `export_tasks` **to a Pro caller only**.

### The tool list is not fixed for the length of a session

`export_tasks` is listed to a Pro account and to nobody else, so `upgrade_plan` is a call that
changes what the caller may do next — and it announces that with
`notifications/tools/list_changed`. This server is stateless, so it has no standalone stream to
notify on: the notification rides the response stream of the upgrade call itself, ahead of that
call's result, which is why `/mcp` answers with SSE rather than a single JSON body (in
JSON-response mode the transport drops a notification and only the result arrives).

That is deliberately the awkward shape a real target has, and it is what the runner's mid-visit
tool refresh is tested against: a client that only reads results never hears the news, and a client
that re-lists on the notification sees `export_tasks` appear without reconnecting.

## Planted defects

These are on purpose. A good population should find all four; the digest for the
mock target is expected to list each of them.

| # | Kind | Tool | What is wrong | How to see it |
| --- | --- | --- | --- | --- |
| 1 | bug | `search_tasks` | Description promises a case-insensitive match; the match is case-sensitive. | Create a task titled `Buy Groceries`, search `groceries`: 0 results. Search `Groceries`: 1 result. |
| 2 | bug | `update_task` | `dueDate` is accepted and validated but never written. | Create a task with `dueDate: 2026-10-01`, update with `dueDate: 2026-12-24`; the returned task (and `get_task`) still shows `2026-10-01`. |
| 3 | bug | `list_tasks` | `page` is documented 1-based but treated as a 0-based offset multiplier. | With fewer than 20 tasks, `list_tasks({})` returns them; `list_tasks({ page: 1 })` returns an empty page with the correct `total`. |
| 4 | coverage gap | `delete_task` (missing) | The product info and the landing page promise "Delete tasks you no longer need"; no tool deletes a task. Only whole projects can be deleted. | Look for a delete tool after creating a task. |

Also true but not defects: the free plan caps projects at 3 (the persona with many projects hits a paywall, which should show up as friction or abandonment, not a bug), and `delete_project` and `delete_account` carry `destructiveHint: true`, which by default goes through untouched — a target that wants them held back says so in its own tool policy (ADR-0013 amendment).
