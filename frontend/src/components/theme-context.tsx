"use client";

import { ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

dayjs.locale("zh-cn");

type ThemeMode = "dark" | "light";

type ThemeContextValue = {
  mode: ThemeMode;
  toggleTheme: () => void;
};

const ThemeModeContext = createContext<ThemeContextValue | null>(null);

function getInitialThemeMode(): ThemeMode {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") {
      return attr;
    }
  }
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem("kubenova-theme-mode");
    if (saved === "dark" || saved === "light") {
      return saved;
    }
  }
  return "light";
}

export function useThemeMode() {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error("主题上下文不可用");
  }
  return ctx;
}

const darkTheme = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: "#3b82f6",
    colorInfo: "#38bdf8",
    colorBgBase: "#0a0e1a",
    colorBgContainer: "#111827",
    colorBgLayout: "#0a0e1a",
    colorBgElevated: "#1a2234",
    colorBorderSecondary: "rgba(59,130,246,0.2)",
    colorBorder: "rgba(59,130,246,0.15)",
    colorText: "#e2e8f0",
    colorTextSecondary: "#94a3b8",
    colorTextTertiary: "#64748b",
    borderRadius: 8,
    fontFamily: '"Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Layout: {
      siderBg: "#0d1424",
      headerBg: "#0d1424",
      bodyBg: "#0a0e1a",
    },
    Menu: {
      darkItemBg: "#0d1424",
      darkSubMenuItemBg: "#0a0e1a",
      darkItemSelectedBg: "rgba(59,130,246,0.15)",
      darkItemHoverBg: "rgba(59,130,246,0.08)",
      darkItemColor: "#94a3b8",
      darkItemSelectedColor: "#60a5fa",
    },
    Card: {
      colorBgContainer: "#111827",
      colorBorderSecondary: "rgba(59,130,246,0.15)",
    },
    Table: {
      colorBgContainer: "#111827",
      headerBg: "#1a2234",
      borderColor: "rgba(59,130,246,0.12)",
    },
    Input: {
      colorBgContainer: "#1a2234",
      colorBorder: "rgba(59,130,246,0.25)",
      hoverBorderColor: "#3b82f6",
    },
    Button: {
      colorBgContainer: "transparent",
    },
    Modal: {
      contentBg: "#111827",
      headerBg: "#111827",
    },
    Drawer: {
      colorBgElevated: "#111827",
    },
    Select: {
      colorBgContainer: "#1a2234",
      colorBgElevated: "#1a2234",
    },
    Dropdown: {
      colorBgElevated: "#1a2234",
    },
  },
};

const lightTheme = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#2563eb",
    colorInfo: "#0ea5e9",
    colorBgBase: "#f0f4ff",
    colorBgContainer: "#ffffff",
    colorBgLayout: "#f0f4ff",
    colorBorderSecondary: "rgba(59,130,246,0.2)",
    colorBorder: "rgba(59,130,246,0.2)",
    colorText: "#1e293b",
    colorTextSecondary: "#64748b",
    borderRadius: 8,
    fontFamily: '"Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Layout: {
      siderBg: "#ffffff",
      headerBg: "#ffffff",
      bodyBg: "#f0f4ff",
    },
    Menu: {
      itemSelectedBg: "rgba(37,99,235,0.08)",
      itemHoverBg: "rgba(37,99,235,0.05)",
      itemSelectedColor: "#2563eb",
    },
    Card: {
      colorBgContainer: "#ffffff",
    },
    Table: {
      headerBg: "#f8faff",
    },
  },
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getInitialThemeMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    window.localStorage.setItem("kubenova-theme-mode", mode);
  }, [mode]);

  const value = useMemo(
    () => ({ mode, toggleTheme: () => setMode((m) => (m === "dark" ? "light" : "dark")) }),
    [mode],
  );

  const themeConfig = mode === "dark" ? darkTheme : lightTheme;

  return (
    <ThemeModeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={themeConfig}>
        {children}
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}
