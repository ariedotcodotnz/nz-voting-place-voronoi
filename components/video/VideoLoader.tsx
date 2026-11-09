"use client";

import dynamic from "next/dynamic";

const VideoStudio = dynamic(() => import("./VideoStudio"), { ssr: false });

export default function VideoLoader() {
  return <VideoStudio />;
}
