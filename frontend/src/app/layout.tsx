import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import Script from "next/script";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import "./globals.css";
import "../components/login-page-v2.css";
import "./overview-topology-solid.css";
import "./ops-design-system.css";
import "./ops-text-consistency.css";
import "./ops-layout-consistency.css";
import "./solid-surface-overrides.css";
import "./topology-solid-surfaces.css";
import "./topology-panorama.css";
import "./topology-kubejojo.css";
import "@xyflow/react/dist/style.css";

export const metadata: Metadata = {
  title: "KubeNova",
  description: "云原生智能运维控制台",
  icons: {
    icon: [
      { url: "/kubenova-icon.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/kubenova-icon.svg"],
    apple: [{ url: "/kubenova-icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Script
          id="kubenova-theme-init"
          strategy="beforeInteractive"
        >{`try{var m=localStorage.getItem('kubenova-theme-mode');document.documentElement.setAttribute('data-theme',m==='dark'||m==='light'?m:'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}`}</Script>
        <AntdRegistry>
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
