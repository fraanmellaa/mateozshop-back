import { describe, expect, it } from "vitest";

import { memoryDb, migration } from "./helpers";

describe("0047 · índices de las entradas de sorteos", () => {
  it("se aplica dos veces y crea los dos índices", async () => {
    const db = memoryDb();
    await db.exec(
      "CREATE TABLE giveaways_entries (id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, giveaway_id integer NOT NULL, user_id integer NOT NULL, created_at integer NOT NULL DEFAULT 0)"
    );
    await db.exec(migration("0047_giveaway_entries_indexes.sql"));
    await db.exec(migration("0047_giveaway_entries_indexes.sql"));
    const names = (
      await db.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'giveaways_entries' ORDER BY 1")
    ).rows.map((row) => row.indexname);
    expect(names).toContain("giveaways_entries_giveaway_idx");
    expect(names).toContain("giveaways_entries_user_idx");
  });
});
