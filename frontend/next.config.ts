import type { NextConfig } from "next";

function normalizeHttpBase(raw: string, fallback: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return fallback;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("ws://")) return `http://${trimmed.slice("ws://".length)}`;
  if (trimmed.startsWith("wss://")) return `https://${trimmed.slice("wss://".length)}`;
  return fallback;
}

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async rewrites() {
    const configuredBase = (process.env.NEXT_PUBLIC_CONTROL_API_BASE ?? "").trim().replace(/\/+$/, "");
    const backendBase = /^https?:\/\//i.test(configuredBase) ? configuredBase : "http://127.0.0.1:4000";
    const configuredGatewayBase =
      (process.env.NEXT_PUBLIC_RUNTIME_GATEWAY_BASE ?? process.env.RUNTIME_GATEWAY_BASE_URL ?? "").trim();
    const runtimeGatewayBase = normalizeHttpBase(configuredGatewayBase, "http://127.0.0.1:4100");
    return [
      {
        source: "/ws/:path*",
        destination: `${runtimeGatewayBase}/ws/:path*`,
      },
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
