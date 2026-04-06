import { NextResponse, type NextRequest } from "next/server";

// Auth middleware — checks for JWT token from .NET API
export function middleware(request: NextRequest) {
  const publicPaths = ["/login", "/verify", "/onboard", "/privacy", "/terms"];
  const isPublicPath = publicPaths.some((p) => request.nextUrl.pathname.startsWith(p));

  if (isPublicPath) return NextResponse.next();

  // Check for auth token in cookie or localStorage isn't accessible in middleware,
  // so we check for a cookie that the client sets after login
  const token = request.cookies.get("goodsort_token")?.value;

  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|apple-touch-icon\\.png|manifest\\.json|api/).*)",
  ],
};
