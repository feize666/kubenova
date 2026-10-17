export function scopedPlaceholder<T>(previous:T|undefined,query:{meta?:Record<string,unknown>}|undefined,scope:string):T|undefined {
  return scope&&query?.meta?.resourceScope===scope?previous:undefined;
}
