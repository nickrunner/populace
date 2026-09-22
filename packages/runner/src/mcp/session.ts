import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { JsonValueSchema, type JsonObject, type JsonValue, type McpEndpoint, type ToolResultContent } from "@populace/core";

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
    // An explicit token wins: an identity's bearer IS who this connection is supposed to be, and
    // letting the SDK refresh a sign-in over the top of it would quietly swap the caller.
    const authProvider = token ? undefined : this.signIn;
    await client.connect(
      new StreamableHTTPClientTransport(new URL(this.endpoint.url), { requestInit: { headers }, ...(authProvider ? { authProvider } : {}) }),
    );
    this.client = client;
    const listed = await client.listTools();
    this.tools = listed.tools.map((t: Tool) => ({
      endpoint: this.endpoint.name,
      name: t.name,
      description: t.description ?? "",
      inputSchema: (toJson(t.inputSchema) as JsonObject | undefined) ?? { type: "object" },
      destructive: t.annotations?.destructiveHint === true,
      readOnly: t.annotations?.readOnlyHint === true,
    }));
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
