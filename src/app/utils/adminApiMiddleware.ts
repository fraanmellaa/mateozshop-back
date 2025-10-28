import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export function createAdminApiMiddleware() {
  return async function adminApiMiddleware(request: NextRequest) {
    // Verificar cookie de autenticación
    const token = request.cookies.get("admin-session")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "No autorizado - Token requerido" },
        { status: 401 }
      );
    }

    try {
      // Verificar token JWT
      jwt.verify(token, JWT_SECRET);
      return NextResponse.next();
    } catch {
      return NextResponse.json(
        { error: "No autorizado - Token inválido" },
        { status: 401 }
      );
    }
  };
}

export const adminApiMiddleware = createAdminApiMiddleware();
