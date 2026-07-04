/**
 * Generic HMAC-SHA256 signing for stateless, tamper-proof, TTL-bounded tokens.
 * Shared by the OAuth state flow (oauth-google.ts) and the signed PDF download links
 * (tools.ts mints them, index.ts verifies them). Cookie-free / KV-free — the payload
 * travels inside the token; only this Worker (with the secret) can mint or verify one.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

/** HMAC key: COOKIE_SECRET if set (better key separation), else the Google client secret. */
export function signingSecret(env: { COOKIE_SECRET?: string; GOOGLE_CLIENT_SECRET?: string }): string {
  return env.COOKIE_SECRET || env.GOOGLE_CLIENT_SECRET || "";
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Mint a signed token embedding `data` + an issued-at timestamp. */
export async function signPayload(data: unknown, secret: string): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify({ d: data, iat: Date.now() })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Verify a token's signature + freshness (age <= maxAgeMs); return the embedded data, or null. */
export async function verifyPayload(token: string, secret: string, maxAgeMs: number): Promise<any | null> {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload: any;
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (typeof payload?.iat !== "number" || Date.now() - payload.iat > maxAgeMs) return null;
  return payload.d;
}
