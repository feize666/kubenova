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
const INVALIDATE_BATCH_DELAY_MS = 250;
const INITIAL_CONNECT_DELAY_MS = 1200;

function buildStreamUrl() {
  return STREAM_PATH;
}

function isRouteTransitionSettling() {
  if (typeof window === "undefined") {
    return false;
  }
  const routeWindow = window as Window & { __KUBENOVA_ROUTE_TRANSITION_UNTIL?: number };
  return (routeWindow.__KUBENOVA_ROUTE_TRANSITION_UNTIL ?? 0) > performance.now();
}

function waitForRealtimeIdleWindow(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined" || signal.aborted) {
      resolve();
      return;
    }

    let idleId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let settled = false;
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (idleId !== null) {
        idleWindow.cancelIdleCallback?.(idleId);
        idleId = null;
      }
      signal.removeEventListener("abort", done);
    };
    const done = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const scheduleWhenQuiet = () => {
      if (signal.aborted) {
        done();
        return;
      }
      if (document.hidden || isRouteTransitionSettling()) {
        timer = setTimeout(scheduleWhenQuiet, 500);
        return;
      }
      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(done, { timeout: 2000 });
      } else {
        timer = setTimeout(done, INITIAL_CONNECT_DELAY_MS);
      }
    };
    signal.addEventListener("abort", done, { once: true });
    timer = setTimeout(scheduleWhenQuiet, INITIAL_CONNECT_DELAY_MS);
  });
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
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingInvalidations = new Map<string, readonly unknown[]>();
    const refreshQueryPrefixes = (queryPrefixes: readonly (readonly unknown[])[]) => {
      for (const queryKey of queryPrefixes) {
        pendingInvalidations.set(JSON.stringify(queryKey), queryKey);
      }
      if (invalidateTimer) {
        return;
      }
      invalidateTimer = setTimeout(() => {
        invalidateTimer = null;
        const keys = Array.from(pendingInvalidations.values());
        pendingInvalidations.clear();
        keys.forEach((queryKey) => {
          void queryClient.invalidateQueries({ queryKey });
        });
      }, INVALIDATE_BATCH_DELAY_MS);
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
      await waitForRealtimeIdleWindow(controller.signal);
      while (!controller.signal.aborted) {
        if (typeof document !== "undefined" && document.hidden) {
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
          continue;
        }
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
      if (invalidateTimer) {
        clearTimeout(invalidateTimer);
      }
      controller.abort();
    };
  }, [accessToken, isAuthenticated, queryClient]);

  return null;
}
