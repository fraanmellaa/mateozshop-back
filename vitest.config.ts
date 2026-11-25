import path from "node:path";

import { defineConfig } from "vitest/config";

// Tests del back: funciones puras de src/ y migraciones SQL, que se ejecutan
// en un Postgres en memoria (pglite). Nunca tocan la base de datos real.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "migrations/tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
