export type WorkloadWorkspaceStep =
  | 'basic'
  | 'image'
  | 'storage'
  | 'network'
  | 'init'
  | 'advanced'
  | 'submit';

export type WorkloadWorkspaceIssueCode =
  | 'VALIDATION_ERROR'
  | 'INGRESSROUTE_CRD_MISSING'
  | 'HELM_REPOSITORY_VALIDATE_FAILED';

export interface WorkloadWorkspaceValidationIssue {
  step: WorkloadWorkspaceStep;
  // Backward-compatible alias. New clients should read `step`.
  section?: WorkloadWorkspaceStep;
  // Backward-compatible alias. New clients should read `fieldPath`.
  field: string;
  fieldPath: string;
  message: string;
  code?: WorkloadWorkspaceIssueCode;
}

export function workspaceIssue(
  step: WorkloadWorkspaceStep,
  fieldPath: string,
  message: string,
  code: WorkloadWorkspaceIssueCode = 'VALIDATION_ERROR',
): WorkloadWorkspaceValidationIssue {
  return {
    step,
    section: step,
    field: fieldPath,
    fieldPath,
    message,
    code,
  };
}

export function mapWorkspaceErrorCode(
  error: unknown,
): WorkloadWorkspaceIssueCode {
  const text = stringifyError(error).toLowerCase();

  if (text.includes('ingressroute') && text.includes('crd')) {
    return 'INGRESSROUTE_CRD_MISSING';
  }

  if (
    text.includes('helm') &&
    text.includes('repository') &&
    (text.includes('validate') || text.includes('validation'))
  ) {
    return 'HELM_REPOSITORY_VALIDATE_FAILED';
  }

  return 'VALIDATION_ERROR';
}

function stringifyError(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (!error || typeof error !== 'object') {
    return '';
  }

  const asRecord = error as Record<string, unknown>;
  const message = asRecord.message;
  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message)) {
    return message
      .filter((item): item is string => typeof item === 'string')
      .join('; ');
  }

  return '';
}
