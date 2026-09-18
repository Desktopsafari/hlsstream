// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
// when a CRON_SECRET env var is set on the project. This stops anyone else
// on the internet from hitting these routes to open/close polls at will.
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
