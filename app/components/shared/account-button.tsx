"use client";

import { User as UserIcon } from "lucide-react";

interface AccountButtonProps {
  onClick: () => void;
}

export function AccountButton({ onClick }: AccountButtonProps) {
  return (
    <button
      onClick={onClick}
      className="glass-strong w-11 h-11 rounded-full border border-white/60 shadow-lg shadow-black/5 flex items-center justify-center hover:border-white/80 transition-all duration-200 active:scale-95"
    >
      <UserIcon className="w-[18px] h-[18px] text-slate-600" />
    </button>
  );
}
