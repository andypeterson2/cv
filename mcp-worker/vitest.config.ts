import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// vitest 4 line of @cloudflare/vitest-pool-workers: the config helper is now the
// `cloudflareTest()` plugin (the old `defineWorkersConfig`/`poolOptions.workers`
// was removed). Runs the tool-catalog tests inside the real workerd runtime so
// @cfworker/json-schema (the zero-eval validator that replaced ajv) and the
// `cloudflare:workers` env import are exercised exactly as in production.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Tests never talk to real Cloudflare resources: don't honor the
      // `remote: true` on OAUTH_KV (dev-session convenience only) — CI has no
      // Cloudflare token, and tests must not touch the production namespace.
      remoteBindings: false,
      miniflare: {
        bindings: {
          CV_EDITOR_URL: "http://cv.test",
          CV_EDITOR_TOKEN: "test-token",
          CV_ORIGIN_SECRET: "test-origin-secret",
          ADMIN_EMAILS: "admin@test.dev",
        },
      },
    }),
  ],
});
