import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json(
    { success: true, message: "Sesión cerrada exitosamente" },
    { status: 200 }
  );

  // Eliminar la cookie de sesión
  response.cookies.set("admin-session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0, // Expira inmediatamente
    path: "/",
  });

  return response;
}
