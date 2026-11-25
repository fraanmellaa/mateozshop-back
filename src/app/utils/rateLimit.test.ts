import { beforeEach, describe, expect, it, vi } from "vitest";

// La base de datos, simulada: `answer` decide qué responde en cada test.
type Answer = () => unknown;
const db = vi.hoisted(() => ({ calls: 0, answer: (() => ({ data: true, error: null })) as Answer }));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: async () => {
      db.calls += 1;
      return db.answer();
    },
  }),
}));

import { RATE_RULES, directIp, memoryRateLimit, rateLimit } from "./rateLimit";

const rule = { max: 3, windowSeconds: 60 };

describe("memoryRateLimit", () => {
  it("deja pasar hasta el tope y corta después, dentro de la misma ventana", () => {
    const t = 1_000_000_000_000;
    const key = `m1:${Math.random()}`;
    expect([0, 1, 2, 3, 4].map((i) => memoryRateLimit(key, rule, t + i))).toEqual([true, true, true, false, false]);
  });

  it("vuelve a dejar pasar en la ventana siguiente", () => {
    const t = 1_000_000_020_000 - (1_000_000_020_000 % 60_000);
    const key = `m2:${Math.random()}`;
    for (let i = 0; i < 5; i++) memoryRateLimit(key, rule, t);
    expect(memoryRateLimit(key, rule, t)).toBe(false);
    expect(memoryRateLimit(key, rule, t + 60_000)).toBe(true);
  });

  it("cuenta cada clave por separado", () => {
    const t = 1_000_000_000_000;
    const a = `m3a:${Math.random()}`;
    for (let i = 0; i < 4; i++) memoryRateLimit(a, rule, t);
    expect(memoryRateLimit(`m3b:${Math.random()}`, rule, t)).toBe(true);
  });
});

describe("rateLimit (con la base de datos)", () => {
  beforeEach(() => {
    db.calls = 0;
    db.answer = () => ({ data: true, error: null });
  });

  it("corta cuando la base de datos dice que se ha pasado del tope", async () => {
    db.answer = () => ({ data: false, error: null });
    expect(await rateLimit(`d1:${Math.random()}`, RATE_RULES.bid)).toBe(false);
  });

  it("deja pasar cuando la base de datos dice que cabe", async () => {
    db.answer = () => ({ data: true, error: null });
    expect(await rateLimit(`d2:${Math.random()}`, RATE_RULES.bid)).toBe(true);
  });

  it("si la base de datos devuelve un error, nunca bloquea al usuario", async () => {
    db.answer = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await rateLimit(`d3:${Math.random()}`, RATE_RULES.bid)).toBe(true);
  });

  it("si la llamada revienta (sin red), tampoco bloquea", async () => {
    db.answer = () => {
      throw new Error("sin red");
    };
    const allowed = await rateLimit(`d4:${Math.random()}`, RATE_RULES.bid);
    expect(allowed).toBe(true);
  });

  it("sin la migración aplicada deja pasar y no vuelve a preguntar enseguida", async () => {
    db.answer = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.rate_limit_hit" } });
    expect(await rateLimit(`d5:${Math.random()}`, RATE_RULES.bid)).toBe(true);
    db.calls = 0;
    expect(await rateLimit(`d6:${Math.random()}`, RATE_RULES.bid)).toBe(true);
    expect(db.calls).toBe(0);
  });
});

describe("directIp", () => {
  it("prefiere la cabecera que pone Vercel y se queda con la primera IP", () => {
    const headers = new Headers({ "x-vercel-forwarded-for": "1.2.3.4, 5.6.7.8", "x-forwarded-for": "9.9.9.9" });
    expect(directIp(headers)).toBe("1.2.3.4");
  });

  it("sin cabeceras devuelve un valor fijo", () => {
    expect(directIp(new Headers())).toBe("unknown");
  });
});
