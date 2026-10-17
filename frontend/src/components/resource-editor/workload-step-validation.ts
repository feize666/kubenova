import { workloadPodPath } from './workload-fields';
import type { ResourceManifest } from '@/lib/resource-editor';

type StepResult = { step: number; errors: string[] };

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function at(value: unknown, path: Array<string|number>): unknown {
  return path.reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value);
}

function validateContainerList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) return [`${label}至少需要一个容器`];
  const errors: string[] = [];
  value.forEach((container, index) => {
    const item = container && typeof container === 'object' ? container as Record<string, unknown> : {};
    if (!text(item.name)) errors.push(`${label}[${index}]容器名称不能为空`);
    if (!text(item.image)) errors.push(`${label}[${index}]容器镜像不能为空`);
  });
  return errors;
}

/** Validate only the fields represented by the active workload wizard step. */
export function validateWorkloadStep(manifest: ResourceManifest, step: number): string[] {
  if (step === 0) {
    const errors: string[] = [];
    if (!text(manifest.metadata?.name)) errors.push('metadata.name 必须是非空文本');
    if (!text(manifest.metadata?.namespace)) errors.push('metadata.namespace 必须是非空文本');
    return errors;
  }
  if (step === 1) {
    const pod = at(manifest, workloadPodPath(manifest.kind));
    const initContainers = at(pod, ['initContainers']);
    return [
      ...validateContainerList(at(pod, ['containers']), '容器'),
      ...(initContainers === undefined || Array.isArray(initContainers) && initContainers.length === 0 ? [] : validateContainerList(initContainers, 'initContainers')),
    ];
  }
  return [];
}

/** Transition forward only after validating the step being left. */
export function workloadStepTransition(manifest: ResourceManifest, currentStep: number, nextStep: number): StepResult {
  if (nextStep <= currentStep) return { step: nextStep, errors: [] };
  for (let step = currentStep; step < nextStep; step++) {
    const errors = validateWorkloadStep(manifest, step);
    if (errors.length) return { step, errors };
  }
  return { step: nextStep, errors: [] };
}
