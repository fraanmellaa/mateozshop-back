import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export interface AdminUser {
  username: string;
  role: string;
  iat: number;
  exp: number;
}

export async function getAdminUser(): Promise<AdminUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin-session")?.value;

    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as AdminUser;
    return decoded;
  } catch (error) {
    console.error("Error verifying admin token:", error);
    return null;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const user = await getAdminUser();
  return user !== null;
}
