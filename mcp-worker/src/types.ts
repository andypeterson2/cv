import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/**
 * Worker bindings + secrets. cv data lives on Railway; this Worker is a thin,
 * admin-only MCP front door to it (OAuth gates WHO gets in; every authenticated
 * caller then uses the single CV_EDITOR_TOKEN — admin-only v1).
 */
/** The native Workers rate-limit binding — `env.OAUTH_RATE_LIMITER.limit({ key })`. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  // Durable Object namespace backing the McpAgent sessions.
  MCP_OBJECT: DurableObjectNamespace;
  // KV required by @cloudflare/workers-oauth-provider for tokens/clients/grants.
  OAUTH_KV: KVNamespace;
  // Injected by OAuthProvider into the default (auth) handler.
  OAUTH_PROVIDER: OAuthHelpers;
  // Native Workers rate limiter (per-colo, best-effort) fronting the OAuth endpoints.
  OAUTH_RATE_LIMITER: RateLimiter;

  // cv-editor (Railway) REST base + the admin bearer token (secret).
  CV_EDITOR_URL: string;
  CV_EDITOR_TOKEN?: string;
  // Optional pre-formed Authorization header value (overrides CV_EDITOR_TOKEN).
  CV_EDITOR_AUTH?: string;

  // Comma-separated allowlist of Google emails granted access (admin-only v1).
  ADMIN_EMAILS: string;
  // This Worker's own public origin, e.g. https://mcp.andypeterson.dev (for signed /pdf links).
  MCP_PUBLIC_URL: string;

  // Google OAuth client (the upstream IdP this server proxies). Secrets.
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // HMAC key for signing the stateless OAuth state tokens (falls back to GOOGLE_CLIENT_SECRET).
  COOKIE_SECRET?: string;
}

/** Identity carried from the OAuth grant into the McpAgent via `this.props`. */
export type CvProps = {
  email: string;
  name?: string;
};
