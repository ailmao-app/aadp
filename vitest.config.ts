import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Builds `dist/` and packs the tarball once, before any test file's
    // worker starts — see tests/package/global-setup.ts for why.
    globalSetup: ["tests/package/global-setup.ts"],
  },
});
