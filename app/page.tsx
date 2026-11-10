import type { Metadata } from "next";
import AtlasLoader from "@/components/atlas/AtlasLoader";
import elections from "@/config/elections.json";
import { ELECTION_YEARS, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL, absoluteUrl } from "@/lib/site";
import { OG_IMAGE } from "./og.png/image";

const first = ELECTION_YEARS[0];
const last = ELECTION_YEARS[ELECTION_YEARS.length - 1];
const preliminary = elections.elections.filter((e) => e.status === "preliminary").map((e) => e.year);

export const metadata: Metadata = {
  // Every view (election, mode, party, map position) lives in the query
  // string; they are all one page to search engines.
  alternates: { canonical: "/" },
  ...(SITE_URL && {
    openGraph: {
      type: "website",
      url: "/",
      siteName: SITE_NAME,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      locale: "en_NZ",
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION, images: [OG_IMAGE] },
  }),
};

/** Structured data for search engines (schema.org WebSite and Dataset). */
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      ...(SITE_URL && { "@id": absoluteUrl("/#website"), url: absoluteUrl("/") }),
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: "en-NZ",
    },
    {
      "@type": "Dataset",
      ...(SITE_URL && { "@id": absoluteUrl("/#dataset"), url: absoluteUrl("/") }),
      name: `New Zealand general election results by polling place, ${first}–${last}`,
      description: `Party votes and electorate (candidate) votes counted at every polling place in the New Zealand general elections of ${ELECTION_YEARS.join(", ")}, with estimated polling-place catchments built from Stats NZ 2026 meshblocks.${preliminary.length ? ` ${preliminary.join(", ")} results are the preliminary count.` : ""}`,
      keywords: ["New Zealand", "general election", "party vote", "electorate vote", "polling places", "election results", "map"],
      temporalCoverage: `${first}/${last}`,
      spatialCoverage: { "@type": "Place", name: "New Zealand" },
      isAccessibleForFree: true,
      inLanguage: "en-NZ",
      isBasedOn: [
        { "@type": "Dataset", name: "Election results by voting place", creator: { "@type": "GovernmentOrganization", name: "Electoral Commission", url: "https://elections.nz" } },
        { "@type": "Dataset", name: "Meshblock 2026", url: "https://datafinder.stats.govt.nz/layer/123521-meshblock-2026/", creator: { "@type": "GovernmentOrganization", name: "Stats NZ" } },
        { "@type": "Dataset", name: "NZ Coastlines and Islands Polygons (Topo 1:50k)", creator: { "@type": "GovernmentOrganization", name: "Toitū Te Whenua Land Information New Zealand" } },
      ],
    },
  ],
};

export default function Page() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-wash">
      {/* Built only from this repo's config; "<" is escaped so the JSON cannot close the tag (Next.js JSON-LD guide). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <AtlasLoader />
      <noscript>
        <div className="p-8 text-ink">
          <h1 className="text-2xl font-semibold">Party Vote Atlas</h1>
          <p className="mt-2 max-w-prose text-ink-2">This interactive map needs JavaScript. It shows New Zealand party-vote results at every polling place, 2008–2026.</p>
        </div>
      </noscript>
    </main>
  );
}
