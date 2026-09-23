"use client";

import "./master-detail.css";

import { CloseOutlined } from "@ant-design/icons";
import { Drawer } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface MasterDetailShellProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number | string;
  backPath?: string;
  headerExtra?: ReactNode;
}

export function MasterDetailShell({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 680,
  backPath,
  headerExtra,
}: MasterDetailShellProps) {
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClose = useCallback(() => {
    // Only call the parent's onClose. The parent (page.tsx) handles the
    // actual navigation (window.history.back or fallback). We no longer
    // push backPath here to avoid a second navigation.
    closeRef.current();
  }, []);

  if (!mounted) return null;

  // Keep wide detail panels readable on large screens without overflowing
  // narrow viewports, so action rails always stay on a single row.
  const resolvedWidth = typeof width === "number" ? `min(100vw, ${width}px)` : width;

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      placement="right"
      width={resolvedWidth}
      closable={false}
      destroyOnClose
      className="master-detail-drawer"
      styles={{
        body: { padding: 0 },
        wrapper: { boxShadow: "-4px 0 24px rgba(0,0,0,0.08)" },
      }}
    >
      <div className="master-detail-header">
        <div className="master-detail-header__left">
          <div className="master-detail-header__title">{title ?? "详情"}</div>
          {subtitle && (
            <div className="master-detail-header__subtitle">{subtitle}</div>
          )}
        </div>
        <div className="master-detail-header__right">
          {headerExtra}
          <button
            className="master-detail-header__close"
            onClick={handleClose}
            aria-label="关闭详情"
            type="button"
          >
            <CloseOutlined />
          </button>
        </div>
      </div>
      <div className="master-detail-body">{children}</div>
    </Drawer>
  );
}
