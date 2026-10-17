import { isResourceAccessDenied } from '@/lib/query/visible-resource-data';

export interface EditorReadAccess {
  scope:string;
  denied:boolean;
}

export function editorReadAccess(previous:EditorReadAccess,scope:string,error:unknown):EditorReadAccess {
  const denied=previous.scope===scope&&previous.denied;
  // A transient retry failure must not authorize the last successful snapshot.
  return {scope,denied:isResourceAccessDenied(error)||!!error&&denied};
}
