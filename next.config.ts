import type { NextConfig } from "next";

/**
 * Static export for Cloudflare Pages: `next build` writes a fully static site
 * to `out/`. The map, data loading and URL state are all client-side, so no
 * server runtime is needed. (Cache Components / Partial Prefetching from the
 * starter template require a Node server and are therefore not enabled.)
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
