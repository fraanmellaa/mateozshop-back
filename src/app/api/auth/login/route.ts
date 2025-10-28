import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    // Verificar credenciales con variables de entorno
    const adminUsername = process.env.USER_NAME_ADMIN;
    const adminPassword = process.env.USER_PASSWORD_ADMIN;

    if (!adminUsername || !adminPassword) {
      return NextResponse.json(
        { error: "Configuración de administrador no encontrada" },
        { status: 500 }
      );
    }

    console.log(adminPassword);
    console.log(password);

    if (username !== adminUsername || password !== adminPassword) {
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401 }
      );
    }

    // Crear token JWT con expiración de 2 horas usando jose
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({
      username: adminUsername,
      role: "admin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    // Crear respuesta con cookie segura
    const response = NextResponse.json(
      { success: true, message: "Autenticación exitosa" },
      { status: 200 }
    );

    // Configurar cookie con el token
    response.cookies.set("admin-session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 2 * 60 * 60, // 2 horas en segundos
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
