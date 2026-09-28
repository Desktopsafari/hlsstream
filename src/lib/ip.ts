// Vercel sets x-forwarded-for on every request; same header the chat
// service reads client IPs from (chat-service/server.js's getClientIp).
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}
