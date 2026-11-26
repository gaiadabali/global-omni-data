import { API_HEADERS, handleActivityArea } from "@/server/map-api";
import { getViewer } from "@/server/viewer";

export const dynamic = "force-dynamic";

/** GET /api/map/activity-area?level=h3|sa2&id=&month=&category=&ageBand= */
export async function GET(request: Request): Promise<Response> {
  const viewer = await getViewer();
  const result = await handleActivityArea(viewer, new URL(request.url).searchParams);
  return Response.json(result.body, { status: result.status, headers: API_HEADERS });
}
