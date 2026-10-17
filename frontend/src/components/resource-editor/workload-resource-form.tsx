"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Tabs, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api/client";
import { getStorageResources } from "@/lib/api/storage";
import styles from "./resource-editor-page.module.css";
import type { ResourceFormProps } from "@/lib/resource-editor";
import {
  ACTION_TYPES, ENV_SOURCES, VOLUME_TYPES, createWorkloadEditor, moveWorkloadItem,
  parseAdvancedWorkloadObject, parseWorkloadPort, renameWorkloadKey, switchAction,
  switchEnvFrom, switchEnvSource, switchVolume, workloadList, workloadObject,
  switchSeccomp, switchToleration, copyWorkloadContainer,
  workloadPodPath, type WorkloadEditor, type WorkloadPath,
} from "./workload-fields";

type FieldProps = { editor: WorkloadEditor; path: WorkloadPath; label: string };
const text = (value: unknown) => value == null ? "" : String(value);
const ReferenceContext = createContext<{clusterId?: string; token?: string; namespace?: string}>({});

function ReferenceField({editor, path, label, kind}: FieldProps & {kind: "Secret" | "ConfigMap" | "PVC"}) {
  const {clusterId, token, namespace} = useContext(ReferenceContext);
  const query = useQuery({queryKey: ["editor-reference", clusterId, namespace, kind, token], enabled: !!clusterId && !!token && !!namespace,
    queryFn: async () => {
      if(kind !== "PVC") {
        const response = await apiRequest<{items: Array<{name: string; type?: string; keys: string[]}>}>("/api/resources/editor/config-references", {query: {clusterId, namespace, kind}, token});
        return response.items;
      }
      const items: Array<{name: string; keys: string[]}> = [];
      let page = 1;
      let total = Infinity;
      while (items.length < total) {
        const response = await getStorageResources({clusterId, namespace, kind: "PVC", page, pageSize: 200}, token);
        items.push(...response.items.map(item => ({name: item.name, keys: [] as string[]})));
        total = response.total;
        if (!response.items.length) break;
        page++;
      }
      return items;
    }, retry: false});
  const current = text(editor.read(path));
  const available = (query.data ?? []).map(item=>item.name);
  const missing = !!current && !!query.data && !available.includes(current);
  return <Form.Item label={label} extra={editor.reason(path) || query.error?.message || (missing ? "已有引用当前不可读取，保留原值。" : undefined)}>
    <Select aria-label={label} showSearch allowClear loading={query.isFetching} value={current || undefined} disabled={!!editor.reason(path)}
      options={[...available, ...(current && !available.includes(current) ? [current] : [])].map(value => ({value, label: value + (value === current && missing ? "（已有引用）" : "")}))}
      onChange={next => editor.write(path, next)} notFoundContent={query.error ? "无法读取资源列表" : "当前命名空间暂无资源"}/>
  </Form.Item>;
}

function ReferenceKeyField({editor, path, label, kind, namePath}: FieldProps & {kind: "Secret" | "ConfigMap"; namePath: WorkloadPath}) {
  const {clusterId, token, namespace} = useContext(ReferenceContext);
  const query = useQuery({queryKey: ["editor-reference", clusterId, namespace, kind, token], enabled: !!clusterId && !!token && !!namespace,
    queryFn: () => apiRequest<{items: Array<{name: string; keys: string[]}>}>("/api/resources/editor/config-references", {query: {clusterId, namespace, kind}, token}).then(response=>response.items), retry: false});
  const current = text(editor.read(path));
  const keys = query.data?.find(item=>item.name === editor.read(namePath))?.keys ?? [];
  const missing = !!current && !keys.includes(current);
  return <Form.Item label={label} extra={query.error?.message || (missing ? "保留已有 key，请确认引用资源仍提供此键。" : undefined)}>
    <Select aria-label={label} showSearch allowClear value={current || undefined} loading={query.isFetching} disabled={!!editor.reason(path)}
      options={[...keys, ...(missing ? [current] : [])].map(value=>({value,label:value}))} onChange={next=>editor.write(path,next)}/>
  </Form.Item>;
}

function AdvancedSection({title, children}: {title: string; children: ReactNode}) {
  return <details className={styles.advanced}><summary>{title}</summary><div className={styles.advancedBody}>{children}</div></details>;
}

function Field({ editor, path, label, kind = "text", options, min = 0, preserveEmpty = false }: FieldProps & {
  kind?: "text" | "number" | "boolean" | "port"; options?: string[]; min?: number; preserveEmpty?: boolean;
}) {
  const value = editor.read(path);
  const reason = editor.reason(path);
  let control: ReactNode;
  if (options) control = <Select aria-label={label} value={typeof value === "string" ? value : undefined}
    allowClear options={options.map(value => ({ value, label: value }))} disabled={!!reason}
    onChange={next => editor.write(path, next)} />;
  else if (kind === "number") control = <InputNumber aria-label={label} min={min} precision={0}
    value={typeof value === "number" ? value : null} disabled={!!reason} style={{ width: "100%" }}
    onChange={next => editor.write(path, next ?? undefined)} />;
  else if (kind === "boolean") control = <Select aria-label={label} value={typeof value === "boolean" ? value : undefined}
    allowClear disabled={!!reason} options={[{ value: true, label: "是" }, { value: false, label: "否" }]}
    onChange={next => editor.write(path, next)} />;
  else control = <Input aria-label={label} value={text(value)} disabled={!!reason}
    onChange={event => editor.write(path, kind === "port" ? parseWorkloadPort(event.target.value) : event.target.value || (preserveEmpty ? "" : undefined))} />;
  return <Form.Item label={label} extra={reason} data-editor-field={path.join(".")}>{control}</Form.Item>;
}

function Items({ editor, path, label, create, children }: FieldProps & {
  create: () => unknown; children: (path: WorkloadPath, index: number) => ReactNode;
}) {
  const items = workloadList(editor.read(path));
  // Preserve component/draft identity during array moves and immutable item edits.
  const identities = useRef<{ item: unknown; id: number }[]>([]);
  const counter = useRef(0);
  const previous = identities.current;
  const used = new Set<number>();
  const matched = items.map(item => {
    const match = previous.find(entry => entry.item === item && !used.has(entry.id));
    if (match) used.add(match.id);
    return match;
  });
  const current = items.map((item, index) => {
    const old = matched[index] ?? (previous[index] && !used.has(previous[index].id) ? previous[index] : undefined);
    if (old) used.add(old.id);
    return { item, id: old?.id ?? ++counter.current };
  });
  identities.current = current;
  const reason = editor.reason(path);
  const [removed, setRemoved] = useState<{index: number; item: unknown} | null>(null);
  return <Card size="small" title={label} style={{ marginBottom: 16 }}>
    {reason && <Typography.Paragraph type="secondary">{reason}</Typography.Paragraph>}
    {items.map((_, index) => <Card size="small" key={current[index].id} title={`${label} ${index + 1}`} style={{ marginBottom: 12 }}
      extra={<Space>
        <Button aria-label={`${label} ${index + 1} 上移`} disabled={!!reason || index === 0}
          onClick={() => editor.update(path, old => moveWorkloadItem(old, index, -1))}>上移</Button>
        <Button aria-label={`${label} ${index + 1} 下移`} disabled={!!reason || index === items.length - 1}
          onClick={() => editor.update(path, old => moveWorkloadItem(old, index, 1))}>下移</Button>
        <Button danger aria-label={`${label} ${index + 1} 删除`} disabled={!!reason}
          onClick={() => {setRemoved({index, item: items[index]}); editor.write([...path, index], undefined);}}>删除</Button>
      </Space>}>{children([...path, index], index)}</Card>)}
    <Button disabled={!!reason} onClick={() => editor.update(path, old => [...workloadList(old), create()])}>添加{label}</Button>
    {removed && <Button disabled={!!reason} onClick={() => {editor.update(path, old => {const next = [...workloadList(old)]; next.splice(Math.min(removed.index, next.length), 0, removed.item); return next;}); setRemoved(null);}}>撤销删除</Button>}
  </Card>;
}

function Strings(props: FieldProps) {
  return <Items {...props} create={() => ""}>{(path, index) =>
    <Field editor={props.editor} path={path} label={`${props.label} ${index + 1} 值`} preserveEmpty />}</Items>;
}

function MapFields({ editor, path, label }: FieldProps) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const entries = Object.entries(workloadObject(editor.read(path)));
  const reason = editor.reason(path);
  return <Card data-resource-editor-pending={pending || !!error ? "true" : undefined} size="small" title={label} style={{ marginBottom: 16 }}>
    {reason && <Typography.Paragraph type="secondary">{reason}</Typography.Paragraph>}
    {error && <Alert type="error" title={error} />}
    {entries.map(([key]) => <Space key={key} align="start" wrap>
      <Input aria-label={`${label} 键 ${key}`} defaultValue={key} disabled={!!reason}
        onChange={() => setPending(true)}
        onBlur={event => {
          try { editor.update(path, old => renameWorkloadKey(old, key, event.target.value)); setError(""); setPending(false); }
          catch (failure) { setError((failure as Error).message); }
        }} />
      <Field editor={editor} path={[...path, key]} label={`${label} 值 ${key}`} />
      <Button danger disabled={!!reason} onClick={() => { editor.write([...path, key], undefined); setError(""); setPending(false); }}>删除 {key}</Button>
    </Space>)}
    <Button disabled={!!reason} onClick={() => {
      let key = "key";
      while (Object.hasOwn(workloadObject(editor.read(path)), key)) key += "-new";
      editor.write([...path, key], "");
    }}>添加{label}</Button>
  </Card>;
}

function Advanced({ editor, path, label }: FieldProps) {
  const source = JSON.stringify(editor.read(path) ?? {}, null, 2);
  const [buffer, setBuffer] = useState<string | null>(null);
  const [error, setError] = useState("");
  return <Card data-resource-editor-pending={buffer !== null || !!error ? "true" : undefined} size="small" title={label} style={{ marginBottom: 16 }}>
    <Typography.Paragraph type="secondary">高级 JSON 草稿；只有点击“应用此配置”后才写入资源。未应用文本不会提交。</Typography.Paragraph>
    <Input.TextArea aria-label={label} rows={6} disabled={!!editor.reason(path)} value={buffer ?? source}
      onChange={event => { setBuffer(event.target.value); setError(""); }} />
    {error && <Alert type="error" title={error} />}
    {buffer !== null && <Alert type="warning" title="存在未应用的配置草稿" />}
    <Space><Button disabled={!!editor.reason(path) || buffer === null} onClick={() => {
      try { editor.write(path, parseAdvancedWorkloadObject(buffer ?? source)); setBuffer(null); setError(""); }
      catch (failure) { setError((failure as Error).message); }
    }}>应用此配置</Button>
      <Button disabled={!!editor.reason(path) || buffer === null} onClick={() => { setBuffer(null); setError(""); }}>放弃草稿</Button></Space>
  </Card>;
}

function Action({ editor, path, label, lifecycle = false }: FieldProps & { lifecycle?: boolean }) {
  const object = workloadObject(editor.read(path));
  const type = ACTION_TYPES.find(key => object[key] !== undefined);
  const choices = lifecycle ? ["exec", "httpGet", "tcpSocket", "sleep"] : ["httpGet", "tcpSocket", "exec", "grpc"];
  const detail = [...path, type ?? "httpGet"];
  return <Card size="small" title={label} style={{ marginBottom: 16 }}>
    <Form.Item label={`${label} 类型`} extra={editor.reason(path)}>
      <Select aria-label={`${label} 类型`} disabled={!!editor.reason(path)} value={type} allowClear
        options={choices.map(value => ({ value, label: value }))}
        onChange={next => editor.update(path, old => switchAction(old, next ?? ""))} />
    </Form.Item>
    {type === "exec" && <Strings editor={editor} path={[...detail, "command"]} label={`${label} 命令参数`} />}
    {(type === "httpGet" || type === "tcpSocket" || type === "grpc") &&
      <Field editor={editor} path={[...detail, "port"]} label={`${label} 端口`} kind={type === "grpc" ? "number" : "port"} min={1} />}
    {type === "grpc" && <Field editor={editor} path={[...detail, "service"]} label="gRPC 服务" />}
    {type === "sleep" && <Field editor={editor} path={[...detail, "seconds"]} label="等待秒数" kind="number" />}
    {(type === "httpGet" || type === "tcpSocket") && <Field editor={editor} path={[...detail, "host"]} label={`${label} 主机`} />}
    {type === "httpGet" && <>
      <Field editor={editor} path={[...detail, "path"]} label={`${label} 路径`} />
      <Field editor={editor} path={[...detail, "scheme"]} label={`${label} 协议`} options={["HTTP", "HTTPS"]} />
      <Items editor={editor} path={[...detail, "httpHeaders"]} label="HTTP 请求头" create={() => ({ name: "", value: "" })}>
        {row => <><Field editor={editor} path={[...row, "name"]} label="请求头名称" /><Field editor={editor} path={[...row, "value"]} label="请求头值" /></>}
      </Items>
    </>}
    {type && !lifecycle && ["initialDelaySeconds", "periodSeconds", "timeoutSeconds", "successThreshold", "failureThreshold", "terminationGracePeriodSeconds"].map(key =>
      <Field key={key} editor={editor} path={[...path, key]} label={`${label} ${key}`} kind="number" />)}
  </Card>;
}

function Security({ editor, path, label, pod = false }: FieldProps & { pod?: boolean }) {
  return <Card size="small" title={label} style={{ marginBottom: 16 }}>
    {["runAsUser", "runAsGroup", ...(pod ? ["fsGroup"] : [])].map(key =>
      <Field key={key} editor={editor} path={[...path, key]} label={`${label} ${key}`} kind="number" />)}
    {["runAsNonRoot", ...(!pod ? ["privileged", "allowPrivilegeEscalation", "readOnlyRootFilesystem"] : [])].map(key =>
      <Field key={key} editor={editor} path={[...path, key]} label={`${label} ${key}`} kind="boolean" />)}
    <Form.Item label="Seccomp 类型"><Select aria-label="Seccomp 类型" allowClear disabled={!!editor.reason(path)}
      value={workloadObject(editor.read([...path, "seccompProfile"])).type as string | undefined}
      options={["RuntimeDefault", "Localhost", "Unconfined"].map(value => ({ value, label: value }))}
      onChange={type => editor.update([...path, "seccompProfile"], old => switchSeccomp(old, type ?? ""))} /></Form.Item>
    {workloadObject(editor.read([...path, "seccompProfile"])).type === "Localhost" &&
      <Field editor={editor} path={[...path, "seccompProfile", "localhostProfile"]} label="Seccomp 本地配置路径" />}
    {!pod && <><Strings editor={editor} path={[...path, "capabilities", "add"]} label="添加权限能力" />
      <Strings editor={editor} path={[...path, "capabilities", "drop"]} label="移除权限能力" /></>}
  </Card>;
}

function Container({ editor, path }: { editor: WorkloadEditor; path: WorkloadPath }) {
  return <>
    <Field editor={editor} path={[...path, "name"]} label="容器名称" />
    <Field editor={editor} path={[...path, "image"]} label="镜像" />
    <Field editor={editor} path={[...path, "imagePullPolicy"]} label="镜像拉取策略" options={["Always", "IfNotPresent", "Never"]} />
    <AdvancedSection title="启动命令与参数"><Strings editor={editor} path={[...path, "command"]} label="启动命令（每项一个参数）" />
    <Strings editor={editor} path={[...path, "args"]} label="命令参数（保留空格）" /></AdvancedSection>
    <Items editor={editor} path={[...path, "ports"]} label="容器端口" create={() => ({ containerPort: 8080, protocol: "TCP" })}>
      {row => <><Field editor={editor} path={[...row, "name"]} label="端口名称" />
        <Field editor={editor} path={[...row, "containerPort"]} label="容器端口号" kind="number" min={1} />
        <Field editor={editor} path={[...row, "hostPort"]} label="主机端口号" kind="number" min={1} />
        <Field editor={editor} path={[...row, "hostIP"]} label="主机 IP" />
        <Field editor={editor} path={[...row, "protocol"]} label="端口协议" options={["TCP", "UDP", "SCTP"]} /></>}
    </Items>
    <Items editor={editor} path={[...path, "env"]} label="环境变量" create={() => ({ name: "", value: "" })}>
      {row => {
        const env = workloadObject(editor.read(row));
        const source = ENV_SOURCES.find(key => workloadObject(env.valueFrom)[key] !== undefined) ?? "value";
        const ref = [...row, "valueFrom", source];
        return <><Field editor={editor} path={[...row, "name"]} label="变量名称" />
          <Form.Item label="变量来源"><Select aria-label="变量来源" disabled={!!editor.reason(row)} value={source}
            options={["value", ...ENV_SOURCES].map(value => ({ value, label: value }))}
            onChange={next => editor.update(row, old => switchEnvSource(old, next))} /></Form.Item>
          {source === "value" ? <Field editor={editor} path={[...row, "value"]} label="变量值" preserveEmpty /> : <>
            {(source === "secretKeyRef" || source === "configMapKeyRef") && <>
              <ReferenceField editor={editor} path={[...ref, "name"]} label="引用资源名称" kind={source === "secretKeyRef" ? "Secret" : "ConfigMap"}/>
              <ReferenceKeyField editor={editor} path={[...ref, "key"]} namePath={[...ref, "name"]} label="引用键" kind={source === "secretKeyRef" ? "Secret" : "ConfigMap"}/>
              <Field editor={editor} path={[...ref, "optional"]} label="引用可选" kind="boolean" /></>}
            {source === "fieldRef" && <Field editor={editor} path={[...ref, "fieldPath"]} label="字段路径" />}
            {source === "resourceFieldRef" && <><Field editor={editor} path={[...ref, "resource"]} label="资源字段" />
              <Field editor={editor} path={[...ref, "containerName"]} label="引用容器名称" />
              <Field editor={editor} path={[...ref, "divisor"]} label="资源除数" /></>}
          </>}</>;
      }}
    </Items>
    <Items editor={editor} path={[...path, "envFrom"]} label="环境变量批量引用" create={() => ({ configMapRef: { name: "" } })}>
      {row => {
        const source = workloadObject(editor.read(row)).secretRef ? "secretRef" : "configMapRef";
        return <><Field editor={editor} path={[...row, "prefix"]} label="变量名前缀" />
          <Form.Item label="批量引用类型"><Select aria-label="批量引用类型" disabled={!!editor.reason(row)} value={source}
            options={["configMapRef", "secretRef"].map(value => ({ value, label: value }))}
            onChange={next => editor.update(row, old => switchEnvFrom(old, next))} /></Form.Item>
          <ReferenceField editor={editor} path={[...row, source, "name"]} label="批量引用名称" kind={source === "secretRef" ? "Secret" : "ConfigMap"}/>
          <Field editor={editor} path={[...row, source, "optional"]} label="批量引用可选" kind="boolean" /></>;
      }}
    </Items>
    <Card size="small" title="资源配额（CPU 如 250m，内存如 256Mi）" style={{ marginBottom: 16 }}>
      {["requests", "limits"].map(bound => ["cpu", "memory", "ephemeral-storage"].map(key =>
        <Field key={`${bound}-${key}`} editor={editor} path={[...path, "resources", bound, key]} label={`${bound} ${key}`} />))}
    </Card>
    <AdvancedSection title="健康检查">{[["livenessProbe", "存活探针"], ["readinessProbe", "就绪探针"], ["startupProbe", "启动探针"]].map(([key, label]) =>
      <Action key={key} editor={editor} path={[...path, key]} label={label} />)}</AdvancedSection>
    <Items editor={editor} path={[...path, "volumeMounts"]} label="卷挂载" create={() => ({ name: "", mountPath: "" })}>
      {row => <>{[["name", "卷名称"], ["mountPath", "挂载路径"], ["subPath", "卷子路径"], ["subPathExpr", "卷子路径表达式"]].map(([key, label]) =>
        <Field key={key} editor={editor} path={[...row, key]} label={label} />)}
        <Field editor={editor} path={[...row, "readOnly"]} label="只读挂载" kind="boolean" />
        <Field editor={editor} path={[...row, "mountPropagation"]} label="挂载传播" options={["None", "HostToContainer", "Bidirectional"]} /></>}
    </Items>
    <AdvancedSection title="生命周期与安全配置"><Action editor={editor} path={[...path, "lifecycle", "postStart"]} label="启动后钩子" lifecycle />
    <Action editor={editor} path={[...path, "lifecycle", "preStop"]} label="停止前钩子" lifecycle />
    <Security editor={editor} path={[...path, "securityContext"]} label="容器安全上下文" /></AdvancedSection>
  </>;
}

function Volumes({ editor, path }: { editor: WorkloadEditor; path: WorkloadPath }) {
  return <Items editor={editor} path={path} label="存储卷" create={() => ({ name: "", emptyDir: {} })}>
    {row => {
      const volume = workloadObject(editor.read(row));
      const type = VOLUME_TYPES.find(key => volume[key] !== undefined) ?? "emptyDir";
      const detail = [...row, type];
      return <><Field editor={editor} path={[...row, "name"]} label="卷名称" />
        <Form.Item label="卷类型"><Select aria-label="卷类型" disabled={!!editor.reason(row)} value={type}
          options={VOLUME_TYPES.map(value => ({ value, label: value }))}
          onChange={next => editor.update(row, old => switchVolume(old, next))} /></Form.Item>
        {type === "emptyDir" && <><Field editor={editor} path={[...detail, "medium"]} label="临时卷介质" options={["", "Memory"]} />
          <Field editor={editor} path={[...detail, "sizeLimit"]} label="临时卷容量上限" /></>}
        {["configMap", "secret", "persistentVolumeClaim"].includes(type) &&
          <ReferenceField editor={editor} path={[...detail, type === "secret" ? "secretName" : type === "persistentVolumeClaim" ? "claimName" : "name"]} label="引用资源名称" kind={type === "secret" ? "Secret" : type === "persistentVolumeClaim" ? "PVC" : "ConfigMap"}/>}
        {["configMap", "secret"].includes(type) && <>
          <Field editor={editor} path={[...detail, "optional"]} label="可选卷" kind="boolean" />
          <Field editor={editor} path={[...detail, "defaultMode"]} label="默认权限（十进制，如 420）" kind="number" />
          <Items editor={editor} path={[...detail, "items"]} label="卷文件映射" create={() => ({ key: "", path: "" })}>
            {item => <><Field editor={editor} path={[...item, "key"]} label="源键" /><Field editor={editor} path={[...item, "path"]} label="文件路径" />
              <Field editor={editor} path={[...item, "mode"]} label="文件权限（十进制）" kind="number" /></>}
          </Items></>}
        {["persistentVolumeClaim", "nfs"].includes(type) && <Field editor={editor} path={[...detail, "readOnly"]} label="卷只读" kind="boolean" />}
        {["hostPath", "nfs"].includes(type) && <Field editor={editor} path={[...detail, "path"]} label="卷路径" />}
        {type === "nfs" && <Field editor={editor} path={[...detail, "server"]} label="NFS 服务器" />}
        {type === "hostPath" && <Field editor={editor} path={[...detail, "type"]} label="主机路径类型" options={["", "DirectoryOrCreate", "Directory", "FileOrCreate", "File", "Socket", "CharDevice", "BlockDevice"]} />}
        {!["emptyDir", "configMap", "secret", "persistentVolumeClaim", "hostPath", "nfs"].includes(type) &&
          <Advanced key={type} editor={editor} path={detail} label={`${type} 高级卷配置`} />}
      </>;
    }}
  </Items>;
}

function ContainerTabs({editor, pod}: {editor: WorkloadEditor; pod: WorkloadPath}) {
  const [active, setActive] = useState<string>();
  const identities = useRef<Array<{item: unknown; id: string; kind: string}>>([]);
  const counter = useRef(0);
  const used = new Set<string>();
  const rows = ["containers", "initContainers"].flatMap(kind => workloadList(editor.read([...pod, kind])).map((item, index) => ({kind, item, index})));
  const identified = rows.map(row => {
    let prior = identities.current.find(entry => entry.kind === row.kind && entry.item === row.item && !used.has(entry.id));
    if (prior) used.add(prior.id);
    return {...row, id: prior?.id};
  }).map((row, position) => {
    const fallback = identities.current[position];
    const id = row.id ?? (fallback?.kind === row.kind && !used.has(fallback.id) ? fallback.id : `container-${++counter.current}`);
    used.add(id);
    return {...row, id};
  });
  identities.current = identified;
  const current = identified.find(row => row.id === active) ?? identified[0];
  function add(kind: string) {
    const path = [...pod, kind];
    const names = new Set(rows.map(row => workloadObject(row.item).name));
    let name = kind === "containers" ? "container" : "init";
    while (names.has(name)) name += "-new";
    editor.update(path, old => [...workloadList(old), {name, image: ""}]);
    setActive(undefined);
  }
  return <div className={styles.containers}>
    <div className={styles.header}><Typography.Title level={5}>容器配置</Typography.Title><Space wrap>
      <Button disabled={!!editor.reason([...pod, "containers"])} onClick={() => add("containers")}>添加运行容器</Button>
      <Button disabled={!!editor.reason([...pod, "initContainers"])} onClick={() => add("initContainers")}>添加 Init 容器</Button>
    </Space></div>
    <Tabs activeKey={current?.id} onChange={setActive} items={identified.map(row => {
      const container = workloadObject(row.item);
      const path = [...pod, row.kind, row.index];
      const error = !container.name || !container.image;
      return {key: row.id, forceRender: true, label: <Space size={6}>{row.kind === "initContainers" && <Tag>Init</Tag>}{text(container.name) || "未命名容器"}{error && <Tag color="error">待完善</Tag>}</Space>,
        children: <div><div className={styles.containerActions}><Button disabled={!!editor.reason([...pod, row.kind])} onClick={() => editor.update([...pod, row.kind], old => copyWorkloadContainer(old, row.index))}>复制容器</Button>
          <Button danger disabled={!!editor.reason([...pod, row.kind]) || row.kind === "containers" && workloadList(editor.read([...pod, "containers"])).length <= 1}
            onClick={() => Modal.confirm({title: "删除容器配置", content: `删除 ${text(container.name) || "未命名容器"} 的全部配置？`, okText: "删除容器", cancelText: "取消", okButtonProps: {danger: true}, autoFocusButton: "cancel", onOk: () => editor.write(path, undefined)})}>删除容器</Button></div>
          <Container editor={editor} path={path}/></div>};
    })}/>
    {!rows.length && <Alert type="warning" title="至少需要一个运行容器"/>}
  </div>;
}

export function WorkloadResourceForm({ value, onChange, mode, disabled = false, step = 0, clusterId, token, lockContext = false }: ResourceFormProps & {clusterId?: string; token?: string; lockContext?: boolean}) {
  if (!["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "Pod"].includes(value.kind)) return null;
  const editor = createWorkloadEditor(value, onChange, mode, disabled);
  const pod = workloadPodPath(value.kind);
  const template = pod.slice(0, -1);
  const job = value.kind === "CronJob" ? ["spec", "jobTemplate", "spec"] : ["spec"];
  const isJob = ["Job", "CronJob"].includes(value.kind);
  const contextEditor = lockContext ? {...editor, reason: (path: WorkloadPath) => path[0] === "metadata" && path[1] === "namespace" ? "由当前访问资源上下文指定。" : editor.reason(path)} : editor;
  return <ReferenceContext.Provider value={{clusterId, token, namespace: value.metadata.namespace}}><Form layout="horizontal" className={styles.workloadForm} colon={false}>
    {step === 0 && <>
      <Field editor={contextEditor} path={["metadata", "name"]} label="资源名称" />
      <Field editor={contextEditor} path={["metadata", "namespace"]} label="命名空间" />
      <MapFields editor={editor} path={["metadata", "labels"]} label="资源标签" />
      <MapFields editor={editor} path={["metadata", "annotations"]} label="资源注解" />
      {["Deployment", "StatefulSet", "ReplicaSet"].includes(value.kind) && <Field editor={editor} path={["spec", "replicas"]} label="副本数" kind="number" />}
      {value.kind !== "Pod" && <MapFields editor={editor} path={[...template, "metadata", "labels"]} label="Pod 模板标签" />}
      {["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet"].includes(value.kind) && <>
        <Alert type="info" title="选择器必须匹配 Pod 模板标签；编辑时选择器不可修改。" />
        <MapFields editor={editor} path={["spec", "selector", "matchLabels"]} label="选择器标签" />
      </>}
      {value.kind === "StatefulSet" && <Field editor={editor} path={["spec", "serviceName"]} label="无头 Service 名称" />}
      {value.kind === "CronJob" && <>
        <Field editor={editor} path={["spec", "schedule"]} label="Cron 调度表达式" />
        <Field editor={editor} path={["spec", "timeZone"]} label="调度时区" />
        <Field editor={editor} path={["spec", "concurrencyPolicy"]} label="并发策略" options={["Allow", "Forbid", "Replace"]} />
        <Field editor={editor} path={["spec", "suspend"]} label="暂停调度" kind="boolean" />
        {["startingDeadlineSeconds", "successfulJobsHistoryLimit", "failedJobsHistoryLimit"].map(key =>
          <Field key={key} editor={editor} path={["spec", key]} label={`CronJob ${key}`} kind="number" />)}
      </>}
      {isJob && <>
        {["completions", "parallelism", "backoffLimit", "activeDeadlineSeconds", "ttlSecondsAfterFinished"].map(key =>
          <Field key={key} editor={editor} path={[...job, key]} label={`Job ${key}`} kind="number" />)}
        <Field editor={editor} path={[...job, "completionMode"]} label="完成模式" options={["NonIndexed", "Indexed"]} />
        <Field editor={editor} path={[...job, "suspend"]} label="暂停 Job" kind="boolean" />
      </>}
    </>}
    {step === 1 && <ContainerTabs editor={editor} pod={pod}/>}
    {step === 2 && <>
      <Volumes editor={editor} path={[...pod, "volumes"]} />
      <Field editor={editor} path={[...pod, "serviceAccountName"]} label="服务账号" />
      <Field editor={editor} path={[...pod, "automountServiceAccountToken"]} label="自动挂载服务账号令牌" kind="boolean" />
      <Items editor={editor} path={[...pod, "imagePullSecrets"]} label="镜像拉取 Secret" create={() => ({ name: "" })}>
        {path => <ReferenceField editor={editor} path={[...path, "name"]} label="Secret 名称" kind="Secret"/>}</Items>
      <MapFields editor={editor} path={[...pod, "nodeSelector"]} label="节点选择器" />
      <Advanced editor={editor} path={[...pod, "affinity"]} label="高级亲和性" />
      <Items editor={editor} path={[...pod, "tolerations"]} label="污点容忍" create={() => ({ key: "", operator: "Equal", value: "", effect: "NoSchedule" })}>
        {path => <><Field editor={editor} path={[...path, "key"]} label="污点键" />
          <Form.Item label="容忍运算符"><Select aria-label="容忍运算符" disabled={!!editor.reason(path)}
            value={text(workloadObject(editor.read(path)).operator) || "Equal"}
            options={["Equal", "Exists"].map(value => ({ value, label: value }))}
            onChange={operator => editor.update(path, old => switchToleration(old, operator))} /></Form.Item>
          {workloadObject(editor.read(path)).operator !== "Exists" && <Field editor={editor} path={[...path, "value"]} label="污点值" preserveEmpty />}
          <Field editor={editor} path={[...path, "effect"]} label="污点效果" options={["NoSchedule", "PreferNoSchedule", "NoExecute"]} />
          <Field editor={editor} path={[...path, "tolerationSeconds"]} label="容忍秒数" kind="number" /></>}
      </Items>
      <Security editor={editor} path={[...pod, "securityContext"]} label="Pod 安全上下文" pod />
      <Field editor={editor} path={[...pod, "restartPolicy"]} label="重启策略" options={isJob ? ["Never", "OnFailure"] : value.kind === "Pod" ? ["Always", "Never", "OnFailure"] : ["Always"]} />
      <Field editor={editor} path={[...pod, "terminationGracePeriodSeconds"]} label="优雅终止秒数" kind="number" />
      <Field editor={editor} path={[...pod, "nodeName"]} label="指定节点" />
      <Field editor={editor} path={[...pod, "priorityClassName"]} label="优先级类" />
      <Field editor={editor} path={[...pod, "hostNetwork"]} label="使用主机网络" kind="boolean" />
      <Field editor={editor} path={[...pod, "dnsPolicy"]} label="DNS 策略" options={["ClusterFirst", "ClusterFirstWithHostNet", "Default", "None"]} />
      {["Deployment", "StatefulSet", "DaemonSet"].includes(value.kind) && <Strategy editor={editor} kind={value.kind} />}
      {value.kind === "StatefulSet" && <>
        <Field editor={editor} path={["spec", "podManagementPolicy"]} label="Pod 管理策略" options={["OrderedReady", "Parallel"]} />
        <Items editor={editor} path={["spec", "volumeClaimTemplates"]} label="卷声明模板" create={() => ({ metadata: { name: "data" }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "1Gi" } } } })}>
          {path => <><Field editor={editor} path={[...path, "metadata", "name"]} label="卷声明名称" />
            <Field editor={editor} path={[...path, "spec", "storageClassName"]} label="存储类" />
            <Strings editor={editor} path={[...path, "spec", "accessModes"]} label="访问模式" />
            <Field editor={editor} path={[...path, "spec", "resources", "requests", "storage"]} label="存储容量（如 10Gi）" />
            <Field editor={editor} path={[...path, "spec", "volumeMode"]} label="卷模式" options={["Filesystem", "Block"]} /></>}
        </Items>
      </>}
    </>}
  </Form></ReferenceContext.Provider>;
}

function Strategy({ editor, kind }: { editor: WorkloadEditor; kind: string }) {
  const path = ["spec", kind === "Deployment" ? "strategy" : "updateStrategy"];
  const value = workloadObject(editor.read(path));
  return <Card title="更新策略" size="small" style={{ marginBottom: 16 }}>
    <Form.Item label="更新策略类型"><Select aria-label="更新策略类型" disabled={!!editor.reason(path)} value={text(value.type) || "RollingUpdate"}
      options={["RollingUpdate", kind === "Deployment" ? "Recreate" : "OnDelete"].map(value => ({ value, label: value }))}
      onChange={type => editor.update(path, old => {
        const next = { ...workloadObject(old), type };
        if (type !== "RollingUpdate") delete (next as Record<string, unknown>).rollingUpdate;
        return next;
      })} /></Form.Item>
    {(!value.type || value.type === "RollingUpdate") && <>
      {kind !== "StatefulSet" && <Field editor={editor} path={[...path, "rollingUpdate", "maxSurge"]} label="最大额外副本（数量或百分比）" kind="port" />}
      <Field editor={editor} path={[...path, "rollingUpdate", "maxUnavailable"]} label="最大不可用副本（数量或百分比）" kind="port" />
      {kind === "StatefulSet" && <Field editor={editor} path={[...path, "rollingUpdate", "partition"]} label="滚动更新分区" kind="number" />}
    </>}
    <Field editor={editor} path={["spec", "minReadySeconds"]} label="最短就绪秒数" kind="number" />
    <Field editor={editor} path={["spec", "revisionHistoryLimit"]} label="历史版本保留数" kind="number" />
    {kind === "Deployment" && <Field editor={editor} path={["spec", "progressDeadlineSeconds"]} label="进展截止秒数" kind="number" />}
  </Card>;
}

export default WorkloadResourceForm;
