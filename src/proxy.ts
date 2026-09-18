import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifySessionToken } from "@/lib/adminAuth";
import { ADMIN_PATH } from "@/config/constants";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Login page/API are how you get a session in the first place -- don't
  // gate those, or nobody could ever log in.
  const isLoginPage = pathname === `${ADMIN_PATH}/login`;
  const isLoginApi = pathname === "/api/admin/login";
  if (isLoginPage || isLoginApi) {
    return NextResponse.next();
  }

  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const valid = await verifySessionToken(token);

  if (!valid) {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL(`${ADMIN_PATH}/login`, req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Next.js statically analyzes `matcher` at build time, so it must be a
// literal here -- it can't reference the ADMIN_PATH import. Keep these two
// in sync if you ever change ADMIN_PATH in src/config/constants.ts.
export const config = {
  matcher: ["/ctrl-9k3x7m2q/:path*", "/api/admin/:path*"],
};
