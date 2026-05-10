"use client";

import { AutoscalingConsole } from "@/components/workloads/autoscaling-console";

export default function HpaAutoscalingPage() {
  return <AutoscalingConsole defaultType="HPA" />;
}
