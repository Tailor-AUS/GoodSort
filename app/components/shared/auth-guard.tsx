"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { hasValidToken, clearAuth } from "@/lib/config";

const PUBLIC_PATHS = ["/login", "/verify", "/onboard", "/privacy", "/terms", "/scan", "/start"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Skip auth check on public paths
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      setAuthed(true);
      setChecked(true);
      return;
    }

    // Presence isn't enough — an expired token sails past the guard and then
    // 401s every API call (e.g. "Failed to create household" on onboarding for
    // returning users whose 30-day JWT lapsed). Reject expired tokens too.
    if (!hasValidToken()) {
      clearAuth();
      router.replace("/start");
      return;
    }

    setAuthed(true);
    setChecked(true);
  }, [pathname, router]);

  if (!checked) {
    return (
      <div className="h-dvh flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!authed) return null;

  return <>{children}</>;
}
