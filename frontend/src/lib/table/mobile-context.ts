export function isMobileContextColumn(identity:string):boolean{
  return /^(namespace(?:name)?|cluster(?:id|name)?|名称空间|命名空间|集群)$/.test(identity.toLowerCase().replace(/[\s_-]+/g,''));
}
