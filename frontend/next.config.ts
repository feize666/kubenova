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
  // Build candidates separately from the directory used by the running server.
  distDir: process.env.KUBENOVA_NEXT_DIST_DIR || ".next",
  output: "standalone",
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  onDemandEntries: {
    maxInactiveAge: 2 * 60_000,
    pagesBufferLength: 4,
  },
  experimental: {
    optimizePackageImports: ["antd", "@ant-design/icons", "reactflow"],
    webpackMemoryOptimizations: true,
  },
  async rewrites() {
    // Rewrites run inside the frontend container. Keep this separate from
    // NEXT_PUBLIC_CONTROL_API_BASE, which is intentionally browser-facing.
    const configuredBase = (
      process.env.CONTROL_API_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_CONTROL_API_BASE ?? ""
    ).trim().replace(/\/+$/, "");
    const backendBase = /^https?:\/\//i.test(configuredBase) ? configuredBase : "http://127.0.0.1:4000";
    const configuredGatewayBase =
      (
        process.env.RUNTIME_GATEWAY_INTERNAL_BASE_URL ??
        process.env.NEXT_PUBLIC_RUNTIME_GATEWAY_BASE ??
        process.env.RUNTIME_GATEWAY_BASE_URL ??
        ""
      ).trim();
    const runtimeGatewayBase = normalizeHttpBase(configuredGatewayBase, "http://127.0.0.1:4100");
    return [
      {
        source: "/ws/:path*",
        destination: `${runtimeGatewayBase}/ws/:path*`,
      },
      {
        // AI 助手流式对话使用 control-api 的 socket.io（命名空间 /ws/ai-assistant）。
        // socket.io 的握手路径固定为 /socket.io，与指向 runtime gateway 的
        // /ws/* 重写冲突，因此单独使用 /ai-ws/socketio 前缀做转发。
        // 目标保留尾部斜杠：socket.io 的引擎路径必须以 / 结尾，否则握手 404。
        source: "/ai-ws/socketio/:path*",
        destination: `${backendBase}/socket.io/`,
      },
      {
        source: "/ai-ws/socketio",
        destination: `${backendBase}/socket.io/`,
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
