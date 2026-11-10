import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Analytics } from "@/components/Analytics";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import "./globals.css";

const grotesk = Schibsted_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  // Resolves relative URLs (canonical, social images) to absolute ones.
  ...(SITE_URL ? { metadataBase: SITE_URL } : {}),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
};

// Optional Chrome origin-trial token that turns on WebMCP for visitors.
const WEBMCP_ORIGIN_TRIAL_TOKEN = process.env.WEBMCP_ORIGIN_TRIAL_TOKEN?.trim();

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NZ" className={`${grotesk.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden">
        {/* React places this in <head>. */}
        {WEBMCP_ORIGIN_TRIAL_TOKEN && <meta httpEquiv="origin-trial" content={WEBMCP_ORIGIN_TRIAL_TOKEN} />}
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Analytics />
      </body>
    </html>
  );
}
