import { AI_ACTION_REGISTRY, getAiActionDefinition, isReadOnlyAiAction } from './ai-action-registry';

describe('AI action registry', () => {
  it('declares every supported operation and requires confirmation for writes', () => {
    expect(Object.keys(AI_ACTION_REGISTRY)).toHaveLength(19);
    expect(getAiActionDefinition('query-pods-overview')).toMatchObject({ risk: 'read', requiresApproval: false });
    expect(getAiActionDefinition('apply-resource-manifest')).toMatchObject({ risk: 'critical', requiresApproval: true });
    expect(getAiActionDefinition('restart-workload')).toMatchObject({ requiresApproval: true });
  });

  it('defaults unknown operations to denied rather than read-only', () => {
    expect(getAiActionDefinition('delete-everything')).toBeUndefined();
    expect(isReadOnlyAiAction('delete-everything')).toBe(false);
  });
});
