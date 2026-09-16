"use client";
import { useState } from "react";
import UsersPage from "@/app/users/page";
import { useAuth } from "@/components/auth-context";
import { useQuery } from "@tanstack/react-query";
import { getAccessGrants } from "@/lib/api/users";

const capabilities = ["集群资源查看", "日志读取", "终端执行", "Secret 管理", "Kubeconfig 管理"];

export default function AuthorizationPage() {
  const [tab, setTab] = useState<"users" | "grants">("users");
  const { accessToken } = useAuth();
  const grants = useQuery({ queryKey: ["access-grants", accessToken], queryFn: () => getAccessGrants(undefined, accessToken!), enabled: tab === "grants" && Boolean(accessToken) });
  return <div className="authorization-page">
    <div className="authorization-page__tabs" role="tablist" aria-label="授权管理视图">
      <button className={tab === "users" ? "is-active" : ""} onClick={() => setTab("users")} role="tab">用户与用户组</button>
      <button className={tab === "grants" ? "is-active" : ""} onClick={() => setTab("grants")} role="tab">集群访问授权</button>
    </div>
    {tab === "users" ? <UsersPage /> : <section className="authorization-page__empty"><h1>集群访问授权</h1><p>按集群、命名空间和能力范围授予访问权限。</p><div className="authorization-page__capabilities">{capabilities.map((item) => <span key={item}>{item}</span>)}</div>{grants.isLoading ? <p>加载授权中…</p> : grants.isError ? <p>授权列表加载失败，请稍后重试。</p> : grants.data?.items.length ? grants.data.items.map((grant) => <article key={grant.id}><strong>{grant.principal?.username ?? grant.principal?.name ?? "未知主体"}</strong> · {grant.cluster.name} · {grant.role}<br /><small>命名空间：{grant.namespaces.map((item) => item.name).join(", ") || "全部"}　能力：{grant.capabilities.join(", ") || "基础查看"}</small></article>) : <p>暂无集群访问授权</p>}</section>}
  </div>;
}
