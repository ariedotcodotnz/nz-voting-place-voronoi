import AtlasLoader from "@/components/atlas/AtlasLoader";

export default function Page() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-wash">
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
