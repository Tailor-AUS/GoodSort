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
      className="w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center text-green-700 font-bold text-sm hover:scale-105 transition-transform"
    >
      {initial}
    </button>
  );
}
