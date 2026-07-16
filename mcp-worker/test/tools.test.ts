/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from "vitest";
import { tools, toolDefs, callTool, validate, TOOL_COUNT } from "../src/tools";

// Parity coverage moved from cv/mcp-server/tests/validators.test.mjs (Node) to the
// Worker runtime — proves the 57-tool catalog + the Workers-safe validator behave
// like the stdio server before that server is deleted.
describe("cv tool catalog (moved into the Worker)", () => {
  it("exposes exactly 60 tools, each cv_*-prefixed with a description + schema", () => {
    expect(TOOL_COUNT).toBe(60);
    expect(tools.length).toBe(60);
    for (const t of tools) {
      expect(t.name).toMatch(/^cv_/);
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema).toBeTruthy();
    }
  });

  it("has unique tool names", () => {
    const names = toolDefs.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes the canonical surface (legacy modal tools are gone)", () => {
    const names = new Set(tools.map((t) => t.name));
    for (const n of [
      "cv_health", "cv_get_main", "cv_create_person", "cv_tag", "cv_create_variant",
      "cv_set_variant_rules", "cv_resolve_variant", "cv_get_pdf", "cv_suggest_tags", "cv_expand_variant_rules",
      "cv_export_linkedin", "cv_linkedin_status", "cv_linkedin_mark_synced",
    ]) {
      expect(names.has(n)).toBe(true);
    }
    expect(names.has("cv_switch_to_person")).toBe(false);
    expect(names.has("cv_import_data")).toBe(false);
  });

  it("rejects malformed args (via @cfworker/json-schema, zero-eval / Workers-safe)", () => {
    expect(validate("cv_health", { x: 1 }).valid).toBe(false); // additionalProperties:false
    expect(validate("cv_get_main", { person_id: "x" }).valid).toBe(false); // non-integer id
    expect(validate("cv_get_main", {}).valid).toBe(false); // missing required
    expect(validate("cv_create_variant", { person_id: 1, name: "X", kind: "bad" }).valid).toBe(false); // bad enum
    expect(validate("cv_tag", { target: "section", id: 1, tags: ["x"] }).valid).toBe(false); // bad enum
    expect(validate("cv_create_person", { name: "" }).valid).toBe(false); // minLength
    expect(validate("cv_export_linkedin", {}).valid).toBe(false); // person_id required
    expect(validate("cv_export_linkedin", { person_id: 5, format: "bad" }).valid).toBe(false); // bad enum
  });

  it("accepts well-formed args", () => {
    expect(validate("cv_health", {}).valid).toBe(true);
    expect(validate("cv_get_main", { person_id: 3 }).valid).toBe(true);
    expect(validate("cv_create_variant", { person_id: 1, name: "FE Resume", kind: "resume" }).valid).toBe(true);
    expect(validate("cv_tag", { target: "entry", id: 2, tags: ["frontend"] }).valid).toBe(true);
    expect(validate("cv_set_variant_rules", { variant_id: 9, include: ["a"], exclude: ["b"] }).valid).toBe(true);
    expect(validate("cv_export_linkedin", { person_id: 5, variant_id: 10, format: "markdown" }).valid).toBe(true);
    expect(validate("cv_linkedin_mark_synced", { person_id: 5, entry_ids: [244, 245] }).valid).toBe(true);
  });

  it("callTool rejects unknown tools + invalid args before any network call", async () => {
    await expect(callTool("nope", {})).rejects.toThrow(/Unknown tool/);
    await expect(callTool("cv_get_main", { person_id: "x" })).rejects.toThrow(/Invalid arguments/);
  });
});
