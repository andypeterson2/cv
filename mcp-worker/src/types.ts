import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/**
 * Worker bindings + secrets. cv data lives on Railway; this Worker is a thin MCP
 * front door to it (OAuth gates WHO gets in; each authenticated caller is resolved
 * to its own cv user and drives cv scoped by a verified `X-User-Id`, per-user phase 1).
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

  // cv-editor (Railway) REST base.
  CV_EDITOR_URL: string;
  // Shared front-door secret cv's origin-guard checks (secret). Also the proof that
  // lets this Worker inject a verified per-caller X-User-Id (see cv lib/current-user.js).
  CV_ORIGIN_SECRET?: string;
  // CF Access service-token (Stage 6, tech-debt #12): presented to cv's tunnel host
  // when both are set, so its Access policy admits only this front door.
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;

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
  // The cv user id this Google identity resolves to (POST /api/auth/upsert-user). Every
  // cv call is scoped to it via X-User-Id — no shared owner token. (Admin-only for now,
  // so in practice this is the owner mapped to @owner; the plumbing is fully per-user.)
  cvUserId: number;
};
