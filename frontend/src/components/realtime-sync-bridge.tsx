"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import {
  applyRealtimePatch,
  getTopologyQueryPrefixes,
  type RealtimeEvent,
} from "@/components/realtime-sync-utils";

const STREAM_PATH = "/api/v1/clusters/events/stream";
const RECONNECT_DELAY_MS = 1500;

function buildStreamUrl() {
  return STREAM_PATH;
}

export function RealtimeSyncBridge() {
  const queryClient = useQueryClient();
  const { accessToken, isAuthenticated } = useAuth();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!accessToken || !isAuthenticated) {
      return;
    }

    const controller = new AbortController();
    let buffer = "";
    const refreshQueryPrefixes = (queryPrefixes: readonly (readonly unknown[])[]) => {
      for (const queryKey of queryPrefixes) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    const processBuffer = () => {
      buffer = buffer.replace(/\r\n/g, "\n");
      while (true) {
        const separatorIndex = buffer.indexOf("\n\n");
        if (separatorIndex === -1) {
          return;
        }
        const chunk = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) {
          continue;
        }
        try {
          const event = JSON.parse(data) as RealtimeEvent;
          if (Array.isArray(event.domains) && event.domains.length > 0) {
            const patched = applyRealtimePatch(queryClient, event);
            const topologyPrefixes = getTopologyQueryPrefixes(event);
            const shouldRefreshTopology =
              !patched &&
              typeof document !== "undefined" &&
              !document.hidden &&
              pathnameRef.current.startsWith("/network/topology");
            if (shouldRefreshTopology && topologyPrefixes.length > 0) {
              refreshQueryPrefixes(topologyPrefixes);
            }
            if (!patched && topologyPrefixes.length === 0) {
              // No-op fallback: list/query handlers already handled the current event shape.
            }
          }
        } catch {
          // Ignore malformed event frames and continue streaming.
        }
      }
    };

    const connect = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(buildStreamUrl(), {
            method: "GET",
            headers: {
              Accept: "text/event-stream",
              Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            throw new Error(`stream failed: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) {
              throw new Error("stream closed");
            }
            buffer += decoder.decode(value, { stream: true });
            processBuffer();
          }
        } catch {
          if (controller.signal.aborted) {
            return;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, RECONNECT_DELAY_MS),
          );
        }
      }
    };

    void connect();

    return () => {
      controller.abort();
    };
  }, [accessToken, isAuthenticated, queryClient]);

  return null;
}
