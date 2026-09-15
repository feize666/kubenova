"use client";

import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { useSyncExternalStore } from "react";
import { OpsIconActionButton } from "@/components/ops";
import { parseSidebarPreference, SIDEBAR_PREFERENCE_KEY } from "@/lib/sidebar-preference";

const changeEvent = "kubenova:sidebar-preference";
let fallback = false;
let persistenceUnavailable = false;

function readPreference() {
  if (persistenceUnavailable) return fallback;
  try {
    return parseSidebarPreference(window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY));
  } catch {
    return fallback;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changeEvent, listener);
  };
}

export function useSidebarCollapse() {
  const collapsed = useSyncExternalStore(subscribe, readPreference, () => false);
  const toggle = () => {
    fallback = !readPreference();
    try {
      window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(fallback));
    } catch {
      // Private browsing may deny persistence; the current session still works.
      persistenceUnavailable = true;
    }
    window.dispatchEvent(new Event(changeEvent));
  };
  return { collapsed, toggle };
}

export function SidebarCollapseButton({ collapsed, onClick, controls }: {
  collapsed: boolean;
  onClick: () => void;
  controls: string;
}) {
  const label = collapsed ? "展开侧边导航" : "收起侧边导航";
  return (
    <div className="shell-sidebar-toggle">
      <OpsIconActionButton
        title={label}
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls={controls}
        onClick={onClick}
        icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
      />
    </div>
  );
}
