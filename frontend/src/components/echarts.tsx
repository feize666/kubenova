"use client";

import dynamic from "next/dynamic";

const ECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div style={{ height: 320 }}>图表加载中...</div>,
});

export default ECharts;
