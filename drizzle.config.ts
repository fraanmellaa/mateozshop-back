import { defineConfig } from "drizzle-kit";

function resolveDatabaseUrl() {
  const supabaseDbUrl = process.env.SUPABASE_DB_URL;
  const supabaseUrl = process.env.SUPABASE_URL;

  if (supabaseDbUrl) {
    return supabaseDbUrl;
  }

  if (supabaseUrl) {
    if (
      supabaseUrl.startsWith("postgres://") ||
      supabaseUrl.startsWith("postgresql://")
    ) {
      return supabaseUrl;
    }
  }

  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  throw new Error(
    "Missing DB configuration. Set SUPABASE_DB_URL (postgresql://...), or SUPABASE_URL as postgresql://..., or DATABASE_URL"
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
});
