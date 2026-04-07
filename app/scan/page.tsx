"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Camera, ArrowLeft, MapPin } from "lucide-react";
import { apiUrl } from "@/lib/config";
import { Scanner } from "@/app/components/shared/scanner";
import { type BagInfo } from "@/lib/store";

interface BinInfo {
  id: string;
  code: string;
  name: string;
  address: string;
  hostedBy: string | null;
  pendingContainers: number;
  status: string;
}

function ScanPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const binCode = searchParams.get("bin");
  const [bin, setBin] = useState<BinInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [done, setDone] = useState(false);
  const [credited, setCredited] = useState({ items: 0, cents: 0 });

  useEffect(() => {
    if (!binCode) {
      setLoading(false);
      return;
    }

    fetch(apiUrl(`/api/bins/code/${binCode}`))
      .then((r) => {
        if (!r.ok) throw new Error("Bin not found");
        return r.json();
      })
      .then((data) => { setBin(data); setLoading(false); })
      .catch(() => { setError("Bin not found"); setLoading(false); });
  }, [binCode]);

  function handleScanComplete(containerName: string, cents: number, bag: BagInfo) {
    setShowScanner(false);
    setCredited((p) => ({ items: p.items + 1, cents: p.cents + cents }));
  }

  function handleBatchComplete(totalItems: number, totalCents: number) {
    setShowScanner(false);
    setCredited({ items: totalItems, cents: totalCents });
    setDone(true);
  }

  if (loading) {
    return (
      <div className="h-dvh bg-white flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading bin...</div>
      </div>
    );
  }

  // No bin code — show message to scan a QR code
  if (!binCode) {
    return (
      <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Camera className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-2">Scan a Bin QR Code</h1>
          <p className="text-slate-400 text-[13px] mb-6">Find a Good Sort bin near you and scan the QR code on it to start recycling</p>
          <button onClick={() => router.push("/")}
            className="text-green-600 font-medium text-[13px]">
            Open the map to find bins nearby
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-xl font-display font-extrabold text-slate-900 mb-2">Bin Not Found</h1>
          <p className="text-slate-400 text-[13px] mb-4">Code "{binCode}" doesn't match any active bin</p>
          <button onClick={() => router.push("/")} className="text-green-600 font-medium text-[13px]">Go to map</button>
        </div>
      </div>
    );
  }

  // Done — show summary
  if (done) {
    return (
      <div className="h-dvh bg-white flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center animate-slide-up">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <span className="text-3xl">✅</span>
          </div>
          <p className="text-4xl font-display font-extrabold text-slate-900 mb-1 animate-ka-ching">
            +${(credited.cents / 100).toFixed(2)}
          </p>
          <p className="text-slate-500 text-[13px] mt-2">
            {credited.items} container{credited.items !== 1 ? "s" : ""} at {bin?.name}
          </p>
          <p className="text-green-600 text-[12px] mt-1">Pending until collected and verified</p>
          <div className="mt-8 space-y-2">
            <button onClick={() => { setDone(false); setCredited({ items: 0, cents: 0 }); }}
              className="w-full bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-3.5 rounded-xl text-[15px] shadow-lg shadow-green-600/20">
              Scan More
            </button>
            <button onClick={() => router.push("/")}
              className="w-full text-slate-400 font-medium py-2 text-[13px]">
              Back to Map
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Bin found — show bin info + scan button
  return (
    <div className="h-dvh bg-white flex flex-col" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100">
        <button onClick={() => router.push("/")} className="flex items-center gap-1.5 text-slate-400 text-[13px] font-medium mb-3">
          <ArrowLeft className="w-4 h-4" /> Map
        </button>
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <MapPin className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="text-[11px] text-green-600 font-bold">{bin?.code}</p>
            <h1 className="text-[17px] font-display font-extrabold text-slate-900">{bin?.name}</h1>
            <p className="text-[12px] text-slate-400">{bin?.address}</p>
            {bin?.hostedBy && <p className="text-[11px] text-slate-500 mt-0.5">Hosted by {bin.hostedBy}</p>}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {credited.items > 0 && (
          <div className="mb-6 text-center">
            <p className="text-2xl font-display font-extrabold text-green-600">+${(credited.cents / 100).toFixed(2)} pending</p>
            <p className="text-slate-400 text-[12px]">{credited.items} container{credited.items !== 1 ? "s" : ""} scanned</p>
          </div>
        )}

        <button onClick={() => setShowScanner(true)}
          className="w-full max-w-sm bg-gradient-to-b from-green-500 to-green-600 text-white font-extrabold py-5 rounded-2xl text-[17px] shadow-lg shadow-green-600/20 flex items-center justify-center gap-3 min-h-[56px]">
          <Camera className="w-6 h-6" />
          {credited.items > 0 ? "Scan More" : "Scan Containers"}
        </button>

        <p className="text-slate-400 text-[12px] mt-4 text-center">
          Place containers on a surface and take a photo
        </p>
      </div>

      {/* Scanner */}
      {showScanner && (
        <Scanner
          onClose={() => setShowScanner(false)}
          onScanComplete={handleScanComplete}
          onBatchComplete={handleBatchComplete}
        />
      )}
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="h-dvh bg-white flex items-center justify-center"><div className="text-slate-400 text-sm">Loading...</div></div>}>
      <ScanPageContent />
    </Suspense>
  );
}
