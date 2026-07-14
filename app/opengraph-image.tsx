import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME } from "./seo";

export const alt = "The Good Sort yellow-bin container pickup service in Brisbane";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return new ImageResponse(
    (
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
            background:
              "linear-gradient(135deg, #fef9c3 0%, #ffffff 36%, #dcfce7 100%)",
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 72,
            top: 70,
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
            <div
              style={{
                width: 68,
                height: 12,
                borderRadius: 7,
                background: "#eab308",
              }}
            />
            <div
              style={{
                width: 58,
                height: 52,
                borderRadius: 10,
                border: "3px solid #fde047",
                background: "#fefce8",
                display: "flex",
                flexWrap: "wrap",
                padding: 7,
                gap: 5,
              }}
            >
              {["#3b82f6", "#14b8a6", "#f59e0b", "#16a34a"].map((color) => (
                <div
                  key={color}
                  style={{
                    width: 19,
                    height: 16,
                    borderRadius: 5,
                    background: color,
                  }}
                />
              ))}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div
              style={{
                fontSize: 44,
                fontWeight: 800,
                letterSpacing: 0,
              }}
            >
              {SITE_NAME}
            </div>
            <div
              style={{
                fontSize: 21,
                color: "#15803d",
                fontWeight: 700,
              }}
            >
              Brisbane yellow-bin pickup
            </div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: 80,
            top: 205,
            width: 610,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 74,
              lineHeight: 0.95,
              fontWeight: 900,
              letterSpacing: 0,
            }}
          >
            Turn cans and bottles into pickup credits.
          </div>
          <div
            style={{
              marginTop: 26,
              fontSize: 28,
              lineHeight: 1.25,
              color: "#334155",
              maxWidth: 585,
            }}
          >
            {SITE_DESCRIPTION}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 70,
            top: 118,
            width: 330,
            height: 380,
            borderRadius: 34,
            background: "#ffffff",
            border: "2px solid #dbeafe",
            display: "flex",
            flexDirection: "column",
            padding: 30,
            gap: 20,
          }}
        >
          {[
            ["Scan", "#16a34a"],
            ["Sort", "#2563eb"],
            ["Pickup", "#d97706"],
            ["Paid", "#0f766e"],
          ].map(([label, color], index) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 18,
                  background: color,
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  fontWeight: 900,
                }}
              >
                {index + 1}
              </div>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 900,
                  color: "#0f172a",
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            position: "absolute",
            left: 80,
            bottom: 52,
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 25,
            fontWeight: 800,
            color: "#166534",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#22c55e",
            }}
          />
          thegoodsort.org
        </div>
      </div>
    ),
    size
  );
}
