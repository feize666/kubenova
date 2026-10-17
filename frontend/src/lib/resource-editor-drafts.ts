import { parseResourceDocuments } from './resource-editor';

export interface EditorDraftScope {username:string;clusterId:string;kind:string;apiVersion:string;resource:string;namespace:string;name:string}
export interface EditorDraft {yaml:string;originalYaml?:string;savedAt:number}
type DraftStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
function ordinaryYaml(yaml:string):boolean {
 try {
  if(yaml.length>2_000_000)return false;
  const hasSecret=(value:unknown):boolean=>!!value&&typeof value==='object'&&(Object.entries(value).some(([key,item])=>key==='kind'&&typeof item==='string'&&item.toLowerCase()==='secret'||hasSecret(item)));
  return !hasSecret(parseResourceDocuments(yaml));
 }catch{return false;}
}
export function createEditorDraftStore(storage:()=>DraftStorage){
 const key=(scope:EditorDraftScope)=>'kubenova-editor-draft:'+JSON.stringify([scope.username,scope.clusterId,scope.kind,scope.apiVersion,scope.resource,scope.namespace,scope.name]);
 const clear=(scope:EditorDraftScope)=>{try{storage().removeItem(key(scope));}catch{}};
 const safe=(scope:EditorDraftScope,draft:Omit<EditorDraft,'savedAt'>)=>!!scope.username&&!!scope.clusterId&&scope.kind.toLowerCase()!=='secret'&&ordinaryYaml(draft.yaml)&&(draft.originalYaml===undefined||typeof draft.originalYaml==='string'&&ordinaryYaml(draft.originalYaml));
 return {clear,save:(scope:EditorDraftScope,draft:Omit<EditorDraft,'savedAt'>,allowed:boolean,now=Date.now())=>{
  if(!allowed||!safe(scope,draft)){clear(scope);return false;}
  try{storage().setItem(key(scope),JSON.stringify({version:1,yaml:draft.yaml,originalYaml:draft.originalYaml,savedAt:now}));return true;}catch{return false;}
 },read:(scope:EditorDraftScope,now=Date.now()):EditorDraft|null=>{
  try{const raw=storage().getItem(key(scope));if(!raw)return null;const draft=JSON.parse(raw);if(draft.version!==1||typeof draft.yaml!=='string'||typeof draft.savedAt!=='number'||!Number.isFinite(draft.savedAt)||now-draft.savedAt>=86400000||draft.savedAt>now||!safe(scope,draft)){clear(scope);return null;}return {yaml:draft.yaml,originalYaml:draft.originalYaml,savedAt:draft.savedAt};}catch{clear(scope);return null;}
 }};
}
