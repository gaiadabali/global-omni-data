import { API_HEADERS, handleSummary } from "@/server/map-api";
import { getViewer } from "@/server/viewer";

export const dynamic = "force-dynamic";

/** GET /api/map/summary?brand=&audience=&measure=&month=&level=&limit= */
export async function GET(request: Request): Promise<Response> {
  const viewer = await getViewer();
  const result = await handleSummary(viewer, new URL(request.url).searchParams);
  return Response.json(result.body, { status: result.status, headers: API_HEADERS });
}
