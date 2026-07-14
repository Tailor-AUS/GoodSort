"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { hasValidToken, clearAuth } from "@/lib/config";

const PUBLIC_EXACT_PATHS = ["/"];
const PUBLIC_PATH_PREFIXES = ["/login", "/verify", "/onboard", "/privacy", "/terms", "/scan", "/start"];

function isPublicPath(pathname: string) {
  return (
    PUBLIC_EXACT_PATHS.includes(pathname) ||
    PUBLIC_PATH_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [validatedPath, setValidatedPath] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const publicPath = isPublicPath(pathname);

  useEffect(() => {
    if (publicPath) {
      setAuthed(true);
      setChecked(true);
      setValidatedPath(pathname);
      return;
    }

    setChecked(false);
    setAuthed(false);
    setValidatedPath(null);

    // Presence isn't enough — an expired token sails past the guard and then
    // 401s every API call (e.g. "Failed to create household" on onboarding for
    // returning users whose 30-day JWT lapsed). Reject expired tokens too.
    if (!hasValidToken()) {
      clearAuth();
      router.replace("/");
      return;
    }

    setAuthed(true);
    setChecked(true);
    setValidatedPath(pathname);
  }, [pathname, publicPath, router]);

  if (publicPath) return <>{children}</>;

  if (!checked || validatedPath !== pathname) {
    return (
      <div className="h-dvh flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!authed) return null;

  return <>{children}</>;
}
