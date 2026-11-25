import { beforeAll, describe, expect, it } from "vitest";

import { PRODUCTS_TABLE, memoryDb, migration } from "./helpers";

const db = memoryDb();
const stock = async () =>
  Object.fromEntries(
    (
      await db.query<{ name: string; stock: number; st: string; rnd: number }>(
        "SELECT name, stock, auction_status st, auction_round rnd FROM products ORDER BY id"
      )
    ).rows.map((row) => [row.name, row])
  );

describe("0043/0044 · stock compartido de las tiradas", () => {
  beforeAll(async () => {
    await db.exec(PRODUCTS_TABLE);
    await db.exec(
      "INSERT INTO products (name,image,price,created_at,description,stock,auction_status) VALUES ('Steam 25 €','x',1000,0,'d',5,'waiting')"
    );
    // Dos veces cada una: tienen que poder repetirse sin duplicar nada.
    for (const file of ["0043_shared_stock.sql", "0044_casino_free_spins.sql", "0043_shared_stock.sql", "0044_casino_free_spins.sql"]) {
      await db.exec(migration(file));
    }
  });

  it("crea los tres premios con 100 de stock y no toca los demás", async () => {
    const s = await stock();
    expect(Object.keys(s)).toHaveLength(4);
    for (const name of ["Sweet Bonanza", "Starlight Princess", "Gates of Olympus"]) expect(s[name].stock).toBe(100);
    expect(s["Steam 25 €"].stock).toBe(5);
  });

  it("adjudicar o devolver una unidad en uno se copia a los tres", async () => {
    await db.exec("UPDATE products SET stock = stock - 1 WHERE name = 'Sweet Bonanza'");
    let s = await stock();
    expect([s["Sweet Bonanza"].stock, s["Starlight Princess"].stock, s["Gates of Olympus"].stock]).toEqual([99, 99, 99]);
    expect(s["Steam 25 €"].stock).toBe(5);
    await db.exec("UPDATE products SET stock = stock + 1 WHERE name = 'Gates of Olympus'");
    s = await stock();
    expect([s["Sweet Bonanza"].stock, s["Starlight Princess"].stock, s["Gates of Olympus"].stock]).toEqual([100, 100, 100]);
  });

  it("el relleno solo actúa una vez por mes y respeta una puja en marcha", async () => {
    await db.exec("UPDATE products SET stock = 1 WHERE name = 'Sweet Bonanza'");
    await db.exec("UPDATE products SET auction_status = 'in_progress', current_bid = 3000 WHERE name = 'Gates of Olympus'");
    await db.exec("UPDATE products SET stock = 0, auction_status = 'archived' WHERE name = 'Starlight Princess'");
    expect((await stock())["Sweet Bonanza"].stock).toBe(0);

    const refill = async (month: string) =>
      (await db.query<{ r: { refilled: number } }>("SELECT shop_stock_groups_refill($1) r", [month])).rows[0].r.refilled;
    const current = (await db.query<{ m: string }>("SELECT month m FROM stock_groups")).rows[0].m;
    expect(await refill(current)).toBe(0);
    expect(await refill("2099-01")).toBe(1);
    expect(await refill("2099-01")).toBe(0);

    const s = await stock();
    expect(s["Sweet Bonanza"]).toMatchObject({ stock: 100, st: "waiting" });
    // El archivado vuelve a esperar pujas en una ronda nueva.
    expect(s["Starlight Princess"]).toMatchObject({ stock: 100, st: "waiting", rnd: 2 });
    // Con una puja en marcha solo cambia el stock.
    expect(s["Gates of Olympus"]).toMatchObject({ stock: 100, st: "in_progress" });
    await expect(db.query("SELECT shop_stock_groups_refill('diciembre')")).rejects.toThrow(/INVALID_MONTH/);
  });
});
