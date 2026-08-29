// Ambient type for the CJS `@cv/constants` (file:../shared) default import.
// esbuild/wrangler resolves the actual module at bundle time; this only satisfies tsc.
declare module '@cv/constants' {
  const constants: {
    VARIANT_KINDS: string[];
    SLUG_PATTERN: string;
    SCORER_METHODS: string[];
  };
  export default constants;
}
