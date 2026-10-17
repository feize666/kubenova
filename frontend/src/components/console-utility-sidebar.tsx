"use client";

import { Avatar, Tooltip } from "antd";
import { BookOutlined, LeftOutlined, MoonOutlined, RightOutlined, RobotOutlined, SunOutlined } from "@ant-design/icons";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-context";
import { useThemeMode } from "@/components/theme-context";
import { isPlatformAdmin } from "@/lib/console-routing";
import { getAiAssistantAccess } from "@/lib/api/ai-assistant";
import { useQuery } from "@tanstack/react-query";
import "./console-utility-sidebar.css";

const COLLAPSED_KEY = "kubenova.console.utility-sidebar.collapsed";
const FloatingAiAssistant = dynamic(
  () => import("@/components/ai-assistant/floating-assistant").then((mod) => mod.FloatingAiAssistant),
  { ssr: false },
);

export function ConsoleUtilitySidebar({ children }: { children: ReactNode }) {
  const { isAuthenticated, isInitializing, role, accessToken } = useAuth();
  const { mode, toggleTheme } = useThemeMode();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const aiAccessQuery = useQuery({
    queryKey: ["ai-assistant", "access", accessToken],
    queryFn: () => getAiAssistantAccess(accessToken || undefined),
    enabled: isAuthenticated && Boolean(accessToken) && !isPlatformAdmin(role),
    staleTime: 30_000,
  });
  const canUseAi = isPlatformAdmin(role) || Boolean(aiAccessQuery.data?.allowed);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(COLLAPSED_KEY);
        setCollapsed(stored === null ? window.innerWidth < 768 : stored === "1");
      } catch {
        setCollapsed(window.innerWidth < 768);
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function changeCollapsed(next: boolean) {
    setCollapsed(next);
    if (next) setAiOpen(false);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Storage may be disabled; the current page still supports collapse.
    }
    window.requestAnimationFrame(() => {
      (next ? restoreButtonRef : collapseButtonRef).current?.focus();
    });
  }

  const visible = ready && !isInitializing && isAuthenticated;

  return (
    <div className={`console-utilities${collapsed || !visible ? " console-utilities--collapsed" : ""}`}>
      {children}
      {visible && collapsed ? (
        <Tooltip title="显示侧边栏" placement="left">
          <button ref={restoreButtonRef} type="button" className="console-utility-restore" aria-label="显示侧边栏" aria-controls="console-utility-sidebar" aria-expanded={false} onClick={() => changeCollapsed(false)}>
            <LeftOutlined aria-hidden />
          </button>
        </Tooltip>
      ) : null}
      {visible ? (
        <>
        {!collapsed ? <button type="button" className="console-utility-backdrop" aria-label="关闭工具栏遮罩" onClick={() => changeCollapsed(true)} tabIndex={-1} /> : null}
        <aside
          id="console-utility-sidebar"
          className={`console-utility-sidebar${collapsed ? " console-utility-sidebar--collapsed" : ""}`}
          aria-label="控制台工具栏"
          aria-hidden={collapsed}
          inert={collapsed}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !collapsed) {
              event.preventDefault();
              event.stopPropagation();
              changeCollapsed(true);
            }
          }}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === "transform" && !collapsed) collapseButtonRef.current?.focus();
          }}
        >
          <div className="console-utility-sidebar__top">
            {canUseAi ? (
              <Tooltip title="AI 助手" placement="left">
                <button
                  type="button"
                  className={`console-utility-sidebar__avatar${aiOpen ? " is-active" : ""}`}
                  aria-label="打开 AI 助手"
                  aria-haspopup="dialog"
                  aria-expanded={aiOpen}
                  onClick={() => setAiOpen((prev) => !prev)}
                >
                  <Avatar size={44} src="/assistant-avatar.png" alt="AI 助手机器人" icon={<RobotOutlined />} />
                </button>
              </Tooltip>
            ) : null}
          </div>
          <div className="console-utility-sidebar__bottom">
            <Tooltip title="使用手册" placement="left">
              <button type="button" className="console-utility-sidebar__button" aria-label="打开使用手册" onClick={() => {
                router.push("/handbook");
                if (window.matchMedia("(max-width: 767px)").matches) changeCollapsed(true);
              }}>
                <BookOutlined aria-hidden />
              </button>
            </Tooltip>
            <Tooltip title={mode === "dark" ? "切换到浅色主题" : "切换到深色主题"} placement="left">
              <button type="button" className="console-utility-sidebar__button" aria-label={mode === "dark" ? "切换到浅色主题" : "切换到深色主题"} onClick={toggleTheme}>
                {mode === "dark" ? <SunOutlined aria-hidden /> : <MoonOutlined aria-hidden />}
              </button>
            </Tooltip>
            <Tooltip title="收起侧边栏" placement="left">
              <button ref={collapseButtonRef} type="button" className="console-utility-sidebar__button" aria-label="收起侧边栏" aria-controls="console-utility-sidebar" aria-expanded={!collapsed} onClick={() => changeCollapsed(true)}>
                <RightOutlined aria-hidden />
              </button>
            </Tooltip>
          </div>
        </aside>
        </>
      ) : null}
      {visible && canUseAi ? (
        <FloatingAiAssistant open={aiOpen} onOpenChange={setAiOpen} onCollapseSidebar={() => changeCollapsed(true)} insetRight={collapsed ? 0 : 64} />
      ) : null}
    </div>
  );
}
