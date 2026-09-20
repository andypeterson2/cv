import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { CvMcp } from './mcp';
import { GoogleAuthHandler } from './oauth-google';
import { fetchVariantPdf } from './tools';
import { signingSecret, verifyPayload } from './sign';
import { cvCtx } from './cv-ctx';
import type { Env } from './types';

// The Durable Object class must be exported from the Worker entry.
export { CvMcp };

/**
 * OAuth 2.1 in front of the MCP endpoint. Claude's connector registers dynamically
 * (DCR) + does PKCE; this provider proxies login to Google and only completes the
 * grant for an ADMIN_EMAILS address (see ./oauth-google). Authenticated tool calls
 * then run inside CvMcp with the verified identity on `this.props`.
 *
 * Routing: /mcp = the MCP endpoint (apiHandlers); /authorize + /callback = the
 * Google handler; /token + /register + /.well-known/* = the provider.
 */
const oauth = new OAuthProvider({
  apiHandlers: { '/mcp': CvMcp.serve('/mcp', { binding: 'MCP_OBJECT' }) as any },
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  defaultHandler: GoogleAuthHandler as any,
});

/**
 * Default-DENY path allowlist (defense in depth; mirrored by a Cloudflare WAF rule
 * at the edge). The only paths this server legitimately serves are the MCP endpoint,
 * the OAuth 2.1 endpoints, and the OAuth/OIDC discovery metadata. Everything else —
 * the endless `.env` / `.git` / `.aws` / `wp-admin` credential-scanner probes — gets
 * a uniform 404 before it can reach the OAuth provider or the Durable Object.
 */
function isAllowedPath(pathname: string): boolean {
  // MCP Streamable-HTTP endpoint (+ any transport sub-path).
  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) return true;
  // OAuth 2.1 endpoints — authorize/callback are ours; token/register the provider's.
  if (
    pathname === '/authorize' ||
    pathname === '/callback' ||
    pathname === '/token' ||
    pathname === '/register'
  )
    return true;
  // OAuth 2.0 / OIDC discovery metadata (RFC 8414 / RFC 9728 / OpenID) — public metadata, no secrets.
  if (pathname.startsWith('/.well-known/')) return true;
  return false;
}

// OAuth endpoints a single source might hammer. `/mcp` (token-gated, chatty) and
// `/.well-known/*` (cheap discovery clients must reach) stay unlimited.
const RATE_LIMITED_PATHS = new Set(['/authorize', '/callback', '/token', '/register']);

// Signed download links are limited too: each one runs a full xelatex compile on the
// cv origin, and a link stays replayable for its whole lifetime.

function isPdfPath(pathname: string): boolean {
  return pathname.startsWith('/pdf/');
}

const PDF_LINK_TTL_MS = 5 * 60 * 1000;

/**
 * Serve a compiled PDF from a signed, short-lived `/pdf/<token>` link (minted by
 * cv_get_pdf). The token authorizes exactly one variant for ~5 min; the Worker streams
 * the PDF from the cv backend using the admin token, so the link itself carries no
 * credentials. This is how PDFs are delivered — Claude's connector rejects an inline blob.
 */
async function servePdf(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).pathname.slice('/pdf/'.length);
  const payload = await verifyPayload(token, signingSecret(env), PDF_LINK_TTL_MS);
  if (!payload || typeof payload.v !== 'number' || typeof payload.u !== 'number') {
    return new Response('Invalid or expired download link.', {
      status: 403,
      headers: { 'x-content-type-options': 'nosniff' },
    });
  }
  try {
    // Fetch scoped to the user the link was minted for (cv checks the variant is theirs).
    const bytes = await cvCtx.run({ cvUserId: payload.u }, () =>
      fetchVariantPdf(payload.v as number),
    );
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="cv-variant-${payload.v}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e: any) {
    return new Response(`PDF unavailable: ${e.message}`, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    const pdf = isPdfPath(pathname);

    // 1. Default-deny: only allowlisted paths (and the signed PDF links) get past
    //    the front door. Stealth 404 blocks a scan before any other logic runs.
    if (!pdf && !isAllowedPath(pathname)) {
      return new Response('Not found', {
        status: 404,
        headers: { 'x-content-type-options': 'nosniff' },
      });
    }

    // 2. Rate-limit per client IP. Cloudflare sets CF-Connecting-IP at the edge
    //    (clients can't spoof it); best-effort throttling of a hammering source.
    if (pdf || RATE_LIMITED_PATHS.has(pathname)) {
      const key = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.OAUTH_RATE_LIMITER.limit({ key });
      if (!success) {
        return new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': '60', 'x-content-type-options': 'nosniff' },
        });
      }
    }

    // 3. Signed PDF download links (cv_get_pdf) — served outside the OAuth flow.
    if (pdf) return servePdf(request, env);

    return oauth.fetch(request, env, ctx);
  },
};
