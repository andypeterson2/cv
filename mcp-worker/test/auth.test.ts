/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signPayload, verifyPayload, signingSecret } from '../src/sign';
import { GoogleAuthHandler } from '../src/oauth-google';
import worker from '../src/index';

const SECRET = 'test-signing-secret';
const MINUTE = 60 * 1000;

// A worker env with only the pieces the front door itself reads. The OAuth provider
// and the cv origin are stubbed per test, so nothing here reaches the network.
const stubEnv = (over: Record<string, unknown> = {}) =>
  ({
    OAUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    COOKIE_SECRET: SECRET,
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsecret',
    ADMIN_EMAILS: 'admin@test.dev',
    CV_EDITOR_URL: 'http://cv.test',
    CV_ORIGIN_SECRET: 'front-door',
    MCP_PUBLIC_URL: 'https://mcp.test',
    ...over,
  }) as any;

const ctx = {} as ExecutionContext;

describe('signed tokens', () => {
  it('round-trips a payload', async () => {
    const t = await signPayload({ v: 7, u: 3 }, SECRET);
    expect(await verifyPayload(t, SECRET, MINUTE)).toEqual({ v: 7, u: 3 });
  });

  it('refuses a token signed with a different secret', async () => {
    const t = await signPayload({ v: 7 }, SECRET);
    expect(await verifyPayload(t, 'other-secret', MINUTE)).toBe(null);
  });

  it('refuses a tampered body', async () => {
    const t = await signPayload({ v: 7, u: 3 }, SECRET);
    const [, sig] = t.split('.');
    const forged = btoa(JSON.stringify({ d: { v: 99, u: 3 }, iat: Date.now() }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyPayload(`${forged}.${sig}`, SECRET, MINUTE)).toBe(null);
  });

  it('refuses a tampered signature', async () => {
    const t = await signPayload({ v: 7 }, SECRET);
    const [body] = t.split('.');
    expect(await verifyPayload(`${body}.AAAA`, SECRET, MINUTE)).toBe(null);
  });

  it('refuses a token past its lifetime', async () => {
    const t = await signPayload({ v: 7 }, SECRET);
    expect(await verifyPayload(t, SECRET, -1)).toBe(null);
  });

  it('refuses malformed input', async () => {
    for (const bad of ['', '.', 'nodot', 'a.b.c']) {
      expect(await verifyPayload(bad, SECRET, MINUTE)).toBe(null);
    }
  });

  it('prefers COOKIE_SECRET and falls back to the Google client secret', () => {
    expect(signingSecret({ COOKIE_SECRET: 'a', GOOGLE_CLIENT_SECRET: 'b' })).toBe('a');
    expect(signingSecret({ GOOGLE_CLIENT_SECRET: 'b' })).toBe('b');
    expect(signingSecret({})).toBe('');
  });
});

describe('front door — path allowlist', () => {
  it('404s the credential scanners', async () => {
    for (const p of ['/.env', '/.git/config', '/wp-admin', '/.aws/credentials', '/']) {
      const res = await worker.fetch(new Request(`https://mcp.test${p}`), stubEnv(), ctx);
      expect(res.status, p).toBe(404);
    }
  });

  it('lets the signed PDF route through the allowlist', async () => {
    const res = await worker.fetch(new Request('https://mcp.test/pdf/bogus'), stubEnv(), ctx);
    expect(res.status).toBe(403); // reaches the link check and is refused there
  });
});

describe('front door — rate limiting', () => {
  const limited = () =>
    stubEnv({ OAUTH_RATE_LIMITER: { limit: async () => ({ success: false }) } });

  it('429s a hammered OAuth endpoint', async () => {
    for (const p of ['/authorize', '/callback', '/token', '/register']) {
      const res = await worker.fetch(new Request(`https://mcp.test${p}`), limited(), ctx);
      expect(res.status, p).toBe(429);
    }
  });

  it('429s a hammered PDF link before it can trigger a compile', async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (i: any) => {
      seen.push(String(i));
      return new Response('', { status: 200 });
    });
    const res = await worker.fetch(new Request('https://mcp.test/pdf/whatever'), limited(), ctx);
    expect(res.status).toBe(429);
    expect(seen).toEqual([]); // no compile was started
    vi.restoreAllMocks();
  });

  it('keeps /.well-known discovery unlimited', async () => {
    const res = await worker.fetch(
      new Request('https://mcp.test/.well-known/oauth-protected-resource'),
      limited(),
      ctx,
    );
    expect(res.status).not.toBe(429);
  });
});

describe('signed PDF links', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a link with a bad signature', async () => {
    const res = await worker.fetch(new Request('https://mcp.test/pdf/nope.nope'), stubEnv(), ctx);
    expect(res.status).toBe(403);
  });

  it('refuses an expired link', async () => {
    const stale = await signPayload({ v: 1, u: 2 }, SECRET);
    vi.setSystemTime(Date.now() + 10 * MINUTE);
    const res = await worker.fetch(new Request(`https://mcp.test/pdf/${stale}`), stubEnv(), ctx);
    expect(res.status).toBe(403);
    vi.useRealTimers();
  });

  it('refuses a well-signed link that names no variant or user', async () => {
    for (const payload of [{}, { v: 1 }, { u: 2 }, { v: 'x', u: 2 }]) {
      const t = await signPayload(payload, SECRET);
      const res = await worker.fetch(new Request(`https://mcp.test/pdf/${t}`), stubEnv(), ctx);
      expect(res.status, JSON.stringify(payload)).toBe(403);
    }
  });

  it('fetches the named variant as the user the link was minted for', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (i: any, init: any) => {
      calls.push({ url: String(i), headers: new Headers(init?.headers) });
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
    });
    const t = await signPayload({ v: 12, u: 34 }, SECRET);
    const res = await worker.fetch(new Request(`https://mcp.test/pdf/${t}`), stubEnv(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(calls[0].url).toBe('http://cv.test/api/variants/12/pdf');
    expect(calls[0].headers.get('x-user-id')).toBe('34');
    // The cv helper reads the ambient Worker env, so this is the test binding.
    expect(calls[0].headers.get('x-origin-secret')).toBe('test-origin-secret');
  });
});

describe('Google OAuth proxy', () => {
  afterEach(() => vi.restoreAllMocks());

  const authReq = { clientId: 'c', redirectUri: 'https://claude.ai/cb', scope: [] };
  const provider = (over: Record<string, unknown> = {}) => ({
    parseAuthRequest: async () => authReq,
    lookupClient: async () => ({ clientName: 'Claude' }),
    completeAuthorization: async () => ({ redirectTo: 'https://claude.ai/done' }),
    ...over,
  });

  it('fails closed when no signing secret is configured', async () => {
    const env = stubEnv({ COOKIE_SECRET: undefined, GOOGLE_CLIENT_SECRET: undefined });
    const res = await GoogleAuthHandler.fetch(new Request('https://mcp.test/authorize'), env, ctx);
    expect(res.status).toBe(500);
  });

  it('refuses a redirect_uri outside the allowlist', async () => {
    for (const uri of ['https://evil.test/cb', 'https://claude.ai.evil.test/cb', 'not-a-url']) {
      const env = stubEnv({
        OAUTH_PROVIDER: provider({
          parseAuthRequest: async () => ({ ...authReq, redirectUri: uri }),
        }),
      });
      const res = await GoogleAuthHandler.fetch(
        new Request('https://mcp.test/authorize'),
        env,
        ctx,
      );
      expect(res.status, uri).toBe(400);
    }
  });

  it('accepts the Claude and localhost callbacks', async () => {
    for (const uri of ['https://claude.ai/cb', 'https://claude.com/cb', 'http://localhost:1/cb']) {
      const env = stubEnv({
        OAUTH_PROVIDER: provider({
          parseAuthRequest: async () => ({ ...authReq, redirectUri: uri }),
        }),
      });
      const res = await GoogleAuthHandler.fetch(
        new Request('https://mcp.test/authorize'),
        env,
        ctx,
      );
      expect(res.status, uri).toBe(200);
    }
  });

  it('400s a malformed authorization request instead of throwing', async () => {
    const env = stubEnv({
      OAUTH_PROVIDER: provider({
        parseAuthRequest: async () => {
          throw new Error('malformed');
        },
      }),
    });
    const res = await GoogleAuthHandler.fetch(new Request('https://mcp.test/authorize'), env, ctx);
    expect(res.status).toBe(400);
  });

  it('refuses a consent POST whose token has expired', async () => {
    const env = stubEnv({ OAUTH_PROVIDER: provider() });
    const stale = await signPayload(authReq, SECRET);
    vi.setSystemTime(Date.now() + 10 * MINUTE);
    const form = new FormData();
    form.set('t', stale);
    const res = await GoogleAuthHandler.fetch(
      new Request('https://mcp.test/authorize', { method: 'POST', body: form }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
    vi.useRealTimers();
  });

  // The callback exchanges a code with Google, then checks who came back.
  const googleReplies = (profile: Record<string, unknown>) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (i: any) => {
      const url = String(i);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('openidconnect.googleapis.com')) {
        return new Response(JSON.stringify(profile), {
          headers: { 'content-type': 'application/json' },
        });
      }
      // POST /api/auth/upsert-user on the cv origin
      return new Response(JSON.stringify({ userId: 5 }), {
        headers: { 'content-type': 'application/json' },
      });
    });

  const callback = async (env: any) => {
    const state = await signPayload(authReq, SECRET);
    return GoogleAuthHandler.fetch(
      new Request(`https://mcp.test/callback?code=abc&state=${state}`),
      env,
      ctx,
    );
  };

  it('refuses an address outside ADMIN_EMAILS', async () => {
    googleReplies({ sub: 's', email: 'nobody@test.dev', email_verified: true });
    const res = await callback(stubEnv({ OAUTH_PROVIDER: provider() }));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('not authorized');
  });

  it('refuses an allowlisted address whose email is unverified', async () => {
    googleReplies({ sub: 's', email: 'admin@test.dev', email_verified: false });
    const res = await callback(stubEnv({ OAUTH_PROVIDER: provider() }));
    expect(res.status).toBe(403);
  });

  it('refuses a stale or missing state token', async () => {
    const env = stubEnv({ OAUTH_PROVIDER: provider() });
    const noState = await GoogleAuthHandler.fetch(
      new Request('https://mcp.test/callback?code=abc'),
      env,
      ctx,
    );
    expect(noState.status).toBe(400);
    const noCode = await GoogleAuthHandler.fetch(
      new Request(`https://mcp.test/callback?state=${await signPayload(authReq, SECRET)}`),
      env,
      ctx,
    );
    expect(noCode.status).toBe(400);
  });

  it('completes the grant for an allowlisted, verified address', async () => {
    googleReplies({ sub: 's', email: 'ADMIN@test.dev', email_verified: true, name: 'A' });
    let props: any;
    const env = stubEnv({
      OAUTH_PROVIDER: provider({
        completeAuthorization: async (a: any) => {
          props = a.props;
          return { redirectTo: 'https://claude.ai/done' };
        },
      }),
    });
    const res = await callback(env);
    expect(res.status).toBe(302);
    expect(props).toEqual({ email: 'admin@test.dev', name: 'A', cvUserId: 5 });
  });
});
