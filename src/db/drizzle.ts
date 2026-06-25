import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

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

const pool = new Pool({
	connectionString: resolveDatabaseUrl(),
});

pool.on("connect", (client) => {
	void client.query("SET search_path TO mateoz, public");
});

export const db = drizzle(pool);
