'use client';
import { useRef, useState } from 'react';
import { Alert, Table, Typography } from 'antd';
import { OpsConfirmModal } from '@/components/ops/ops-confirm-modal';
import { runBatchOperation, summarizeBatchResults, type BatchOperationResult } from '@/lib/table/batch-operation';
import type { BatchDeleteTarget } from '@/lib/table/batch-targets';
export type { BatchDeleteTarget } from '@/lib/table/batch-targets';
export function BatchDeleteDialog({targets,execute,onClose,onComplete}:{targets:readonly BatchDeleteTarget[];execute:(target:BatchDeleteTarget)=>Promise<unknown>;onClose:()=>void;onComplete:(results:BatchOperationResult<BatchDeleteTarget>[])=>void}) {
  const lock=useRef(false);
  const [running,setRunning]=useState(false);
  const [completed,setCompleted]=useState(0);
  const [results,setResults]=useState<BatchOperationResult<BatchDeleteTarget>[]|null>(null);
  const summary=results?summarizeBatchResults(results):null;
  async function submit() {
    if(lock.current||!targets.length)return;
    lock.current=true;setRunning(true);
    const outcome=await runBatchOperation(targets,execute,progress=>setCompleted(progress.completed));
    setResults(outcome);setRunning(false);onComplete(outcome);
  }
  return <OpsConfirmModal open title={results?'批量删除结果':'确认批量删除 Pod'} danger loading={running}
    description={results?undefined:`将删除以下 ${targets.length} 个 Pod。操作不可撤销，请核对目标。`}
    impact={results?undefined:'受工作负载管理的 Pod 可能被控制器重新创建，不会删除上层工作负载。'}
    requiredText={results?undefined:'DELETE'} okText={results?'关闭':'确认删除'}
    onCancel={()=>{if(!running)onClose();}} onOk={results?onClose:submit}>
    {running&&<Alert type="info" title={`正在处理 ${completed}/${targets.length}，请勿重复操作`}/>}
    {summary&&<Alert showIcon type={summary.failed?'warning':'success'} title={`处理完成：成功 ${summary.succeeded}，失败 ${summary.failed}`} description={summary.failed?'失败资源仍保留选择。请核对原因，刷新资源后重新确认；不会自动重试。':undefined}/>}
    <Table size="small" pagination={false} rowKey="id" scroll={{y:320}}
      dataSource={targets.map(target=>({...target,result:results?.find(item=>item.target.id===target.id)}))}
      columns={[{title:'集群',dataIndex:'clusterId'},{title:'命名空间',dataIndex:'namespace'},{title:'资源名称',dataIndex:'name'},
        {title:'结果',render:(_,row)=>row.result?<Typography.Text type={row.result.status==='failed'?'danger':undefined}>{row.result.status==='failed'?`失败：${row.result.error}`:'成功'}</Typography.Text>:'待处理'}]}/>
  </OpsConfirmModal>;
}
