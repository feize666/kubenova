"use client";

import { Tooltip, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

export function useNowTicker(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

export function formatRelativeTime(value?: string, now = Date.now()): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return "-";
  }
  const diffMs = Math.max(0, now - time);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds || 1}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function formatAbsoluteTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("zh-CN");
}

export function ResourceTimeCell({
  value,
  now,
  mode = "relative",
}: {
  value?: string;
  now?: number;
  mode?: "relative" | "absolute";
}) {
  const absolute = useMemo(() => formatAbsoluteTime(value), [value]);
  const relative = useMemo(() => formatRelativeTime(value, now), [value, now]);
  const text = mode === "absolute" ? absolute : relative;

  return (
    <Tooltip title={absolute}>
      <Typography.Text>{text}</Typography.Text>
    </Tooltip>
  );
}
