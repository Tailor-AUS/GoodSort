import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthGuard } from "./components/shared/auth-guard";
import { InstallPrompt } from "./components/shared/install-prompt";

export const metadata: Metadata = {
  title: "The Good Sort",
  description: "Scan. Sort. Earn sorting credits.",
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
