import { planNativeRbac } from './native-rbac';

describe('native RBAC plan', () => {
  const now = new Date('2026-09-20T00:00:00Z');
  const grant = { id:'g', userId:'u', groupId:null, clusterId:'c', role:'viewer', state:'active', validFrom:new Date(0), expiresAt:null, revokedAt:null,
    namespaces:[{ namespaceUid:'uid', namespaceName:'ai' }], capabilities:[{capability:'kubeconfig'}] };
  const input = {userId:'u',clusterId:'c',grants:[grant],namespaces:[{name:'ai',uid:'uid'}],now};
  it('keeps all presets read-only without wildcard or implicit sensitive capabilities', () => {
    for (const role of ['viewer','operator','cluster-admin']) {
      const [plan] = planNativeRbac({...input,grants:[{...grant,role}]});
      expect(plan.role.kind).toBe('Role'); expect(plan.binding.kind).toBe('RoleBinding');
      expect(plan.role.rules.every(rule => rule.verbs.join(',') === 'get,list,watch')).toBe(true);
      for (const resource of ['secrets','pods/log','pods/exec','*']) expect(plan.role.rules.flatMap(rule => rule.resources)).not.toContain(resource);
      expect(plan.binding.subjects[0].name).toMatch(/^kubenova:native:[a-f0-9]{40}$/);
    }
    expect(planNativeRbac(input)).toEqual(planNativeRbac(input));
  });
  it('requires the sensitive capability on a native-enabled grant', () => {
    const sensitive = {...grant,id:'s',capabilities:[{capability:'logs'},{capability:'exec'},{capability:'secrets'}]};
    const resources = (grants: typeof input.grants) => planNativeRbac({...input,grants})[0].role.rules.flatMap(rule => rule.resources);
    expect(resources([grant,sensitive])).not.toContain('secrets');
    expect(resources([{...sensitive,capabilities:[...sensitive.capabilities,{capability:'kubeconfig'}]}])).toEqual(expect.arrayContaining(['secrets','pods/log','pods/exec']));
  });
  it('omits expired, revoked, foreign and recreated namespace grants', () => {
    for (const changes of [{userId:'other'},{expiresAt:now},{revokedAt:now},{clusterId:'other'},{state:'revoked'},{capabilities:[]},{namespaces:[{namespaceUid:'old',namespaceName:'ai'}]}]) {
      expect(planNativeRbac({...input,grants:[{...grant,...changes}]})).toEqual([]);
    }
    expect(() => planNativeRbac({...input,namespaces:[...input.namespaces,...input.namespaces]})).toThrow();
  });
});
