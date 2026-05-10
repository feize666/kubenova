import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async rewrites() {
    const configuredBase = (process.env.NEXT_PUBLIC_CONTROL_API_BASE ?? "").trim().replace(/\/+$/, "");
    const backendBase = /^https?:\/\//i.test(configuredBase) ? configuredBase : "http://127.0.0.1:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendBase}/api/:path*`,
      },
      {
        source: "/proxy-api/:path*",
        destination: `${backendBase}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
