/**
 * Site identity for metadata, structured data, the sitemap and social
 * previews. Server-side only: read at build time.
 */
import elections from "@/config/elections.json";

export const SITE_NAME = "Party Vote Atlas";
export const SITE_TITLE = "Party Vote Atlas — New Zealand general elections by polling place";
export const SITE_DESCRIPTION =
  "An interactive map of New Zealand party-vote results at every polling place, 2008–2026, with estimated catchments, political blocs, proportional circles and historical swing.";

/** Elections in the atlas, oldest first. */
export const ELECTION_YEARS = elections.elections.map((e) => e.year).sort((a, b) => a - b);

/**
 * Public address of the deployed site, from SITE_URL (e.g.
 * https://atlas.example.nz). Canonical links, the sitemap and absolute social
 * image URLs need it; without it they are left out rather than guessed.
 */
export const SITE_URL: URL | null = (() => {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    throw new Error(`SITE_URL is not a valid absolute URL: ${raw}`);
  }
})();

export const absoluteUrl = (path: string) => (SITE_URL ? new URL(path, SITE_URL).toString() : null);
