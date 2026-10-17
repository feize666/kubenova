export function editorNavigationContext(pathname:string,search:string,href?:string){
  try {if(href){const current=new URL(href);if(current.pathname===pathname&&['http:','https:'].includes(current.protocol))search=current.search.slice(1);}}catch{/* Use router context during server rendering or invalid URL. */}
  return {returnTo:pathname+(search?'?'+search:''),params:new URLSearchParams(search)};
}
