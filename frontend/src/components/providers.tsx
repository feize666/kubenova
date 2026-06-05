"use client";

import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AuthProvider } from "@/components/auth-context";
import { ThemeProvider } from "@/components/theme-context";

const RealtimeSyncBridge = dynamic(
  () => import("@/components/realtime-sync-bridge").then((mod) => mod.RealtimeSyncBridge),
  { ssr: false },
);

function RealtimeSyncBridgeSlot() {
  const pathname = usePathname();
  if (pathname === "/login") {
    return null;
  }
  return <RealtimeSyncBridge />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 2 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <AntdApp>
            <RealtimeSyncBridgeSlot />
            {children}
          </AntdApp>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
