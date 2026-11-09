"use client";

import dynamic from "next/dynamic";

/** The atlas is browser-only (Google Maps + WebGL). Rendering it client-side
 *  avoids any server-rendering/hydration mismatch in the static export. */
const Atlas = dynamic(() => import("./Atlas"), {
  ssr: false,
  loading: () => <Splash />,
});

export function Splash({ message = "Loading the atlas…" }: { message?: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-wash" role="status" aria-live="polite">
      <div className="text-center">
        <p className="text-[15px] font-semibold tracking-tight text-ink">Party Vote Atlas</p>
        <p className="mt-1 text-[13px] text-ink-3">{message}</p>
      </div>
    </div>
  );
}

export default function AtlasLoader() {
  return <Atlas />;
}
