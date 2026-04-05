"use client";

import { useEffect, useState } from "react";
import { getLeaderboard, getRunnerLeaderboard, getUser, formatCents, type RunnerRank } from "@/lib/store";

type Tab = "buildings" | "runners";

interface RankedBuilding {
  id: string;
  name: string;
  address: string;
  totalContainers: number;
  totalResidents: number;
  rank: number;
  perResident: number;
}

export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>("buildings");
  const [buildings, setBuildings] = useState<RankedBuilding[]>([]);
  const [runners, setRunners] = useState<RunnerRank[]>([]);
  const [userBuildingId, setUserBuildingId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setBuildings(getLeaderboard());
    setRunners(getRunnerLeaderboard());
    const user = getUser();
    if (user) {
      setUserBuildingId(user.buildingId);
      setUserId(user.id);
    }
  }, []);

  return (
    <div className="max-w-md mx-auto px-4 pt-6">
      <h1 className="text-xl font-bold text-gray-800 mb-4">Leaderboard</h1>

      {/* Tab Switcher */}
      <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
        <button
          onClick={() => setTab("buildings")}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === "buildings" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
          }`}
        >
          Buildings
        </button>
        <button
          onClick={() => setTab("runners")}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === "runners" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
          }`}
        >
          Runners
        </button>
      </div>

      {tab === "buildings" && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            Ranked by containers per resident — every building gets a fair go.
          </p>

          {/* Podium - Top 3 */}
          {buildings.length >= 3 && (
            <div className="flex items-end justify-center gap-2 mb-8">
              <PodiumCard building={buildings[1]} height="h-28" medal="2nd" />
              <PodiumCard building={buildings[0]} height="h-36" medal="1st" isTop />
              <PodiumCard building={buildings[2]} height="h-24" medal="3rd" />
            </div>
          )}

          {/* Full Rankings */}
          <div className="space-y-2">
            {buildings.map((building) => {
              const isUserBuilding = building.id === userBuildingId;
              return (
                <div
                  key={building.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    isUserBuilding
                      ? "bg-green-50 border-green-300"
                      : "bg-white border-gray-100"
                  }`}
                >
                  <RankBadge rank={building.rank} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {building.name}
                      </p>
                      {isUserBuilding && (
                        <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{building.address}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-800">{building.perResident}</p>
                    <p className="text-xs text-gray-400">per resident</p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "runners" && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            Top Runners by total containers delivered. Claim bins, deliver, climb the ranks.
          </p>

          {/* Runner Rankings */}
          <div className="space-y-2">
            {runners.map((runner) => {
              const isUser = runner.userId === userId;
              return (
                <div
                  key={runner.userId}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    isUser
                      ? "bg-amber-50 border-amber-300"
                      : "bg-white border-gray-100"
                  }`}
                >
                  <RankBadge rank={runner.rank} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-800">{runner.name}</p>
                      {isUser && (
                        <span className="text-xs bg-amber-500 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{runner.totalRuns} runs</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-800">{runner.totalContainers.toLocaleString()}</p>
                    <p className="text-xs text-green-600 font-medium">{formatCents(runner.totalEarnedCents)}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {runners.length === 0 && (
            <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
              <p className="text-gray-400 text-sm">No runners yet — be the first!</p>
            </div>
          )}
        </>
      )}

      {/* Info */}
      <div className="mt-6 bg-green-50 rounded-xl p-4 border border-green-200">
        <p className="text-xs text-green-700">
          {tab === "buildings"
            ? "Building rankings are normalised by number of residents so a 20-unit block can compete fairly with a 100-unit tower."
            : "Runner rankings are based on total containers delivered. Build streaks for bonus badges!"}
        </p>
      </div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
        rank === 1
          ? "bg-amber-400 text-white"
          : rank === 2
          ? "bg-gray-300 text-white"
          : rank === 3
          ? "bg-amber-600 text-white"
          : "bg-gray-100 text-gray-600"
      }`}
    >
      {rank}
    </div>
  );
}

function PodiumCard({
  building,
  height,
  medal,
  isTop,
}: {
  building: RankedBuilding;
  height: string;
  medal: string;
  isTop?: boolean;
}) {
  return (
    <div className="flex flex-col items-center w-1/3">
      <p className="text-xs text-gray-500 font-medium mb-1 truncate w-full text-center">
        {building.name}
      </p>
      <div
        className={`${height} w-full rounded-t-xl flex flex-col items-center justify-center ${
          isTop
            ? "bg-gradient-to-t from-amber-400 to-amber-300"
            : "bg-gradient-to-t from-gray-200 to-gray-100"
        }`}
      >
        <p className={`text-lg font-bold ${isTop ? "text-amber-800" : "text-gray-600"}`}>
          {medal}
        </p>
        <p className={`text-xl font-black ${isTop ? "text-amber-900" : "text-gray-700"}`}>
          {building.perResident}
        </p>
        <p className="text-xs text-gray-500">per res.</p>
      </div>
    </div>
  );
}
