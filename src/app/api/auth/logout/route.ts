import { NextResponse } from "next/server";

import { ADMIN_COOKIE } from "@/app/utils/auth";

export async function POST() {
  const response = NextResponse.json(
    { success: true, message: "Sesión cerrada exitosamente" },
    { status: 200 }
  );

  // Mismos atributos que al crearla, para que el navegador la borre.
  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return response;
}
