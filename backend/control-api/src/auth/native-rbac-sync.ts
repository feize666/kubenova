import type { CoreV1Api, RbacAuthorizationV1Api, V1ObjectMeta } from '@kubernetes/client-node';
import { isDeepStrictEqual } from 'node:util';
import type { planNativeRbac } from './native-rbac';

export async function assertNativeRbacReady(api: RbacAuthorizationV1Api, core: CoreV1Api, desired: ReturnType<typeof planNativeRbac>[number]): Promise<void> {
  const state = await inspectNativeRbac(api, core, desired);
  if (!state.roleMatches || !state.bindingMatches) throw new Error('Native RBAC is not ready');
}

async function inspectNativeRbac(
  api: RbacAuthorizationV1Api, core: CoreV1Api,
  desired: ReturnType<typeof planNativeRbac>[number],
) {
  const { name, namespace, annotations } = desired.role.metadata;
  // Kubernetes client model prototypes are not part of the API's desired state.
  const equal = (left: unknown, right: unknown) => isDeepStrictEqual(
    JSON.parse(JSON.stringify(left ?? null)), JSON.parse(JSON.stringify(right ?? null)));
  if (!name.startsWith('kn-native-') || !namespace || !annotations['kubenova.io/namespace-uid'] ||
      !annotations['kubenova.io/cluster-id'] || !isDeepStrictEqual(desired.role.metadata, desired.binding.metadata)) {
    throw new Error('Invalid native RBAC target');
  }
  const checkNamespace = async () => {
    const live = await core.readNamespace({ name: namespace });
    if (live.metadata?.uid !== annotations['kubenova.io/namespace-uid']) throw new Error('Native namespace identity changed');
  };
  const read = async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
    try { return await operation(); } catch (error) {
      if ((error as { code?: number }).code === 404) return undefined;
      throw error;
    }
  };
  const owned = (metadata?: V1ObjectMeta) => {
    if (!metadata?.uid || !metadata.resourceVersion || metadata.name !== name || metadata.namespace !== namespace ||
      metadata.labels?.['app.kubernetes.io/managed-by'] !== 'kubenova' ||
      Object.entries(annotations).some(([key,value]) => metadata.annotations?.[key] !== value)) {
      throw new Error('Native RBAC ownership conflict');
    }
  };
  await checkNamespace();
  const role = await read(() => api.readNamespacedRole({ name, namespace }));
  const binding = await read(() => api.readNamespacedRoleBinding({ name, namespace }));
  if (role) owned(role.metadata);
  if (binding) owned(binding.metadata);
  const roleMatches = role && equal(role.rules, desired.role.rules);
  const bindingMatches = binding && equal(binding.subjects, desired.binding.subjects) && equal(binding.roleRef, desired.binding.roleRef);
  return { role, binding, roleMatches, bindingMatches, checkNamespace };
}

/** Internal only: caller supplies a persisted target and a live authorization revision guard. */
export async function reconcileNativeRbacPair(
  api: RbacAuthorizationV1Api, core: CoreV1Api,
  desired: ReturnType<typeof planNativeRbac>[number], revoke: boolean,
  assertCurrent: () => Promise<void>,
): Promise<void> {
  await assertCurrent();
  const { name, namespace } = desired.role.metadata;
  const { role, binding, roleMatches, bindingMatches, checkNamespace } = await inspectNativeRbac(api, core, desired);
  if (!revoke && roleMatches && bindingMatches) return;
  if (binding) await api.deleteNamespacedRoleBinding({ name, namespace,
    body: { preconditions: { uid: binding.metadata!.uid, resourceVersion: binding.metadata!.resourceVersion } } });
  if (revoke) {
    if (role) await api.deleteNamespacedRole({ name, namespace,
      body: { preconditions: { uid: role.metadata!.uid, resourceVersion: role.metadata!.resourceVersion } } });
    return;
  }
  if (!roleMatches) {
    if (role) await api.replaceNamespacedRole({ name, namespace, body: {
      ...desired.role, metadata: { ...desired.role.metadata, resourceVersion: role.metadata!.resourceVersion },
    } });
    else await api.createNamespacedRole({ namespace, body: desired.role });
  }
  // Never restore access after a failed apply or a changed grant/namespace snapshot.
  await assertCurrent();
  await checkNamespace();
  await api.createNamespacedRoleBinding({ namespace, body: desired.binding });
}

/** Removes only a live KubeNova-owned pair discovered as stale during a full sync. */
export async function revokeOwnedNativeRbacPair(
  api:RbacAuthorizationV1Api,core:CoreV1Api,
  target:{name:string;namespace:string;annotations?:Record<string,string>},assertCurrent:()=>Promise<void>,
) {
  const namespaceUid=target.annotations?.['kubenova.io/namespace-uid'];
  const clusterId=target.annotations?.['kubenova.io/cluster-id'];
  if(!target.name?.startsWith('kn-native-') || !target.namespace || !namespaceUid || !clusterId) throw new Error('Invalid native RBAC target');
  await assertCurrent();
  const live=await core.readNamespace({name:target.namespace});
  if(live.metadata?.uid!==namespaceUid) throw new Error('Native namespace identity changed');
  const read=async<T>(operation:()=>Promise<T>):Promise<T|undefined>=>{
    try{return await operation();}catch(error){if((error as {code?:number}).code===404)return undefined;throw error;}
  };
  const owned=(metadata?:V1ObjectMeta)=>{
    if(!metadata?.uid || !metadata.resourceVersion || metadata.name!==target.name || metadata.namespace!==target.namespace ||
      metadata.labels?.['app.kubernetes.io/managed-by']!=='kubenova' || metadata.annotations?.['kubenova.io/namespace-uid']!==namespaceUid ||
      metadata.annotations?.['kubenova.io/cluster-id']!==clusterId) throw new Error('Native RBAC ownership conflict');
  };
  const binding=await read(()=>api.readNamespacedRoleBinding({name:target.name,namespace:target.namespace}));
  if(binding) {
    owned(binding.metadata);
    await api.deleteNamespacedRoleBinding({name:target.name,namespace:target.namespace,
      body:{preconditions:{uid:binding.metadata!.uid,resourceVersion:binding.metadata!.resourceVersion}}});
  }
  const role=await read(()=>api.readNamespacedRole({name:target.name,namespace:target.namespace}));
  if(role) {
    owned(role.metadata);
    await api.deleteNamespacedRole({name:target.name,namespace:target.namespace,
      body:{preconditions:{uid:role.metadata!.uid,resourceVersion:role.metadata!.resourceVersion}}});
  }
}
