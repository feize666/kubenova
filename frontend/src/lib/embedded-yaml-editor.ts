import type { DynamicResourceIdentity, ResourceIdentity } from './api/resources';
import { editorResourceType, parseResourceDocuments } from './resource-editor';
export function embeddedYamlContext(yaml:string,identity:ResourceIdentity,dynamic?:DynamicResourceIdentity|null) {
  try {
    const docs=parseResourceDocuments(yaml);
    if(docs.length!==1)return null;
    const manifest=docs[0];
    const name=dynamic?.name??identity.name;
    const namespace=dynamic?.namespace??identity.namespace??'';
    const definition=editorResourceType(manifest.kind);
    if(manifest.metadata.name!==name||(manifest.metadata.namespace??'')!==namespace)return null;
    if(!dynamic&&manifest.kind.toLowerCase()!==identity.kind.toLowerCase())return null;
    if(dynamic&&manifest.apiVersion!==(dynamic.group?`${dynamic.group}/${dynamic.version}`:dynamic.version))return null;
    return {clusterId:dynamic?.clusterId??identity.clusterId,kind:manifest.kind,apiVersion:manifest.apiVersion,name,namespace,resource:dynamic?.resource??definition?.resource??'',namespaced:dynamic?!!dynamic.namespace:definition?.namespaced??!!namespace};
  }catch{return null;}
}
