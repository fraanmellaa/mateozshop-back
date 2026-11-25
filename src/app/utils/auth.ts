import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

import { requireEnv } from "@/lib/env";

export const ADMIN_COOKIE = "admin-session";

export interface AdminUser {
  username: string;
  role: "admin";
}

/**
 * Verifica un token de sesión de admin. Exige el claim `role: "admin"`: otros
 * JWT firmados por el back (estados de OAuth, etc.) no valen como sesión.
 */
export async function verifyAdminToken(token: string | undefined): Promise<AdminUser | null> {
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(requireEnv("JWT_SECRET"));
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });

    if (payload.role !== "admin" || typeof payload.username !== "string") {
      return null;
    }

    return { username: payload.username, role: "admin" };
  } catch {
    return null;
  }
}

/** Admin de la petición actual (cookie), o null. */
export async function getAdminUser(): Promise<AdminUser | null> {
  const cookieStore = await cookies();
  return verifyAdminToken(cookieStore.get(ADMIN_COOKIE)?.value);
}

/**
 * Para route handlers de /api/admin y server actions del panel: el middleware
 * ya filtra, pero cada punto de entrada vuelve a comprobar la sesión.
 */
export const requireAdmin = getAdminUser;

/**
 * Para las páginas del panel: sin sesión de admin, a /login. El proxy ya lo
 * filtra, pero cada página lo comprueba otra vez antes de leer nada, para que
 * un fallo del proxy no deje ver datos.
 */
export async function requireAdminPage(): Promise<AdminUser> {
  const admin = await getAdminUser();
  if (!admin) redirect("/login");
  return admin;
}

export function adminUnauthorized() {
  return NextResponse.json(
    { success: false, error: "UNAUTHORIZED" },
    { status: 401 }
  );
}
