"use client";

import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "@/components/auth-context";
import { RealtimeSyncBridge } from "@/components/realtime-sync-bridge";
import { ThemeProvider } from "@/components/theme-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <AntdApp>
            <RealtimeSyncBridge />
            {children}
          </AntdApp>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
