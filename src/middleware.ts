import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const API_BEARER_TOKEN = process.env.API_BEARER_TOKEN || "default-bearer-token";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  console.log("🛡️ MIDDLEWARE:", pathname);

  // RUTAS API: Verificar Bearer Token
  if (pathname.startsWith("/api/")) {
    // Excepción: login no requiere bearer token
    if (pathname === "/api/auth/login" || pathname === "/api/auth/logout") {
      console.log("🔓 API Login - Sin autenticación");
      return NextResponse.next();
    }

    const authHeader = request.headers.get("authorization");
    const expectedBearer = "Bearer " + API_BEARER_TOKEN;

    console.log(
      "🔑 API Bearer esperado:",
      expectedBearer.substring(0, 20) + "..."
    );
    console.log(
      "🔑 API Bearer recibido:",
      authHeader?.substring(0, 20) + "..."
    );

    if (authHeader !== expectedBearer) {
      console.log("❌ API - Bearer token inválido");
      return NextResponse.json(
        { error: "No autorizado - Bearer token requerido" },
        { status: 401 }
      );
    }

    console.log("✅ API - Bearer token válido");
    return NextResponse.next();
  }

  // PÁGINAS WEB: Solo login es público
  if (pathname === "/login") {
    console.log("🔓 Página login - Acceso libre");
    return NextResponse.next();
  }

  // Todas las demás páginas requieren JWT
  const token = request.cookies.get("admin-session")?.value;
  console.log("🔑 JWT Token:", token ? "ENCONTRADO" : "NO ENCONTRADO");

  if (!token) {
    console.log("❌ Sin JWT - Redirigiendo a login");
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    await jwtVerify(token, secret);
    console.log("✅ JWT válido - Acceso permitido");
    return NextResponse.next();
  } catch (error) {
    console.log("❌ JWT inválido - Error:", error);
    console.log("❌ JWT inválido - Redirigiendo a login");
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("admin-session");
    return response;
  }
}

export const config = {
  matcher: [
    // Todas las páginas
    "/",
    "/users/:path*",
    "/products/:path*",
    "/orders/:path*",
    "/giveaways/:path*",
    "/login",
    // Todas las APIs
    "/api/:path*",
  ],
};
