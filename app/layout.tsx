import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthGuard } from "./components/shared/auth-guard";
import { InstallPrompt } from "./components/shared/install-prompt";

export const metadata: Metadata = {
  metadataBase: new URL("https://thegoodsort.org"),
  title: {
    default: "The Good Sort",
    template: "%s · The Good Sort",
  },
  description: "Scan. Sort. Earn. The Good Sort turns your recycling into cash — scan containers at home, we collect from your kerb, you get paid.",
  applicationName: "The Good Sort",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "The Good Sort",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "The Good Sort",
    title: "The Good Sort",
    description: "Scan. Sort. Earn. Turn your recycling into cash — we collect from your kerb and pay you.",
    url: "https://thegoodsort.org",
    locale: "en_AU",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "The Good Sort" }],
  },
  twitter: {
    card: "summary",
    title: "The Good Sort",
    description: "Scan. Sort. Earn. Turn your recycling into cash — we collect from your kerb and pay you.",
    images: ["/icon-512.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#ffffff",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <meta name="app-version" content="20260616-launch-hardening" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh bg-white text-slate-900 overscroll-none" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <AuthGuard>{children}</AuthGuard>
        <InstallPrompt />
        <script src="/sw-init.js" defer />
      </body>
    </html>
  );
}
