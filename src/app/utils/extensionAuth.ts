import { NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";

const EXTENSION_JWT_SECRET =
  process.env.EXTENSION_JWT_SECRET || process.env.JWT_SECRET || "your-secret-key";

export type ExtensionTokenPayload = {
  sub: string;
  discordId: string;
  role: "extension-user";
};

export async function signExtensionToken(discordId: string) {
  const secret = new TextEncoder().encode(EXTENSION_JWT_SECRET);

  return new SignJWT({
    discordId,
    role: "extension-user",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(discordId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export function validateExtensionKey(request: NextRequest): NextResponse | null {
  const configured = process.env.EXTENSION_API_KEY || process.env.API_BEARER_TOKEN;

  if (!configured) {
    return NextResponse.json(
      { error: "EXTENSION_API_KEY_NOT_CONFIGURED" },
      { status: 500 }
    );
  }

  const key = request.headers.get("x-extension-key");
  if (key !== configured) {
    return NextResponse.json({ error: "UNAUTHORIZED_EXTENSION" }, { status: 401 });
  }

  return null;
}

export async function verifyExtensionUser(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "EXTENSION_TOKEN_REQUIRED" }, { status: 401 }),
    };
  }

  try {
    const secret = new TextEncoder().encode(EXTENSION_JWT_SECRET);
    const { payload } = await jwtVerify(match[1], secret);

    const discordId = typeof payload.discordId === "string" ? payload.discordId : null;
    const role = payload.role;

    if (!discordId || role !== "extension-user") {
      return {
        ok: false as const,
        response: NextResponse.json({ error: "INVALID_EXTENSION_TOKEN" }, { status: 401 }),
      };
    }

    return {
      ok: true as const,
      discordId,
    };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "INVALID_EXTENSION_TOKEN" }, { status: 401 }),
    };
  }
}
