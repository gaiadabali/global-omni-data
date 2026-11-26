"use client";

import dynamic from "next/dynamic";
import { Loading } from "@/components/ui";
import type { InfluenceMapProps } from "./InfluenceMap";

/**
 * The map and its WebGL bundle (MapLibre, deck.gl) load only here, in the browser, so no other page downloads them.
 * `ssr: false` must sit in a client component, hence this small wrapper between the server page and the map.
 */
const InfluenceMap = dynamic(() => import("./InfluenceMap"), {
  ssr: false,
  loading: () => (
    <div className="pd-skel">
      <Loading>Loading the map</Loading>
    </div>
  ),
});

export function InfluenceMapLoader(props: InfluenceMapProps) {
  return <InfluenceMap {...props} />;
}
