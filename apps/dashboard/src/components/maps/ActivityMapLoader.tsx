"use client";

import dynamic from "next/dynamic";
import { Loading } from "@/components/ui";
import type { ActivityMapProps } from "./ActivityMap";

/** See InfluenceMapLoader: the WebGL bundle loads in the browser only, on this page only. */
const ActivityMap = dynamic(() => import("./ActivityMap"), {
  ssr: false,
  loading: () => (
    <div className="gm-skeleton">
      <Loading>Loading the map</Loading>
    </div>
  ),
});

export function ActivityMapLoader(props: ActivityMapProps) {
  return <ActivityMap {...props} />;
}
