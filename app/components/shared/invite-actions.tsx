"use client";

import { useState } from "react";
import { CheckCircle, MessageCircle, Share2, Smartphone } from "lucide-react";
import { smsShareUrl, whatsappShareUrl } from "@/lib/brisbane";
import { track } from "@/lib/analytics";

type InviteActionsProps = {
  url: string;
  message: string;
  compact?: boolean;
};

async function copyInviteMessage(message: string) {
  try {
    await navigator.clipboard.writeText(message);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = message;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

export function InviteActions({ url, message, compact }: InviteActionsProps) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  async function handleShare() {
    const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (mobile && navigator.share) {
      try {
        await navigator.share({ title: "The Good Sort on our street", text: message, url });
        track("invite_share");
        setShared(true);
        setTimeout(() => setShared(false), 3000);
        return;
      } catch { /* cancelled */ }
    }
    const copiedOk = await copyInviteMessage(message);
    if (copiedOk) {
      track("invite_share");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const btn = compact
    ? "w-full font-bold py-2.5 rounded-xl text-[12px] min-h-[44px] flex items-center justify-center gap-1.5"
    : "w-full font-extrabold py-4 rounded-2xl text-[15px] min-h-[52px] flex items-center justify-center gap-2";

  return (
    <div className="space-y-2">
      <a
        href={whatsappShareUrl(message)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track("invite_whatsapp")}
        className={`${btn} bg-[#25D366] text-white`}
      >
        <MessageCircle className={compact ? "w-4 h-4" : "w-5 h-5"} />
        WhatsApp the street
      </a>
      <a
        href={smsShareUrl(message)}
        onClick={() => track("invite_sms")}
        className={`${btn} bg-white border border-slate-200 text-slate-800`}
      >
        <Smartphone className={compact ? "w-4 h-4" : "w-5 h-5"} />
        Text a neighbour
      </a>
      <button
        onClick={handleShare}
        className={`${btn} bg-gradient-to-b from-green-500 to-green-600 text-white`}
      >
        {shared ? <><CheckCircle className="w-4 h-4" /> Shared</> : copied ? <><CheckCircle className="w-4 h-4" /> Copied</> : <><Share2 className="w-4 h-4" /> {compact ? "Share / copy" : "Share or copy link"}</>}
      </button>
    </div>
  );
}
