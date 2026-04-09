import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthGuard } from "./components/shared/auth-guard";

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
      <body className="h-dvh overflow-hidden bg-white text-slate-900 overscroll-none" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <AuthGuard>{children}</AuthGuard>
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').then(function(reg) {
              // Check for updates every 60s (catches deploys while app is open)
              setInterval(function() { reg.update(); }, 60000);
            }).catch(function() {});
            // Reload when a new service worker takes over
            navigator.serviceWorker.addEventListener('message', function(e) {
              if (e.data && e.data.type === 'SW_UPDATED') {
                window.location.reload();
              }
            });
            // Also reload if the controlling SW changes (e.g. first install)
            var refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', function() {
              if (!refreshing) { refreshing = true; window.location.reload(); }
            });
          }
        `}} />
      </body>
    </html>
  );
}
