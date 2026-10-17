'use client';
import { Alert, Modal, Radio, Table } from 'antd';
import { useMemo, useState } from 'react';
import { rebaseResourceDraft, resourceChanges, type ResourceManifest } from '@/lib/resource-editor';
import styles from './resource-editor-page.module.css';

export interface ResourceComparison {original:ResourceManifest;draft:ResourceManifest;latest:ResourceManifest}
export function ResourceConflictDialog({comparison,onCancel,onResolve}:{comparison:ResourceComparison;onCancel:()=>void;onResolve:(draft:ResourceManifest)=>void}) {
  const [choices,setChoices]=useState<Record<string,'draft'|'server'>>({});
  const {original,draft,latest}=comparison;
  const resolved=useMemo(()=>rebaseResourceDraft(original,draft,latest,choices),[original,draft,latest,choices]);
  const mine=resourceChanges(original,draft);
  const live=resourceChanges(original,latest);
  const rows=resolved.conflictFields.map(field=>({
    ...field,before:mine.find(item=>item.path===field.path)?.before??'—',
    mine:mine.find(item=>item.path===field.path)?.after??'—',
    live:live.find(item=>item.path===field.path)?.after??'—',
  }));
  return <Modal open title="对比与解决版本冲突" width={960} maskClosable={false} onCancel={onCancel} onOk={()=>{if(!resolved.conflicts.length)onResolve(resolved.draft);}} okText="合并到编辑草稿" cancelText="继续编辑" okButtonProps={{disabled:resolved.conflicts.length>0}}>
    <Alert showIcon type={resolved.conflicts.length?'warning':'info'} title={resolved.conflicts.length?`还有 ${resolved.conflicts.length} 项冲突需要选择`:'可合并，服务器未被修改'} description="非冲突字段自动合并。逐项选择服务器版本或我的草稿；合并后仍需重新校验和确认提交。"/>
    <div className={styles.diff}>
      {rows.length?<Table size="small" pagination={false} rowKey="key" dataSource={rows} scroll={{x:780}} columns={[
        {title:'字段',dataIndex:'path',width:190},
        {title:'原值',dataIndex:'before',render:value=><pre>{value}</pre>},
        {title:'服务器最新值',dataIndex:'live',render:value=><pre>{value}</pre>},
        {title:'我的草稿',dataIndex:'mine',render:value=><pre>{value}</pre>},
        {title:'保留版本',width:156,render:(_,row)=><Radio.Group aria-label={`冲突选择 ${row.path}`} value={choices[row.key]} onChange={event=>setChoices(current=>({...current,[row.key]:event.target.value}))}><Radio value="server">服务器</Radio><Radio value="draft">我的草稿</Radio></Radio.Group>},
      ]}/>:live.length?<Table size="small" pagination={false} rowKey="path" dataSource={live} columns={[{title:'服务器变更字段',dataIndex:'path'},{title:'原值',dataIndex:'before'},{title:'最新值',dataIndex:'after'}]}/>:<p>服务器内容未改变。</p>}
    </div>
  </Modal>;
}
