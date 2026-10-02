import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { JsonValueSchema, type JsonObject, type JsonValue, type McpEndpoint, type ToolResultContent } from "@populace/core";
import { z } from "zod";

/** What the SDK's transport error carries besides its message: the HTTP status it got. */
const HttpStatusShape = z.object({ code: z.number().int().min(100).max(599) });

/**
 * The HTTP status behind a failed connect, when there is one.
 *
 * The SDK answers an HTTP response it did not like with a `StreamableHTTPError` whose message
 * quotes the body and whose `code` is the status — and only the message reaches a caller's
 * `catch` as words. A caller telling "the address answered 401" from "nothing answered at all"
 * needs the number: the body is somebody else's and says whatever they chose. Null for a
 * connection that was refused, a name that did not resolve, a timeout — anything with no response.
 */
export function httpStatusOf(err: Error): number | null {
  const parsed = HttpStatusShape.safeParse(err);
  return parsed.success ? parsed.data.code : null;
}

export interface TargetTool {
  endpoint: string;
  name: string;
  description: string;
  inputSchema: JsonObject;
  destructive: boolean;
  readOnly: boolean;
}

export interface CallOutcome {
  result: ToolResultContent;
  /** structuredContent when present, else the text parsed as JSON, else the raw text. */
  data: JsonValue;
  latencyMs: number;
}

function toJson(value: object | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  const parsed = JsonValueSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function textOf(result: CallToolResult): string {
  const parts: string[] = [];
  for (const block of result.content) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "image") parts.push(`[image ${block.mimeType} omitted]`);
    else if (block.type === "audio") parts.push(`[audio ${block.mimeType} omitted]`);
    else if (block.type === "resource_link") parts.push(`[resource ${block.uri}]`);
    else parts.push("[embedded resource omitted]");
  }
  return parts.join("\n");
}

/**
 * One endpoint's MCP connection, owned by the runner (ADR-0005). Reconnects
 * when a bearer token is acquired mid-wake (self-signup).
 */
export class McpSession {
  private client: Client | null = null;
  private tools: TargetTool[] = [];
  private stale = false;

  /**
   * `signIn` is the USER's OAuth grant and is only ever passed by the things that act as the user
   * — the connection check and the tool list behind it (ADR-0036). A wake passes an identity's
   * bearer token and nothing else: an owner's grant handed to a population would send every person
   * in wearing the owner's face.
   */
  constructor(
    readonly endpoint: McpEndpoint,
    private bearerToken: string | undefined,
    private readonly signIn?: OAuthClientProvider,
  ) {}

  get token(): string | undefined {
    return this.bearerToken;
  }

  async connect(): Promise<void> {
    await this.close();
    const headers: Record<string, string> = { ...this.endpoint.headers };
    const token = this.bearerToken ?? this.endpoint.bearerToken;
    if (token) headers.authorization = `Bearer ${token}`;
    const client = new Client({ name: "populace-runner", version: "0.1.0" });
    // Registered BEFORE connect, because a target that has no standalone stream to notify on sends
    // `notifications/tools/list_changed` down the response stream of the very call that changed the
    // list — so the handler has to exist before the first tool call, not be added after one.
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      this.stale = true;
      return Promise.resolve();
    });
    // An explicit token wins: an identity's bearer IS who this connection is supposed to be, and
    // letting the SDK refresh a sign-in over the top of it would quietly swap the caller.
    const authProvider = token ? undefined : this.signIn;
    await client.connect(
      new StreamableHTTPClientTransport(new URL(this.endpoint.url), { requestInit: { headers }, ...(authProvider ? { authProvider } : {}) }),
    );
    this.client = client;
    // A fresh connection has just listed; anything the old one was told is somebody else's news.
    this.stale = false;
    this.tools = await this.loadTools(client);
  }

  /**
   * Every tool the endpoint lists, following `nextCursor` to the end.
   *
   * A paged target used to arrive truncated: the first page became the whole toolset for the
   * session and the rest of the product was simply invisible to the person. The repeated-cursor
   * guard is for a server that answers every page with the same cursor — a wake is not allowed to
   * hang on somebody else's bug.
   */
  private async loadTools(client: Client): Promise<TargetTool[]> {
    const out: TargetTool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const listed = await client.listTools(cursor === undefined ? {} : { cursor });
      for (const t of listed.tools satisfies Tool[]) {
        out.push({
          endpoint: this.endpoint.name,
          name: t.name,
          description: t.description ?? "",
          inputSchema: (toJson(t.inputSchema) as JsonObject | undefined) ?? { type: "object" },
          destructive: t.annotations?.destructiveHint === true,
          readOnly: t.annotations?.readOnlyHint === true,
        });
      }
      cursor = listed.nextCursor;
      if (cursor !== undefined && seen.has(cursor)) break;
      if (cursor !== undefined) seen.add(cursor);
    } while (cursor !== undefined);
    return out;
  }

  /**
   * Whether the target has said its tool list changed since this session last listed.
   *
   * It is a flag rather than a callback because the notification arrives on the response stream of
   * the call that caused the change, ahead of that call's result: by the time `call()` resolves the
   * handler has already run, so a caller that reads this right after a call needs no polling and no
   * timer.
   */
  get toolsStale(): boolean {
    return this.stale;
  }

  /**
   * Re-lists the endpoint's tools and reports what the TARGET's listing gained and lost — not what
   * a policy then permits, which this class knows nothing about.
   *
   * It does not reconnect. Reconnecting would re-run `initialize` for no reason, and on a
   * self-signup target it would do it with whatever bearer the session happens to hold.
   */
  async refreshTools(): Promise<{ added: string[]; removed: string[] }> {
    const client = this.client;
    if (!client) throw new Error(`endpoint ${this.endpoint.name} is not connected`);
    // Cleared before the listing, not after: a second change landing while this request is in
    // flight has to leave the flag set, or the session keeps a list it was already told is stale.
    this.stale = false;
    const before = new Set(this.tools.map((t) => t.name));
    const listed = await this.loadTools(client);
    const after = new Set(listed.map((t) => t.name));
    this.tools = listed;
    return {
      added: [...after].filter((name) => !before.has(name)),
      removed: [...before].filter((name) => !after.has(name)),
    };
  }

  async reconnectWith(bearerToken: string): Promise<void> {
    this.bearerToken = bearerToken;
    await this.connect();
  }

  listTools(): TargetTool[] {
    return this.tools;
  }

  /**
   * What the server called itself in the initialize handshake. The connection panel shows it so a
   * user can tell one endpoint from another; it is whatever the server chose to report, not a
   * protocol guarantee.
   */
  get serverInfo(): { name: string; version: string } | null {
    const reported = this.client?.getServerVersion();
    return reported ? { name: reported.name, version: reported.version } : null;
  }

  hasTool(name: string): boolean {
    return this.tools.some((t) => t.name === name);
  }

  async call(name: string, args: JsonObject): Promise<CallOutcome> {
    if (!this.client) throw new Error(`endpoint ${this.endpoint.name} is not connected`);
    const started = Date.now();
    let result: CallToolResult;
    try {
      // The SDK validates the result shape; we only need the wire fields.
      result = (await this.client.callTool({ name, arguments: args })) as CallToolResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: { text: `error: ${message}`, isError: true },
        data: { error: message },
        latencyMs: Date.now() - started,
      };
    }
    const text = textOf(result);
    const structured = toJson(result.structuredContent);
    let data: JsonValue = text;
    if (structured !== undefined) data = structured;
    else {
      try {
        // eslint-disable-next-line no-restricted-syntax -- wire JSON validated by JsonValueSchema right after.
        const parsed = JsonValueSchema.safeParse(JSON.parse(text) as unknown);
        if (parsed.success) data = parsed.data;
      } catch {
        /* plain text result */
      }
    }
    const content: ToolResultContent = { text, isError: result.isError === true, ...(structured !== undefined ? { structured } : {}) };
    return { result: content, data, latencyMs: Date.now() - started };
  }

  async close(): Promise<void> {
    if (this.client) {
      const client = this.client;
      this.client = null;
      await client.close().catch(() => undefined);
    }
  }
}
