'use client';
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useOptionalClusterWorkspace } from '@/components/cluster-workspace-context';
import { buildResourceEditorHref } from '@/lib/resource-editor';
import { readStoredResourceNamespace } from '@/lib/resource-scope-events';
import { editorNavigationContext } from '@/lib/editor-navigation-context';

export function useResourceEditorNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const workspace = useOptionalClusterWorkspace();
  return useCallback((identity: {clusterId?:string;kind:string;name?:string;namespace?:string;apiVersion?:string;resource?:string;readOnly?:boolean}, mode:'form'|'yaml'='form')=>{
    const current=editorNavigationContext(pathname,params.toString(),typeof window==='undefined'?undefined:window.location.href);
    const clusterId = identity.clusterId || workspace?.clusterId || current.params.get('clusterId') || '';
    const namespace = identity.namespace ?? current.params.get('namespace') ?? readStoredResourceNamespace(clusterId);
    const returnTo = current.returnTo;
    router.push(buildResourceEditorHref({...identity,clusterId,namespace,mode,returnTo}),{scroll:true});
  },[router,pathname,params,workspace?.clusterId]);
}
