import { API_HEADERS, handleActivity } from "@/server/map-api";
import { getViewer } from "@/server/viewer";

export const dynamic = "force-dynamic";

/** GET /api/map/activity?category=&ageBand=&month=&h3=&bbox= */
export async function GET(request: Request): Promise<Response> {
  const viewer = await getViewer();
  const result = await handleActivity(viewer, new URL(request.url).searchParams);
  return Response.json(result.body, { status: result.status, headers: API_HEADERS });
}
