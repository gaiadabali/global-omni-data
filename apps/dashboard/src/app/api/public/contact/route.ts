import { handlePublicContact } from "@/server/enquiries/public-contact";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/contact: the public site's contact form. The only route in the dashboard that needs no sign-in
 * (PUBLIC_ROUTES in src/server/access.ts). nginx on god.gaiada.com proxies /api/contact here (infra/dashboard/RUNBOOK.md).
 * Every rule is in src/server/enquiries/public-contact.ts. Any other method gets Next's own 405.
 */
export async function POST(request: Request): Promise<Response> {
  return handlePublicContact(request);
}
