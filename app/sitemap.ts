import type { MetadataRoute } from "next";
import manifest from "@/public/data/manifest.json";
import { absoluteUrl } from "@/lib/site";

// Written to out/sitemap.xml at build time (static export).
export const dynamic = "force-static";

/** The atlas is one page; its views live in the query string (see the canonical link). */
export default function sitemap(): MetadataRoute.Sitemap {
  const home = absoluteUrl("/");
  // Sitemaps need absolute URLs: without SITE_URL it is left empty.
  return home ? [{ url: home, lastModified: manifest.generatedAt, changeFrequency: "monthly", priority: 1 }] : [];
}
