import type { Metadata } from "next";
import VideoLoader from "@/components/video/VideoLoader";

export const metadata: Metadata = {
  title: "Timeline video frames — Party Vote Atlas",
  robots: { index: false, follow: false },
};

/** Vertical video frames for `npm run videos` (scripts/make-videos.mjs). */
export default function VideoPage() {
  return <VideoLoader />;
}
