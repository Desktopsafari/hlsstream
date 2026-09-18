import type { MetadataRoute } from "next";
import { ADMIN_PATH } from "@/config/constants";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [ADMIN_PATH, `${ADMIN_PATH}/`, "/api/"],
    },
  };
}
