import { NextResponse, type NextRequest } from "next/server";

// Auth middleware — currently passthrough (auth will be handled by .NET API)
// The Supabase auth has been replaced by the .NET Aspire backend.
// Phone OTP will be implemented via the API's /api/auth/* endpoints.

export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|apple-touch-icon\\.png|manifest\\.json|api/).*)",
  ],
};
