"use client";

import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import type { HTMLAttributes, ReactNode } from "react";
import { useState } from "react";

import { OpsIconActionButton } from "./ops-button";

export type OpsCommandPreviewKind = "command" | "log" | "code" | "approval";
export type OpsCommandPreviewTone = "neutral" | "info" | "success" | "warning" | "danger";

export type OpsCommandPreviewProps = Omit<HTMLAttributes<HTMLElement>, "children" | "title"> & {
  actions?: ReactNode;
  allowCopy?: boolean;
  content: string;
  copyLabel?: string;
  copyText?: string;
  description?: ReactNode;
  footer?: ReactNode;
  kind?: OpsCommandPreviewKind;
  language?: ReactNode;
  meta?: ReactNode;
  onCopy?: (value: string) => void | Promise<void>;
  title?: ReactNode;
  tone?: OpsCommandPreviewTone;
  wrap?: boolean;
};

const KIND_LABEL: Record<OpsCommandPreviewKind, string> = {
  approval: "审批预览",
  code: "代码预览",
  command: "命令预览",
  log: "日志预览",
};

async function writeClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard API unavailable");
  }
  await navigator.clipboard.writeText(value);
}

export function OpsCommandPreview({
  actions,
  allowCopy = true,
  className,
  content,
  copyLabel = "复制内容",
  copyText,
  description,
  footer,
  kind = "command",
  language,
  meta,
  onCopy,
  title,
  tone = "neutral",
  wrap = false,
  ...props
}: OpsCommandPreviewProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resolvedCopyText = copyText ?? content;
  const canCopy = allowCopy && resolvedCopyText.length > 0;
  const resolvedTitle = title ?? KIND_LABEL[kind];

  async function handleCopy() {
    if (!canCopy) return;
    try {
      if (onCopy) {
        await onCopy(resolvedCopyText);
      } else {
        await writeClipboard(resolvedCopyText);
      }
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section
      {...props}
      className={[
        "ops-command-preview",
        `ops-command-preview--${kind}`,
        `ops-command-preview--${tone}`,
        wrap ? "ops-command-preview--wrap" : undefined,
        className,
      ].filter(Boolean).join(" ")}
      data-kind={kind}
      data-ops-command-preview=""
      data-tone={tone}
    >
      <div className="ops-command-preview__header">
        <div className="ops-command-preview__heading">
          <div className="ops-command-preview__title">{resolvedTitle}</div>
          {description ? <div className="ops-command-preview__description">{description}</div> : null}
        </div>
        <div className="ops-command-preview__tools" data-resource-table-stop-navigation="true">
          {meta ? <span className="ops-command-preview__meta">{meta}</span> : null}
          {language ? <span className="ops-command-preview__language">{language}</span> : null}
          {actions}
          {canCopy ? (
            <OpsIconActionButton
              aria-label={copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : copyLabel}
              disabled={copyState === "failed" && !onCopy && typeof navigator !== "undefined" && !navigator.clipboard}
              icon={copyState === "copied" ? <CheckOutlined /> : <CopyOutlined />}
              onClick={handleCopy}
              opsVariant="icon"
              size="small"
              title={copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : copyLabel}
            />
          ) : null}
        </div>
      </div>
      <pre className="ops-command-preview__body" tabIndex={0}>
        <code>{content}</code>
      </pre>
      {footer ? <div className="ops-command-preview__footer">{footer}</div> : null}
    </section>
  );
}
