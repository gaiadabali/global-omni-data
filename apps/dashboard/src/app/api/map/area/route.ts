import { API_HEADERS, handleArea } from "@/server/map-api";
import { getViewer } from "@/server/viewer";

export const dynamic = "force-dynamic";

/** GET /api/map/area?level=&id=&brand=&audience=&month= */
export async function GET(request: Request): Promise<Response> {
  const viewer = await getViewer();
  const result = await handleArea(viewer, new URL(request.url).searchParams);
  return Response.json(result.body, { status: result.status, headers: API_HEADERS });
}
