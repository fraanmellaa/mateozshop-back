import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ADMIN_COOKIE, verifyAdminToken } from "@/app/utils/auth";
import { safeEqual } from "@/lib/env";

// Rutas de API que no pasan por el bearer global: son públicas o cada handler
// verifica su propia credencial (JWT de extensión, CRON_SECRET, secreto de tarea).
const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/kick/live"];
// Los webhooks (Kick, Twitch, Telegram) los firma la plataforma de origen: cada
// handler verifica esa firma o secreto.
const SELF_AUTH_API_PREFIXES = [
  "/api/cron/",
  "/api/extension/",
  "/api/tasks/",
  "/api/webhooks/",
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** true si la petición no trae `Origin` o es el del propio panel. */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? request.nextUrl.host);
  } catch {
    return false;
  }
}

function unauthorized() {
  return NextResponse.json(
    { success: false, error: "UNAUTHORIZED" },
    { status: 401 }
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (
      PUBLIC_API_PATHS.includes(pathname) ||
      SELF_AUTH_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    ) {
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/admin/")) {
      // CSRF: lo que cambia algo en el panel tiene que salir del propio panel.
      // El navegador manda `Origin` en todo POST/PUT/DELETE; si viene de otra
      // web (aunque sea del mismo dominio), se rechaza. Sin `Origin` (scripts,
      // herramientas) sigue haciendo falta la sesión de admin.
      if (!SAFE_METHODS.has(request.method) && !sameOrigin(request)) {
        return NextResponse.json({ success: false, error: "FORBIDDEN_ORIGIN" }, { status: 403 });
      }
      const admin = await verifyAdminToken(request.cookies.get(ADMIN_COOKIE)?.value);
      return admin ? NextResponse.next() : unauthorized();
    }

    // Resto de la API (la consume el front): bearer compartido. Sin la
    // variable configurada no entra nadie.
    const bearer = process.env.API_BEARER_TOKEN;
    if (!bearer) {
      console.error("API_BEARER_TOKEN is not configured: API request refused");
      return NextResponse.json(
        { success: false, error: "SERVER_MISCONFIGURED" },
        { status: 500 }
      );
    }

    return safeEqual(request.headers.get("authorization"), `Bearer ${bearer}`)
      ? NextResponse.next()
      : unauthorized();
  }

  if (pathname === "/login") {
    return NextResponse.next();
  }

  // Cualquier otra página es del panel.
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  if (await verifyAdminToken(token)) {
    return NextResponse.next();
  }

  const response = NextResponse.redirect(new URL("/login", request.url));
  if (token) response.cookies.delete(ADMIN_COOKIE);
  return response;
}

export const config = {
  // Todo salvo los estáticos de Next. Una página nueva queda protegida sin
  // tener que añadirla aquí. /_next/image NO se excluye a propósito: el
  // optimizador de imágenes solo responde con sesión de admin.
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};
