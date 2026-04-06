"use client";

import { User as UserIcon } from "lucide-react";
import type { User } from "@/lib/store";

interface AccountButtonProps {
  user: User;
  onClick: () => void;
}

export function AccountButton({ user, onClick }: AccountButtonProps) {
  return (
    <button
      onClick={onClick}
      className="glass-strong w-10 h-10 rounded-full border border-white/10 flex items-center justify-center hover:border-white/20 transition-all duration-200 active:scale-95"
    >
      <UserIcon className="w-4 h-4 text-white/70" />
    </button>
  );
}
