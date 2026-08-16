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
