import type { ApiError } from '@/lib/api/client';
import type { WorkloadWorkspaceValidationIssue } from '@/lib/api/workloads';

interface WorkspaceIssueLike {
  step?: WorkloadWorkspaceValidationIssue['step'];
  section?: WorkloadWorkspaceValidationIssue['section'];
  fieldPath?: string;
  field?: string;
  message?: string;
  code?: string;
}

function normalizeIssue(input: WorkspaceIssueLike): WorkloadWorkspaceValidationIssue {
  const step = input.step ?? input.section ?? 'submit';
  return {
    step,
    section: step,
    fieldPath: input.fieldPath ?? input.field ?? 'submit',
    field: input.field ?? input.fieldPath ?? 'submit',
    message: input.message ?? '请求处理失败',
    code: input.code,
  };
}

export function mapApiErrorToWorkspaceIssues(error: ApiError): WorkloadWorkspaceValidationIssue[] {
  const details =
    error.details && typeof error.details === 'object'
      ? (error.details as {
          errors?: WorkspaceIssueLike[];
          validation?: WorkspaceIssueLike[];
        })
      : undefined;

  const rawIssues = details?.errors ?? details?.validation;
  if (Array.isArray(rawIssues) && rawIssues.length > 0) {
    return rawIssues.map(normalizeIssue);
  }

  if (error.code === 'INGRESSROUTE_CRD_MISSING') {
    return [
      normalizeIssue({
        step: 'network',
        field: 'networkMode',
        message: '集群未安装 IngressRoute CRD，请切换 Ingress 模式或先安装 Traefik CRD。',
        code: 'INGRESSROUTE_CRD_MISSING',
      }),
    ];
  }

  if (error.code === 'HELM_REPOSITORY_VALIDATE_FAILED') {
    return [
      normalizeIssue({
        step: 'image',
        field: 'image',
        message: '镜像地址校验失败，请检查地址与认证信息后重试。',
        code: 'HELM_REPOSITORY_VALIDATE_FAILED',
      }),
    ];
  }

  return [];
}
