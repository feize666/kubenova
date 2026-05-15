import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import Script from "next/script";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "KubeNova",
  description: "云原生智能运维控制台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Script
          id="kubenova-theme-init"
          strategy="beforeInteractive"
        >{`try{var m=localStorage.getItem('kubenova-theme-mode');if(m==='dark'||m==='light'){document.documentElement.setAttribute('data-theme',m);}}catch(e){}`}</Script>
        <AntdRegistry>
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
