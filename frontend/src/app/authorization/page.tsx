"use client";
import { useState } from "react";
import UsersPage from "@/app/users/page";

const capabilities = ["集群资源查看", "日志读取", "终端执行", "Secret 管理", "Kubeconfig 管理"];

export default function AuthorizationPage() {
  const [tab, setTab] = useState<"users" | "grants">("users");
  return <div className="authorization-page">
    <div className="authorization-page__tabs" role="tablist" aria-label="授权管理视图">
      <button className={tab === "users" ? "is-active" : ""} onClick={() => setTab("users")} role="tab">用户与用户组</button>
      <button className={tab === "grants" ? "is-active" : ""} onClick={() => setTab("grants")} role="tab">集群访问授权</button>
    </div>
    {tab === "users" ? <UsersPage /> : <section className="authorization-page__empty"><h1>集群访问授权</h1><p>按集群、命名空间和能力范围授予访问权限。</p><div className="authorization-page__capabilities">{capabilities.map((item) => <span key={item}>{item}</span>)}</div><p>授权配置界面正在接入细粒度授权服务，现有用户管理不受影响。</p></section>}
  </div>;
}
