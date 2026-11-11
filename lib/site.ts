/**
 * Site identity for metadata, structured data, the sitemap and social
 * previews. Server-side only: read at build time.
 */
import elections from "@/config/elections.json";

export { SITE_NAME } from "./brand";
export const SITE_TITLE = "NZ Election Voting Places Map: results at every polling place, 2008–2026";
/** The long name on its own, for the link-preview card. */
export const SITE_LONG_NAME = "NZ Election Voting Places Map";
export const SITE_DESCRIPTION =
  "An interactive map of New Zealand general election results at every polling place, 2008–2026: party and electorate votes, with estimated catchments, political blocs, proportional circles and historical swing.";

/** Elections on the map, oldest first. */
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
