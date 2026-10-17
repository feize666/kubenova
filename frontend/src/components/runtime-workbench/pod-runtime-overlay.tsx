'use client';
import dynamic from 'next/dynamic';
import { Modal } from 'antd';
const LogsWorkbench=dynamic(()=>import('./logs-workbench'),{ssr:false});
const TerminalWorkbench=dynamic(()=>import('./terminal-workbench'),{ssr:false});

export function PodRuntimeOverlay({open,mode,podName,query,onClose}:{open:boolean;mode:'logs'|'terminal';podName:string;query:URLSearchParams;onClose:()=>void}) {
  return <Modal open={open} title={`${podName} · ${mode==='logs'?'日志':'终端'}`} onCancel={onClose} footer={null} width="100vw" style={{top:0,maxWidth:'100vw',margin:0,paddingBottom:0}} styles={{container:{height:'100dvh',borderRadius:0,display:'flex',flexDirection:'column'},body:{flex:1,minHeight:0,overflow:'hidden'}}} destroyOnHidden>
    {open?(mode==='logs'?<LogsWorkbench query={query} onClose={onClose}/>:<TerminalWorkbench query={query} onClose={onClose}/>):null}
  </Modal>;
}
