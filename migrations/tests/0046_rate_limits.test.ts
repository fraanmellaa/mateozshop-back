import { describe, expect, it } from "vitest";

import { memoryDb, migration } from "./helpers";

describe("0046 · rate_limit_hit", () => {
  it("se puede aplicar dos veces y corta al pasar del tope", async () => {
    const db = memoryDb();
    await db.exec(migration("0046_rate_limits.sql"));
    await db.exec(migration("0046_rate_limits.sql"));
    const hit = async (key: string, window: number, max: number) =>
      (await db.query<{ r: boolean }>("SELECT rate_limit_hit($1, $2, $3) r", [key, window, max])).rows[0].r;

    const results = [];
    for (let i = 0; i < 5; i++) results.push(await hit("login:1.2.3.4", 3600, 3));
    expect(results).toEqual([true, true, true, false, false]);
    // Otra clave no se ve afectada.
    expect(await hit("login:5.6.7.8", 3600, 3)).toBe(true);
    // Parámetros sin sentido: no limita.
    expect(await hit("", 60, 3)).toBe(true);
    expect(await hit("x", 0, 3)).toBe(true);
  });
});
