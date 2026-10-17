export function drawerWrapperWidth(variant:string,width:number,fullscreen=false){
  if(fullscreen)return '100vw';
  if(variant==='inspector')return `min(100vw, clamp(384px, 32vw, ${Math.min(Math.max(width,384),460)}px))`;
  return variant==='resource'?`min(100vw, ${width}px)`:`min(100vw, ${width}px, max(50vw, 720px))`;
}
