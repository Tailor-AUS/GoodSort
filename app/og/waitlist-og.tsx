import { LIVE_VOLUME_THRESHOLD } from "@/lib/brisbane";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "The Good Sort — scan first in Brisbane";

export function waitlistOgElement(opts?: { suburb?: string }) {
  const suburb = opts?.suburb;
  const kicker = suburb ? `${suburb} · scan first` : "Brisbane · scan first";
  const headline = suburb
    ? `Scan in ${suburb}`
    : "Scan, sort, skip the depot.";
  const body = suburb
    ? `About ${LIVE_VOLUME_THRESHOLD} containers unlock a driver trip to the refund point.`
    : `Scan for 5¢. About ${LIVE_VOLUME_THRESHOLD} containers — one driver trip — and we collect.`;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#f8fafc",
        color: "#0f172a",
        fontFamily: "Arial, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(135deg, #ede9fe 0%, #ffffff 36%, #dcfce7 100%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 72,
          top: 64,
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div
          style={{
            width: 74,
            height: 74,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div style={{ width: 68, height: 12, borderRadius: 7, background: "#7c3aed" }} />
          <div
            style={{
              width: 58,
              height: 52,
              borderRadius: 10,
              border: "3px solid #c4b5fd",
              background: "#f5f3ff",
              display: "flex",
              flexWrap: "wrap",
              padding: 7,
              gap: 5,
            }}
          >
            {["#3b82f6", "#14b8a6", "#f59e0b", "#16a34a"].map((color) => (
              <div key={color} style={{ width: 19, height: 16, borderRadius: 5, background: color }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 44, fontWeight: 800 }}>The Good Sort</div>
          <div style={{ fontSize: 21, color: "#6d28d9", fontWeight: 700 }}>{kicker}</div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 80,
          top: 200,
          width: 640,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 64, lineHeight: 0.98, fontWeight: 900 }}>{headline}</div>
        <div style={{ marginTop: 22, fontSize: 26, lineHeight: 1.3, color: "#334155", maxWidth: 600 }}>
          {body}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 70,
          top: 150,
          width: 330,
          height: 360,
          borderRadius: 34,
          background: "#ffffff",
          border: "2px solid #ddd6fe",
          display: "flex",
          flexDirection: "column",
          padding: 28,
          gap: 18,
        }}
      >
        {(
          [
            ["Scan", "#7c3aed"],
            ["5¢ credit", "#2563eb"],
            ["Volume run", "#d97706"],
            ["Refund point", "#15803d"],
          ] as const
        ).map(([label, color], index) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                background: color,
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                fontWeight: 900,
              }}
            >
              {index + 1}
            </div>
            <div style={{ fontSize: 32, fontWeight: 900 }}>{label}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          left: 80,
          bottom: 48,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 24,
          fontWeight: 800,
          color: "#166534",
        }}
      >
        <div style={{ width: 14, height: 14, borderRadius: 999, background: "#22c55e" }} />
        thegoodsort.org
      </div>
    </div>
  );
}
