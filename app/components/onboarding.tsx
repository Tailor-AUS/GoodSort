"use client";

import { useState } from "react";
import { createUser, getBuildings, type User } from "@/lib/store";

interface OnboardingProps {
  onComplete: (user: User) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [buildingId, setBuildingId] = useState("");

  const buildings = getBuildings();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !unit || !buildingId) return;
    const user = createUser(name, unit, buildingId);
    onComplete(user);
  }

  if (step === 0) {
    return (
      <div className="max-w-md mx-auto px-4 pt-12 text-center">
        <div className="text-6xl mb-4">&#9851;</div>
        <h1 className="text-3xl font-bold text-green-700 mb-2">The Good Sort</h1>
        <p className="text-gray-600 mb-2">You sort it. We collect it. The planet keeps it.</p>
        <p className="text-sm text-gray-400 mb-8">
          Two ways to earn. Scan containers for 5c each.
          Or find full bins on the map and deliver them for 5c per container.
        </p>

        <div className="bg-white rounded-2xl p-6 border border-gray-200 mb-4 text-left">
          <h3 className="font-semibold text-green-700 mb-3">Sort — Earn 5c per scan</h3>
          <div className="space-y-3">
            <Step num={1} text="Scan the barcode on your container" />
            <Step num={2} text="Drop it in The Good Sort bin in your building" />
            <Step num={3} text="5c is instantly credited to your wallet" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-gray-200 mb-8 text-left">
          <h3 className="font-semibold text-amber-600 mb-3">Run — Earn 5c per container delivered</h3>
          <div className="space-y-3">
            <Step num={1} text="Full bins appear on the map like loot drops" />
            <Step num={2} text="Claim a bin — first come, first served" />
            <Step num={3} text="Deliver to the recycler, get paid instantly" />
          </div>
        </div>

        <button
          onClick={() => setStep(1)}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          Get Started
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-12">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Join The Good Sort</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sarah"
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Unit Number</label>
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="e.g. 14B"
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Your Building</label>
          <select
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
            required
          >
            <option value="">Select your building...</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.address}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors mt-4"
        >
          Start Scanning
        </button>
      </form>
    </div>
  );
}

function Step({ num, text }: { num: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold flex items-center justify-center">
        {num}
      </span>
      <p className="text-sm text-gray-600">{text}</p>
    </div>
  );
}
