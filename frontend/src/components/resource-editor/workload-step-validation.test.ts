import assert from 'node:assert/strict';
import test from 'node:test';
import { createResourceDraft, setManifestValue } from '@/lib/resource-editor';
import { workloadPodPath } from './workload-fields';
import { validateWorkloadStep, workloadStepTransition } from './workload-step-validation';

test('empty basic information blocks advancement without reporting later container errors', () => {
  const draft = createResourceDraft('Deployment', 'default');
  const result = workloadStepTransition(draft, 0, 1);
  assert.equal(result.step, 0);
  assert.ok(result.errors.some(error => error.includes('metadata.name')));
  assert.ok(result.errors.every(error => !error.includes('镜像')));
});

test('valid basic information advances even when the later image is empty', () => {
  const draft = setManifestValue(createResourceDraft('Deployment', 'default'), ['metadata', 'name'], 'api');
  assert.deepEqual(workloadStepTransition(draft, 0, 1), {step: 1, errors: []});
});

test('blank namespace blocks basic advancement', () => {
  const draft = createResourceDraft('Pod', '   ');
  draft.metadata.name = 'api';
  assert.ok(validateWorkloadStep(draft, 0).some(error => error.includes('metadata.namespace')));
});

for (const kind of ['Pod', 'Deployment', 'CronJob']) {
  test(`${kind} container step checks its real pod path and rejects whitespace image`, () => {
    let draft = createResourceDraft(kind, 'default');
    const path = [...workloadPodPath(kind), 'containers'];
    draft = setManifestValue(draft, path, [{name: 'main', image: '   '}]);
    const result = workloadStepTransition(draft, 1, 2);
    assert.equal(result.step, 1);
    assert.ok(result.errors.some(error => error.includes('镜像')));
    draft = setManifestValue(draft, path, [{name: 'main', image: 'nginx:1'}]);
    assert.deepEqual(workloadStepTransition(draft, 1, 2), {step: 2, errors: []});
  });
}

test('empty container collection and incomplete init containers block container advancement', () => {
  let draft = createResourceDraft('Pod', 'default');
  draft = setManifestValue(draft, ['spec', 'containers'], []);
  assert.ok(validateWorkloadStep(draft, 1).length > 0);
  draft = setManifestValue(draft, ['spec', 'containers'], [{name: 'main', image: 'nginx'}]);
  draft = setManifestValue(draft, ['spec', 'initContainers'], [{name: '', image: 'busybox'}]);
  assert.ok(validateWorkloadStep(draft, 1).some(error => error.includes('initContainers')));
});

test('forward step selection validates intervening steps; backward navigation is unrestricted', () => {
  const draft = createResourceDraft('Deployment', 'default');
  draft.metadata.name = 'api';
  assert.equal(workloadStepTransition(draft, 0, 2).step, 1);
  assert.deepEqual(workloadStepTransition(draft, 2, 0), {step: 0, errors: []});
  const before = structuredClone(draft);
  validateWorkloadStep(draft, 0);
  assert.deepEqual(draft, before);
});
