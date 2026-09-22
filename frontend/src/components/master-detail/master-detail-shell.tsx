"use client";

import "./master-detail.css";

import { CloseOutlined } from "@ant-design/icons";
import { Drawer } from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface MasterDetailShellProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
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
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClose = useCallback(() => {
    closeRef.current();
    if (backPath) {
      router.push(backPath);
    }
  }, [backPath, router]);

  useEffect(() => {
    if (!open || !backPath) return;
    const handlePopState = () => {
      closeRef.current();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [open, backPath]);

  if (!mounted) return null;

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      placement="right"
      width={width}
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
