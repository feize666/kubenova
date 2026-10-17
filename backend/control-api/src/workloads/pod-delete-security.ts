import { ConflictException } from '@nestjs/common';
export function podDeleteOptions(namespace:string,name:string,uid:unknown,expectedUid?:unknown) {
  if(typeof uid!=='string'||!uid.trim())throw new ConflictException('Pod 身份尚未同步，拒绝按名称删除。请等待资源同步后刷新重试。');
  if(expectedUid!==undefined&&expectedUid!==uid)throw new ConflictException('Pod 已重建或身份变化，请刷新并重新确认删除目标。');
  return {name,namespace,body:{preconditions:{uid},propagationPolicy:'Background'}};
}
