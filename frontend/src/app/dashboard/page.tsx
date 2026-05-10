import { redirect } from "next/navigation";

// /dashboard 保持向后兼容，永久重定向到根路径（智能仪表盘）
export default function DashboardPage() {
  redirect("/");
}
