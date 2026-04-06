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
      className="glass-strong w-10 h-10 rounded-full border border-slate-200 shadow-sm flex items-center justify-center hover:border-slate-300 transition-all duration-200 active:scale-95"
    >
      <UserIcon className="w-4 h-4 text-slate-600" />
    </button>
  );
}
