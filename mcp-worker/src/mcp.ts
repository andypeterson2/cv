import { McpAgent } from "agents/mcp";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools, callTool } from "./tools";
import type { Env, CvProps } from "./types";

/**
 * The cv MCP server as a Durable-Object-backed McpAgent. The 57 tools mount on the
 * low-level MCP Server via the same ListTools/CallTool request handlers the stdio
 * server used — no per-tool re-registration, no zod rewrite (McpAgent.server accepts
 * a low-level Server).
 *
 * Admin-only v1: OAuth (Google + ADMIN_EMAILS) gates WHO reaches this agent; every
 * authenticated caller then drives cv with the single admin CV_EDITOR_TOKEN. The
 * verified identity is carried in `this.props.email`.
 */
export class CvMcp extends McpAgent<Env, unknown, CvProps> {
  server = new Server({ name: "cv-editor", version: "0.2.0" }, { capabilities: { tools: {} } });

  async init(): Promise<void> {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools as any }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args = {} } = req.params;
      try {
        const result = await callTool(name, args);
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
