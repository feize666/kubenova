"use client";

import { useState } from "react";
import { SafetyOutlined } from "@ant-design/icons";
import { Alert, Collapse, Empty, Input } from "antd";
import { OpsPageHeader, OpsSurface } from "@/components/ops";
import { searchHandbook } from "./content";
import "./handbook.css";

export default function HandbookPage() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>(["getting-started"]);
  const chapters = searchHandbook(query);
  const searching = query.trim().length > 0;
  return (
    <div className="ops-page handbook-page">
      <OpsPageHeader title="使用手册" subtitle="从日常操作到故障排查，按任务查找控制台使用方法" />
      <OpsSurface className="handbook-page__intro">
        <Input.Search allowClear aria-label="搜索使用手册" placeholder="搜索命名空间、日志、权限、YAML 等关键词"
          value={query} onChange={(event) => setQuery(event.target.value)} />
      </OpsSurface>
      <Alert showIcon icon={<SafetyOutlined />} type="info" message="权限说明"
        description="所有用户可阅读相同内容；章节中的权限提示不会为当前账号授予权限。管理员功能仍需相应角色，集群操作仍需目标资源授权。" />
      <OpsSurface className="handbook-page__sections">
        {chapters.length ? <Collapse
          activeKey={searching ? chapters.map((chapter) => chapter.id) : expanded}
          onChange={(keys) => { if (!searching) setExpanded(typeof keys === "string" ? [keys] : keys); }}
          items={chapters.map((chapter) => ({
            key: chapter.id,
            label: <div><strong>{chapter.title}</strong><div className="handbook-chapter-summary">{chapter.summary}</div></div>,
            children: <div className="handbook-section-content">
              <p className="handbook-permission">操作权限：{chapter.permission}</p>
              {chapter.topics.map((topic) => <section key={topic.title} className="handbook-topic">
                <h3>{topic.title}</h3>
                <ol>{topic.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                {topic.note ? <p className="handbook-note">提示：{topic.note}</p> : null}
              </section>)}
            </div>,
          }))}
        /> : <Empty description="未找到相关内容，请减少关键词或清空搜索" />}
      </OpsSurface>
    </div>
  );
}
