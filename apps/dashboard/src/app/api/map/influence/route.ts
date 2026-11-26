import { API_HEADERS, handleInfluence } from "@/server/map-api";
import { getViewer } from "@/server/viewer";

export const dynamic = "force-dynamic";

/** GET /api/map/influence?brand=&audience=&measure=&month=&level=state|sa4|sa3|sa2|h3&res=6|7&bbox= */
export async function GET(request: Request): Promise<Response> {
  const viewer = await getViewer();
  const result = await handleInfluence(viewer, new URL(request.url).searchParams);
  return Response.json(result.body, { status: result.status, headers: API_HEADERS });
}
