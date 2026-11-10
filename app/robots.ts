import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

// Written to out/robots.txt at build time (static export).
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const sitemap = absoluteUrl("/sitemap.xml");
  return {
    // Everything stays crawlable: rendering the map needs /data/* and /_next/*
    // (data files are kept out of results with an X-Robots-Tag header instead),
    // and /video carries its own noindex.
    rules: { userAgent: "*", allow: "/" },
    ...(sitemap && { sitemap }),
  };
}
