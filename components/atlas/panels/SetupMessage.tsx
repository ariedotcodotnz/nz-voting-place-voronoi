import { KeyRound } from "lucide-react";

export function SetupMessage({ reason }: { reason: "missing" | "invalid" | "data"; detail?: string }) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-wash p-4">
      <div className="panel max-w-lg p-6" role="alert">
        <div className="flex items-center gap-2 text-ink">
          <KeyRound className="size-5" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">
            {reason === "missing" && "Google Maps is not configured"}
            {reason === "invalid" && "Google Maps rejected the API key"}
            {reason === "data" && "Election data could not be loaded"}
          </h1>
        </div>
        {reason === "data" ? (
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            The processed datasets in <code>/data</code> are missing or unreadable. Run <code>npm run data</code> to rebuild them from the files in <code>./data</code>, then reload.
          </p>
        ) : (
          <>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
              {reason === "missing"
                ? "This atlas draws its basemap with the Google Maps JavaScript API. Add a browser API key to the environment and rebuild:"
                : "The key in NEXT_PUBLIC_GOOGLE_MAPS_API_KEY was refused. Check that the Maps JavaScript API is enabled, billing is active, and this site’s address is allowed in the key’s website restrictions."}
            </p>
            {reason === "missing" && (
              <pre className="mt-3 overflow-x-auto rounded-md bg-wash px-3 py-2 text-[12.5px] text-ink">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-key{"\n"}NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=optional-map-id</pre>
            )}
            <p className="mt-3 text-[13px] text-ink-3">Setup steps, including how to restrict the key by website referrer, are in the README.</p>
          </>
        )}
      </div>
    </div>
  );
}
