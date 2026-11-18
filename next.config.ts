import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["tiktok-live-connector", "qrcode", "jszip"],
  outputFileTracingIncludes: {
    "/api/packages/windows": ["./scripts/**/*", "./docs/**/*", "./desktop/**/*", "./web/**/*"],
    "/api/packages/library": ["./web/**/*", "./public/**/*"],
  },
};

export default nextConfig;
