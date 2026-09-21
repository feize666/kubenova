import { NotFoundException } from '@nestjs/common';
import { nativeReadResources } from './native-request';

export function isNativeDiscoveryTarget(target:string) {
  if(typeof target!=='string'||target.length>2048||/[\s#\\]/.test(target))return false;
  const [pathname,query]=target.split('?');
  if(!/^\/api(?:\/v1)?$|^\/apis(?:\/[a-z0-9.-]+(?:\/v[0-9]+(?:alpha[0-9]+|beta[0-9]+)?)?)?$/.test(pathname))return false;
  if(query===undefined)return true;
  const params=new URLSearchParams(query);
  return target.split('?').length===2 && [...params.keys()].length===1 && params.has('timeout') && /^\d+(?:\.\d+)?(?:ms|s|m|h)$/.test(params.get('timeout')??'');
}

/** Uses the cluster discovery inventory, intersected with the implemented gateway surface. */
export function nativeDiscovery(target:string,rows:Array<{group:string;version:string;kind:string;resource:string;namespaced:boolean;verbsJson:unknown}>,capabilities:string[]) {
  if(!isNativeDiscoveryTarget(target)) throw new NotFoundException('Unsupported discovery path');
  target=target.split('?')[0];
  const apis=new Map<string,Array<{name:string;singularName:string;namespaced:boolean;kind:string;verbs:string[]}>>();
  for(const row of rows) {
    const api=row.group?`/apis/${row.group}/${row.version}`:`/api/${row.version}`;
    if(!row.namespaced || !nativeReadResources[api]?.includes(row.resource) || (row.resource==='secrets' && !capabilities.includes('secrets'))) continue;
    const verbs=['get','list','watch'].filter(verb=>Array.isArray(row.verbsJson)&&row.verbsJson.includes(verb));
    if(!verbs.length) continue;
    const resources=apis.get(api)??[];
    resources.push({name:row.resource,singularName:'',namespaced:true,kind:row.kind,verbs});apis.set(api,resources);
  }
  const groups=[...new Set([...apis.keys()].filter(api=>api.startsWith('/apis/')).map(api=>api.split('/')[2]))].sort().map(name=>{
    const versions=[...apis.keys()].filter(api=>api.startsWith(`/apis/${name}/`)).sort().map(api=>({groupVersion:api.slice(6),version:api.split('/')[3]}));
    return {name,versions,preferredVersion:versions[0]};
  });
  if(target==='/api') return {apiVersion:'v1',kind:'APIVersions',versions:apis.has('/api/v1')?['v1']:[],serverAddressByClientCIDRs:[]};
  if(target==='/apis') return {apiVersion:'v1',kind:'APIGroupList',groups};
  const group=groups.find(group=>target===`/apis/${group.name}`);
  if(group) return {apiVersion:'v1',kind:'APIGroup',...group};
  const resources=apis.get(target);
  if(!resources) throw new NotFoundException('Unsupported discovery API');
  return {apiVersion:'v1',kind:'APIResourceList',groupVersion:target.startsWith('/apis/')?target.slice(6):target.slice(5),resources:resources.sort((a,b)=>a.name.localeCompare(b.name))};
}
