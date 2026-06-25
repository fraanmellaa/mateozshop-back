import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

function withMateozSearchPath(databaseUrl) {
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

// Usar la misma configuración que tu aplicación
const db = drizzle(resolveDatabaseUrl());

async function main() {
  console.log("🔧 Iniciando migración manual de la base de datos...");

  try {
    // 1. Verificar si las columnas ya existen
    console.log("📋 Verificando estructura actual de la tabla giveaways...");

    const tableInfo = await db.execute(sql`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'giveaways' 
      ORDER BY ordinal_position;
    `);

    console.log("Columnas actuales:", tableInfo.rows);

    // 2. Agregar columnas si no existen
    const existingColumns = tableInfo.rows.map((col) => col.column_name);

    if (!existingColumns.includes("sendable")) {
      console.log("➕ Agregando columna 'sendable'...");
      await db.execute(sql`
        ALTER TABLE giveaways 
        ADD COLUMN sendable BOOLEAN NOT NULL DEFAULT false;
      `);
      console.log("✅ Columna 'sendable' agregada");
    } else {
      console.log("⚠️ La columna 'sendable' ya existe");
    }

    if (!existingColumns.includes("codes")) {
      console.log("➕ Agregando columna 'codes'...");
      await db.execute(sql`
        ALTER TABLE giveaways 
        ADD COLUMN codes JSONB NOT NULL DEFAULT '[]'::jsonb;
      `);
      console.log("✅ Columna 'codes' agregada");
    } else {
      console.log("⚠️ La columna 'codes' ya existe");
    }

    if (!existingColumns.includes("used_codes")) {
      console.log("➕ Agregando columna 'used_codes'...");
      await db.execute(sql`
        ALTER TABLE giveaways 
        ADD COLUMN used_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
      `);
      console.log("✅ Columna 'used_codes' agregada");
    } else {
      console.log("⚠️ La columna 'used_codes' ya existe");
    }

    // 3. Verificar estructura final
    console.log("📋 Verificando estructura final...");
    const finalTableInfo = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'giveaways' 
      ORDER BY ordinal_position;
    `);

    console.log("Estructura final de la tabla giveaways:");
    finalTableInfo.rows.forEach((col) => {
      console.log(
        `  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable}) default: ${col.column_default}`
      );
    });

    // 4. Probar una consulta con los nuevos campos
    console.log("🧪 Probando consulta con nuevos campos...");
    const testQuery = await db.execute(sql`
      SELECT id, title, sendable, codes, used_codes 
      FROM giveaways 
      LIMIT 1;
    `);

    console.log("Consulta de prueba exitosa:", testQuery.rows);

    console.log("🎉 ¡Migración completada exitosamente!");
  } catch (error) {
    console.error("❌ Error durante la migración:", error);
    process.exit(1);
  }
}

main();
