import { NextRequest, NextResponse } from "next/server";

const API_BEARER_TOKEN = process.env.API_BEARER_TOKEN || "default-bearer-token";

export function validateBearerToken(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const expectedBearer = `Bearer ${API_BEARER_TOKEN}`;

  if (authHeader !== expectedBearer) {
    return NextResponse.json(
      { error: "No autorizado - Bearer token requerido" },
      { status: 401 }
    );
  }

  return null; // Token válido, continuar
}

export function withBearerAuth(
  handler: (request: NextRequest, context?: unknown) => Promise<NextResponse>
) {
  return async (request: NextRequest, context?: unknown) => {
    const authError = validateBearerToken(request);
    if (authError) return authError;

    return handler(request, context);
  };
}
