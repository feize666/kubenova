"use client";

import { Alert, Button, Input, Space, Typography } from 'antd';
import { dump } from 'js-yaml';
import { useId, useRef, useState } from 'react';
import { commitMapRows, isRecord, parseAdvancedValue } from './native-model';
import type { MapRow } from './native-model';
import { reconcileMapState, reconcileAdvancedState } from './native-control-state';
import styles from './native-form.module.css';

export function NativeMapInput({ value, onChange, disabled = false, sensitive = false, label }: {
  value: unknown; onChange: (value: unknown) => void; disabled?: boolean; sensitive?: boolean; label: string;
}) {
  const prefix = useId();
  const counter = useRef(0);
  const makeRows = (input: unknown): MapRow[] => isRecord(input) ? Object.entries(input).map(([key, raw], index) => ({ id: `${prefix}-loaded-${index}`, key, value: typeof raw === 'string' ? raw : '' })) : [];
  const [state, setState] = useState(() => ({ source: value, rows: makeRows(value), error: '' }));
  const [revealed, setRevealed] = useState(false);
  const [published, setPublished] = useState(value);
  const [removedRows, setRemovedRows] = useState<MapRow[] | null>(null);
  const reconciled = reconcileMapState(state, value, published, makeRows);
  if (reconciled !== state) setState(reconciled);
  const malformed = value !== undefined && (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string'));
  if (malformed) return <Alert type="warning" title="当前键值不是字符串映射，已保留原值；请使用 YAML 编辑。" />;
  const change = (rows: MapRow[]) => {
    if (disabled) return;
    setRemovedRows(null);
    try {
      const next = commitMapRows(rows);
      setPublished(next);
      onChange(next);
      setState({ source: value, rows, error: '' });
    } catch (error) {
      setState({ source: value, rows, error: error instanceof Error ? error.message : '键值无效' });
    }
  };
  return <Space orientation="vertical" style={{ width: '100%' }} data-resource-editor-pending={state.error ? 'true' : undefined}>
    {sensitive && <Space>
      <Typography.Text type="secondary">{state.rows.length} 个敏感键；默认不展示内容</Typography.Text>
      <Button disabled={disabled} onClick={() => { if (!disabled) setRevealed(!revealed); }}>{revealed ? '隐藏内容' : '显示并编辑'}</Button>
    </Space>}
    {(!sensitive || revealed) && <>
      {!state.rows.length && <Typography.Text type="secondary">尚无键值，可新增；空值与换行会原样保留。</Typography.Text>}
      {state.rows.map(row => <div key={row.id} className={styles.row}>
        <Input aria-label={`${label} 键名`} autoComplete="off" disabled={disabled} value={row.key} placeholder="键名" onChange={event => change(state.rows.map(item => item.id === row.id ? { ...item, key: event.target.value } : item))} />
        <Input.TextArea aria-label={`${label} ${row.key} 值`} autoComplete="off" disabled={disabled} value={row.value} placeholder="值（允许空值与多行）" autoSize={{ minRows: 1, maxRows: 8 }} onChange={event => change(state.rows.map(item => item.id === row.id ? { ...item, value: event.target.value } : item))} />
        <Button danger disabled={disabled} aria-label={`删除 ${label} ${row.key}`} onClick={() => { const before = state.rows; change(before.filter(item => item.id !== row.id)); setRemovedRows(before); }}>删除</Button>
      </div>)}
      <Button disabled={disabled} onClick={() => { if (!disabled) setState(current => ({ ...current, rows: [...current.rows, { id: `${prefix}-${++counter.current}`, key: '', value: '' }], error: '新键填写完成后自动应用；重复键不会覆盖已有数据。' })); }}>新增键值</Button>
      {removedRows && <Button disabled={disabled} onClick={() => change(removedRows)}>撤销删除</Button>}
    </>}
    {state.error && <Alert type="warning" title={state.error} />}
  </Space>;
}

export function NativeAdvancedInput({ value, onChange, type, disabled = false, label }: {
  value: unknown; onChange: (value: unknown) => void; type: 'object' | 'array'; disabled?: boolean; label: string;
}) {
  const serialize = (raw: unknown) => raw === undefined ? '' : dump(raw, { noRefs: true, lineWidth: -1 });
  const [state, setState] = useState(() => ({ source: value, text: serialize(value), dirty: false, error: '' }));
  const reconciled = reconcileAdvancedState(state, value, serialize);
  if (reconciled !== state) setState(reconciled);
  return <Space orientation="vertical" style={{ width: '100%' }} data-resource-editor-pending={state.dirty ? 'true' : undefined}>
    <Input.TextArea aria-label={`${label} YAML`} disabled={disabled} value={state.text} autoSize={{ minRows: 3, maxRows: 14 }} onChange={event => {
      if (disabled) return;
      let error = '';
      try { parseAdvancedValue(event.target.value, type); } catch (reason) { error = reason instanceof Error ? reason.message : 'YAML 无效'; }
      setState({ ...state, text: event.target.value, dirty: true, error });
    }} />
    <Space>
      <Button disabled={disabled || !state.dirty || Boolean(state.error)} onClick={() => {
        if (disabled) return;
        try { onChange(parseAdvancedValue(state.text, type)); setState(current => ({ ...current, dirty: false, error: '' })); }
        catch (reason) { setState(current => ({ ...current, error: reason instanceof Error ? reason.message : 'YAML 无效' })); }
      }}>应用 YAML</Button>
      <Button disabled={disabled || !state.dirty} onClick={() => { if (!disabled) setState({ source: value, text: serialize(value), dirty: false, error: '' }); }}>放弃草稿</Button>
      {state.dirty && <Typography.Text type="warning">尚未应用，主清单仍保留原值</Typography.Text>}
    </Space>
    {state.error && <Alert type="error" title="YAML 尚未应用" description={state.error} />}
  </Space>;
}
