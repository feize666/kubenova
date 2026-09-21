"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Spin } from "antd";
import { MfaResetPage } from "@/components/mfa-reset-page";

function Content() {
  const params = useSearchParams();
  return <MfaResetPage targetId={params.get("target") ?? ""} />;
}

export default function Page() {
  return <Suspense fallback={<Spin />}><Content /></Suspense>;
}
