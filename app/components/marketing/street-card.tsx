"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Logo } from "@/app/components/shared/logo";
import { readStoredProfileId } from "@/lib/config";
import { streetInviteUrl } from "@/lib/brisbane";

/**
 * Printable letterbox card. A street-level product gets its first neighbours
 * from letterboxes, not ads — so this has to work with no phone in hand and a
 * QR that actually scans.
 *
 * The QR is generated in the browser because it carries the sharer's `?r=`
 * referral id, which only exists client-side. With no id it still produces a
 * valid suburb link, just unattributed.
 */
export function StreetCard({ suburb, slug }: { suburb: string; slug: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    const target = streetInviteUrl({ suburb: slug, profileId: readStoredProfileId() });
    setUrl(target);
    QRCode.toDataURL(target, {
      // Print-grade settings. Q tolerates ~25% damage, which a letterbox card
      // will pick up from folding, rain and cheap toner. margin 4 is the quiet
      // zone the QR spec requires — anything less and real scanners struggle.
      errorCorrectionLevel: "Q",
      margin: 4,
      width: 512,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [slug]);

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          .no-print { display: none !important; }
          .card { break-inside: avoid; border: 1px dashed #cbd5e1 !important; }
        }
      `}</style>

      <div className="no-print mx-auto max-w-lg px-6 pt-8 pb-4 text-center">
        <p className="text-[13px] text-slate-500">
          Four cards per A4. Print, cut, and letterbox them in {suburb}.
        </p>
        <button
          onClick={() => window.print()}
          className="mt-3 rounded-xl bg-gradient-to-b from-green-500 to-green-600 px-5 py-3 text-white font-bold text-[15px]"
        >
          Print
        </button>
        {url && <p className="mt-3 break-all text-[11px] text-slate-400">{url}</p>}
      </div>

      <div className="mx-auto grid max-w-[210mm] grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="card flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="flex-1">
              <div className="mb-3"><Logo size="sm" /></div>
              <p className="font-display text-[19px] font-extrabold leading-tight text-slate-950">
                Scan, sort,<br />skip the depot.
              </p>
              <p className="mt-2 text-[12px] leading-snug text-slate-600">
                Scan a can, earn 5¢. We collect from your kerb — you never drive
                to a depot.
              </p>
              <p className="mt-2 text-[11px] font-semibold text-violet-800">
                Starting in {suburb}
              </p>
              <p className="mt-1 text-[9px] leading-snug text-slate-400">
                A 5¢ sorting credit, not the 10¢ scheme refund.
              </p>
            </div>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={`Scan to join in ${suburb}`} className="h-[112px] w-[112px] shrink-0" />
            ) : (
              <div className="h-[112px] w-[112px] shrink-0 rounded bg-slate-100" />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
