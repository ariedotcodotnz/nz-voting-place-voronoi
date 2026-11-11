import type { Metadata } from "next";
import VideoLoader from "@/components/video/VideoLoader";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Timeline video frames — ${SITE_NAME}`,
  robots: { index: false, follow: false },
};

/** Vertical video frames for `npm run videos` (scripts/make-videos.mjs). */
export default function VideoPage() {
  return <VideoLoader />;
}
