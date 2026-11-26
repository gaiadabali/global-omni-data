import { API_HEADERS, handleHotspots } from "@/server/map-api";
import { getViewer } from "@/server/viewer";

export const dynamic = "force-dynamic";

/** GET /api/map/hotspots?category=&ageBand=&month=&bbox=&limit= */
export async function GET(request: Request): Promise<Response> {
  const viewer = await getViewer();
  const result = await handleHotspots(viewer, new URL(request.url).searchParams);
  return Response.json(result.body, { status: result.status, headers: API_HEADERS });
}
