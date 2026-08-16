// Minimal ambient type for the one Node builtin this Worker uses. The runtime provides
// `node:async_hooks` under the `nodejs_compat` flag (wrangler.jsonc); declaring just the
// slice we need lets us type it WITHOUT adding @types/node — which would collide with
// @cloudflare/workers-types (duplicate fetch/Request/etc.).
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}
