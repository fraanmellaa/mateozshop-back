import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

import { ADMIN_COOKIE } from "@/app/utils/auth";
import { RATE_RULES, directIp, rateLimit } from "@/app/utils/rateLimit";
import { requireEnv, safeEqual } from "@/lib/env";

export async function POST(request: NextRequest) {
  try {
    // Tope de intentos por IP: sin esto se podía probar contraseñas sin fin.
    const rule = RATE_RULES.adminLogin;
    if (!(await rateLimit(`admin-login:${directIp(request.headers)}`, rule))) {
      return NextResponse.json(
        { error: "Demasiados intentos. Espera unos minutos y vuelve a probar." },
        { status: 429, headers: { "Retry-After": String(rule.windowSeconds) } }
      );
    }

    const body = await request.json().catch(() => null);
    const username = typeof body?.username === "string" ? body.username : "";
    const password = typeof body?.password === "string" ? body.password : "";

    const adminUsername = requireEnv("USER_NAME_ADMIN");
    const adminPassword = requireEnv("USER_PASSWORD_ADMIN");

    // Se evalúan las dos comparaciones siempre (sin cortocircuito).
    const userOk = safeEqual(username, adminUsername);
    const passwordOk = safeEqual(password, adminPassword);

    if (!userOk || !passwordOk) {
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401 }
      );
    }

    const secret = new TextEncoder().encode(requireEnv("JWT_SECRET"));
    const token = await new SignJWT({
      username: adminUsername,
      role: "admin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const response = NextResponse.json(
      { success: true, message: "Autenticación exitosa" },
      { status: 200 }
    );

    response.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 2 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Error en login:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
