import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Analytics } from "@/components/Analytics";
import "./globals.css";

const grotesk = Schibsted_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Party Vote Atlas — New Zealand general elections by polling place",
  description:
    "An interactive map of New Zealand party-vote results at every polling place, 2008–2026, with estimated catchments, political blocs, proportional circles and historical swing.",
};

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
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Analytics />
      </body>
    </html>
  );
}
