"use client";

import { Button, Result } from "antd";

export default function UpdateError({ reset }: { reset: () => void }) {
  return <Result status="error" title="更新管理暂时无法显示"
    subTitle="请重试加载；正在执行的升级任务不会因页面关闭而取消。"
    extra={<Button type="primary" onClick={reset}>重新加载</Button>} />;
}
