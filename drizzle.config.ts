import { defineConfig } from "drizzle-kit";

function withMateozSearchPath(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const currentOptions = parsed.searchParams.get("options") ?? "";
  if (!currentOptions.includes("search_path=mateoz,public")) {
    const nextOptions = currentOptions
      ? `${currentOptions} -c search_path=mateoz,public`
      : "-c search_path=mateoz,public";
    parsed.searchParams.set("options", nextOptions);
  }
  return parsed.toString();
}

function resolveDatabaseUrl() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    if (
      supabaseUrl.startsWith("postgres://") ||
      supabaseUrl.startsWith("postgresql://")
    ) {
      return withMateozSearchPath(supabaseUrl);
    }

    const parsed = new URL(supabaseUrl);
    const protocol = parsed.protocol.replace(":", "");

    if (protocol === "http" || protocol === "https") {
      const host = parsed.host;
      return withMateozSearchPath(
        `postgresql://postgres:${encodeURIComponent(serviceRoleKey)}@${host}/postgres?sslmode=require`
      );
    }
  }

  if (process.env.DATABASE_URL) {
    return withMateozSearchPath(process.env.DATABASE_URL);
  }

  throw new Error(
    "Missing DB configuration. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or DATABASE_URL"
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
