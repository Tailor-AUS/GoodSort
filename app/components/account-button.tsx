"use client";

import type { User } from "@/lib/store";

interface AccountButtonProps {
  user: User;
  onClick: () => void;
}

export function AccountButton({ user, onClick }: AccountButtonProps) {
  const initial = user.name.charAt(0).toUpperCase();

  return (
    <button
      onClick={onClick}
      className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center text-white font-bold text-sm hover:bg-black/70 transition-all active:scale-95"
    >
      {initial}
    </button>
  );
}
