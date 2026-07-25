import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    watch: {
      followSymlinks: false,
    },
  },
  test: {
    exclude: ['website/lib/**'],
    // engine262 tests evaluate whole programs in an interpreter written in
    // TypeScript, so many of them take seconds rather than milliseconds:
    // vitest's 5s default was tuned for unit tests and several of these sit
    // right at it, failing under full-suite load and passing in isolation.
    // Three cycles lost time diagnosing that as a regression before it was
    // recognised as a timeout (F60, F61). Raising the default is the right fix
    // rather than skipping the slow tests: the slowest of them are the
    // conformance matrices, and a skipped matrix is a regression nobody
    // notices.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/inspector/',
      include: ['lib-src/inspector/**', 'lib/inspector.mjs'],
    },
  },
});
