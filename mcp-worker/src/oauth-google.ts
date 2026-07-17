/**
 * Default (auth) handler for the OAuth provider — a Google OAuth *proxy*.
 *
 * To Claude's connector we are an OAuth 2.1 server (PKCE + dynamic client
 * registration, handled by @cloudflare/workers-oauth-provider). To Google we are a
 * client. We show a consent page, bounce login to Google, and only complete the grant
 * when the verified email is in ADMIN_EMAILS (admin-only v1). The identity becomes
 * `this.props` inside CvMcp.
 *
 * CSRF/state is carried in STATELESS, HMAC-SIGNED tokens (see ./sign) — deliberately
 * NOT in cookies (they don't survive Claude's OAuth popup) and NOT in KV (eventually
 * consistent: a value written on the consent GET is not reliably readable on the POST
 * milliseconds later — "Consent expired or invalid"; also passes locally where
 * Miniflare KV is synchronous, then fails on real Cloudflare). ADMIN_EMAILS is the gate.
 *
 * DCR is public (Claude self-registers), so a hostile client could register an arbitrary
 * redirect_uri and try to intercept the auth code. We pin an allowlist of redirect hosts
 * (ALLOWED_REDIRECT_HOSTS) — the code can only ever be sent to a Claude/localhost callback.
 */
import type { Env } from "./types";
import { signingSecret, signPayload, verifyPayload } from "./sign";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const TTL_MS = 5 * 60 * 1000; // signed state tokens valid for 5 minutes (interactive hop + slack)
const GOOGLE_FETCH_TIMEOUT_MS = 8000;

// Where an OAuth authorization code may be redirected. DCR is public, so this — not the
// client's self-declared redirect_uri — is the real backstop against code interception.
// Add a host here if a new legitimate client (a different Claude domain) ever needs it.
const ALLOWED_REDIRECT_HOSTS = new Set(["claude.ai", "claude.com", "localhost", "127.0.0.1"]);

interface GoogleTokens { access_token?: string }
interface GoogleProfile { email?: string; email_verified?: boolean | string; name?: string }

function isAllowedRedirect(uri: unknown): boolean {
  try {
    return ALLOWED_REDIRECT_HOSTS.has(new URL(String(uri)).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function adminEmails(env: Env): string[] {
  return String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
}

function sanitizeText(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function securityHeaders(): Headers {
  const csp = [
    "default-src 'none'", "style-src 'self' 'unsafe-inline'",
    // MUST allow Google: the consent POST redirects (302) to accounts.google.com, and
    // modern browsers enforce form-action against the REDIRECT target — 'self' alone
    // silently blocks the hop to Google (the "Continue with Google click does nothing" bug).
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'", "base-uri 'self'",
  ].join("; ");
  return new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": csp,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  });
}

function consentPage(opts: { clientName: string; query: string; token: string }): Response {
  const name = sanitizeText(opts.clientName || "An MCP client");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Authorize cv MCP</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem;">
<h1 style="font-size:1.25rem;">Authorize access</h1>
<p><strong>${name}</strong> is requesting access to the cv MCP server.</p>
<p style="color:#555;">You'll sign in with Google. Access is granted only to the owner's allowlisted account.</p>
<form method="POST" action="/authorize?${sanitizeText(opts.query)}">
  <input type="hidden" name="t" value="${sanitizeText(opts.token)}"/>
  <button type="submit" style="padding:.6rem 1rem; background:#000; color:#fff; border:0; border-radius:.4rem; cursor:pointer;">Continue with Google</button>
</form>
</body></html>`;
  return new Response(html, { headers: securityHeaders() });
}

function denyPage(email: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Access denied</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem;">
<h1 style="font-size:1.25rem;">Access denied</h1>
<p>The account <strong>${sanitizeText(email)}</strong> is not authorized for this MCP server.</p>
</body></html>`;
  return new Response(html, { status: 403, headers: securityHeaders() });
}

export const GoogleAuthHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const provider = env.OAUTH_PROVIDER;
    const url = new URL(request.url);
    const secret = signingSecret(env);
    if (!secret) {
      // Fail closed with a clear message instead of a cryptic HMAC DataError.
      return new Response("Server misconfigured: set the COOKIE_SECRET (or GOOGLE_CLIENT_SECRET) worker secret.", { status: 500 });
    }

    if (url.pathname === "/authorize") {
      // GET → show consent, embedding the parsed auth request in a signed token.
      if (request.method === "GET") {
        // parseAuthRequest THROWS on a malformed/incomplete request (no client_id, bad
        // response_type — or just a scanner poking /authorize). Unhandled, that's an
        // uncaught Worker exception: the caller gets an opaque Cloudflare 1101 and the
        // noise buries real errors. A bad request is a 400.
        let oauthReq;
        try {
          oauthReq = await provider.parseAuthRequest(request);
        } catch {
          return new Response("Invalid authorization request.", { status: 400 });
        }
        // Pin the redirect target (DCR is public — the client's redirect_uri is untrusted).
        if (!isAllowedRedirect(oauthReq.redirectUri)) {
          return new Response("Unregistered redirect_uri.", { status: 400 });
        }
        let clientName = "";
        try {
          const client = await provider.lookupClient(oauthReq.clientId);
          clientName = (client as any)?.clientName || (client as any)?.clientId || "";
        } catch {
          /* unknown client — render with a generic label */
        }
        const token = await signPayload(oauthReq, secret);
        return consentPage({ clientName, query: url.searchParams.toString(), token });
      }

      // POST → verify the signed token (CSRF; no lookup), then redirect to Google.
      if (request.method === "POST") {
        // Same reasoning as the GET: formData() throws on a non-form body, and an
        // unauthenticated endpoint must not answer garbage with an uncaught throw.
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response("Invalid authorization request.", { status: 400 });
        }
        const oauthReq = await verifyPayload(String(form.get("t") || ""), secret, TTL_MS);
        if (!oauthReq) {
          return new Response("Consent expired or invalid — please restart the connection.", { status: 400 });
        }
        const stateToken = await signPayload(oauthReq, secret);
        const googleUrl = new URL(GOOGLE_AUTH);
        googleUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
        googleUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
        googleUrl.searchParams.set("response_type", "code");
        googleUrl.searchParams.set("scope", "openid email profile");
        googleUrl.searchParams.set("state", stateToken);
        googleUrl.searchParams.set("access_type", "online");
        googleUrl.searchParams.set("prompt", "select_account");
        return Response.redirect(googleUrl.toString(), 302);
      }

      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }

    // Google redirects back with ?code&state — verify the signed state, then finish.
    if (url.pathname === "/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const oauthReq = await verifyPayload(url.searchParams.get("state") || "", secret, TTL_MS);
      if (!code || !oauthReq) {
        return new Response("Invalid or expired authorization — please restart the connection.", { status: 400 });
      }

      // Exchange the code for tokens at Google (bounded — don't hang on a stalled IdP).
      let tokens: GoogleTokens;
      try {
        const tokenRes = await fetch(GOOGLE_TOKEN, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${url.origin}/callback`,
            grant_type: "authorization_code",
          }),
          signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
        });
        if (!tokenRes.ok) return new Response("Google token exchange failed", { status: 502 });
        tokens = (await tokenRes.json()) as GoogleTokens;
      } catch {
        return new Response("Google token exchange timed out", { status: 504 });
      }

      // Fetch the verified profile.
      let profile: GoogleProfile;
      try {
        const userRes = await fetch(GOOGLE_USERINFO, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
        });
        if (!userRes.ok) return new Response("Google userinfo failed", { status: 502 });
        profile = (await userRes.json()) as GoogleProfile;
      } catch {
        return new Response("Google userinfo timed out", { status: 504 });
      }

      const email = String(profile.email || "").toLowerCase();
      const verified = profile.email_verified === true || profile.email_verified === "true";

      if (!email || !verified || !adminEmails(env).includes(email)) {
        return denyPage(email || "(unknown)");
      }

      // Complete the grant — identity flows into CvMcp via this.props.
      const { redirectTo } = await provider.completeAuthorization({
        request: oauthReq,
        userId: email,
        scope: oauthReq.scope || [],
        props: { email, name: profile.name },
        metadata: undefined,
      });
      return Response.redirect(redirectTo, 302);
    }

    return new Response("Not found", { status: 404 });
  },
};
