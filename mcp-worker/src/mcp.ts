import { McpAgent } from "agents/mcp";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools, callTool } from "./tools";
import { cvCtx } from "./cv-ctx";
import type { Env, CvProps } from "./types";

/**
 * The cv MCP server as a Durable-Object-backed McpAgent. The 57 tools mount on the
 * low-level MCP Server via the same ListTools/CallTool request handlers the stdio
 * server used — no per-tool re-registration, no zod rewrite (McpAgent.server accepts
 * a low-level Server).
 *
 * OAuth (Google + ADMIN_EMAILS) gates WHO reaches this agent; each authenticated
 * caller is resolved to its OWN cv user id (`this.props.cvUserId`) and every tool
 * call runs scoped to it via X-User-Id — no shared owner token. The user id is put
 * into an AsyncLocalStorage at dispatch so all 57 handlers stay untouched.
 */
export class CvMcp extends McpAgent<Env, unknown, CvProps> {
  server = new Server({ name: "cv-editor", version: "0.2.0" }, { capabilities: { tools: {} } });

  async init(): Promise<void> {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools as any }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args = {} } = req.params;
      try {
        // Scope every cv call to the authenticated caller (see cv-ctx). api() reads this.
        const cvUserId = this.props?.cvUserId;
        if (cvUserId == null) throw new Error("Not authenticated: no cv user id on this session.");
        const result = await cvCtx.run({ cvUserId }, () => callTool(name, args));
        // cv_get_pdf (and any future binary tool) returns a ready-made MCP content
        // array under `__content`; everything else is JSON-stringified as text.
        if (result && typeof result === "object" && Array.isArray((result as any).__content)) {
          return { content: (result as any).__content };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
      }
    });
  }
}
