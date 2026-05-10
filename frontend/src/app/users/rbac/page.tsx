"use client";

import {
  CheckCircleOutlined,
  CrownOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { useModuleTableState } from "@/components/module-page";
import {
  createRbac,
  deleteRbac,
  getRbac,
  setRbacState,
  type CreateRbacPayload,
  type RbacKind,
  type RbacListItem,
  type RbacListResponse,
  type RbacState,
  type RbacStateChangeInput,
  type RbacSubjectKind,
} from "@/lib/api/rbac";
import { getClusters } from "@/lib/api/clusters";
import { getDynamicResources } from "@/lib/api/resources";

type RbacTableRecord = RbacListItem & { key: string };

const RBAC_QUERY_KEY = ["users", "rbac"] as const;

// ---------- 预定义角色 ----------

interface RoleDefinition {
  name: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  permissions: string[];
  bindingKinds: string[];
}

const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    name: "admin",
    label: "管理员",
    description: "拥有平台所有资源的读写权限，可管理用户、集群和安全策略",
    icon: <CrownOutlined />,
    color: "#f5222d",
    permissions: [
      "读写所有 Namespace 下的工作负载",
      "管理集群配置和节点",
      "读写 RBAC 绑定策略",
      "管理用户账户和权限",
      "查看和管理安全审计日志",
      "操作存储和网络资源",
    ],
    bindingKinds: ["ClusterRoleBinding"],
  },
  {
    name: "operator",
    label: "运维工程师",
    description: "可操作工作负载（扩缩容、重启）和配置，但不可修改用户权限",
    icon: <ToolOutlined />,
    color: "#fa8c16",
    permissions: [
      "读写指定 Namespace 下的工作负载",
      "执行扩缩容、重启、回滚操作",
      "查看和更新 ConfigMap / Secret",
      "查看集群监控和告警",
      "管理存储卷绑定",
      "只读访问安全日志",
    ],
    bindingKinds: ["RoleBinding", "ClusterRoleBinding"],
  },
  {
    name: "read-only",
    label: "只读用户",
    description: "对所有资源仅有只读访问权限，不可执行任何写操作",
    icon: <EyeOutlined />,
    color: "#1677ff",
    permissions: [
      "只读访问工作负载列表和详情",
      "只读访问集群信息",
      "只读访问网络和存储资源",
      "只读访问配置（ConfigMap）",
      "只读访问监控数据",
      "不可修改任何资源",
    ],
    bindingKinds: ["RoleBinding", "ClusterRoleBinding"],
  },
];

// ---------- RoleCard ----------

function RoleCards() {
  return (
    <Card
      title={
        <Space>
          <UserOutlined />
          <span>平台角色权限说明</span>
        </Space>
      }
      style={{ marginBottom: 0 }}
    >
      <Row gutter={[16, 16]}>
        {ROLE_DEFINITIONS.map((role) => (
          <Col key={role.name} xs={24} md={8}>
            <Card
              size="small"
              style={{ borderTop: `3px solid ${role.color}`, height: "100%" }}
              title={
                <Space>
                  <span style={{ color: role.color, fontSize: 16 }}>{role.icon}</span>
                  <Typography.Text strong style={{ color: role.color }}>
                    {role.label}
                  </Typography.Text>
                  <Tag color={role.color} style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {role.name}
                  </Tag>
                </Space>
              }
            >
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
                {role.description}
              </Typography.Text>
              <Descriptions column={1} size="small" style={{ marginBottom: 8 }}>
                {role.permissions.map((perm, idx) => (
                  <Descriptions.Item key={idx} label={null} style={{ paddingBottom: 2 }}>
                    <Space size={4}>
                      <CheckCircleOutlined style={{ color: role.color, fontSize: 11 }} />
                      <Typography.Text style={{ fontSize: 12 }}>{perm}</Typography.Text>
                    </Space>
                  </Descriptions.Item>
                ))}
              </Descriptions>
              <div style={{ marginTop: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  支持绑定类型：
                </Typography.Text>
                <Space size={4} style={{ marginLeft: 4 }}>
                  {role.bindingKinds.map((kind) => (
                    <Tag key={kind} style={{ fontSize: 11, margin: 0 }}>
                      {kind}
                    </Tag>
                  ))}
                </Space>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </Card>
  );
}

// ---------- CreateRbacModal ----------

interface CreateRbacFormValues {
  subject: string;
  subjectKind: RbacSubjectKind;
  subjectNamespace?: string;
  name: string;
  namespace?: string;
  kind: RbacKind;
  lookupClusterId?: string;
}

interface CreateRbacModalProps {
  open: boolean;
  accessToken: string;
  onClose: () => void;
  onSuccess: () => void;
}

const PRESET_ROLES = ROLE_DEFINITIONS.map((r) => ({
  label: `${r.label} (${r.name})`,
  value: r.name,
}));

function CreateRbacModal({ open, accessToken, onClose, onSuccess }: CreateRbacModalProps) {
  const [form] = Form.useForm<CreateRbacFormValues>();
  const watchedKind = Form.useWatch("kind", form);
  const watchedSubjectKind = Form.useWatch("subjectKind", form);
  const watchedNamespace = Form.useWatch("namespace", form);
  const watchedSubjectNamespace = Form.useWatch("subjectNamespace", form);
  const watchedLookupClusterId = Form.useWatch("lookupClusterId", form);

  const clustersQuery = useQuery({
    queryKey: ["rbac", "lookup-clusters", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken),
    enabled: open && Boolean(accessToken),
  });

  const effectiveLookupClusterId = useMemo(() => {
    if (watchedLookupClusterId) return watchedLookupClusterId;
    return clustersQuery.data?.items?.[0]?.id ?? "";
  }, [clustersQuery.data?.items, watchedLookupClusterId]);

  const saQuery = useQuery({
    queryKey: [
      "rbac",
      "sa-options",
      effectiveLookupClusterId,
      watchedSubjectNamespace,
      accessToken,
    ],
    queryFn: () =>
      getDynamicResources(
        {
          clusterId: effectiveLookupClusterId,
          group: "",
          version: "v1",
          resource: "serviceaccounts",
          namespace: watchedSubjectNamespace || undefined,
          page: 1,
          pageSize: 200,
        },
        accessToken,
      ),
    enabled:
      open &&
      Boolean(accessToken) &&
      watchedSubjectKind === "ServiceAccount" &&
      Boolean(effectiveLookupClusterId) &&
      Boolean(watchedSubjectNamespace),
  });

  useEffect(() => {
    const subjectKind = form.getFieldValue("subjectKind");
    if (watchedKind === "RoleBinding" && subjectKind === "Group") {
      form.setFieldValue("subjectKind", "User");
    }
    if (watchedKind === "ClusterRoleBinding" && !subjectKind) {
      form.setFieldValue("subjectKind", "User");
    }
    if (watchedKind === "RoleBinding" && !subjectKind) {
      form.setFieldValue("subjectKind", "User");
    }
  }, [form, watchedKind]);

  useEffect(() => {
    if (watchedKind === "RoleBinding" && watchedSubjectKind === "ServiceAccount") {
      if (watchedNamespace && watchedNamespace !== watchedSubjectNamespace) {
        form.setFieldValue("subjectNamespace", watchedNamespace);
      }
    }
  }, [form, watchedKind, watchedNamespace, watchedSubjectKind, watchedSubjectNamespace]);

  const mutation = useMutation({
    mutationFn: (values: CreateRbacFormValues) => {
      const payload: CreateRbacPayload = {
        name: values.name,
        kind: values.kind,
        namespace: values.namespace ?? "",
        subject: values.subject,
        subjectKind: values.subjectKind,
        subjectNamespace: values.subjectKind === "ServiceAccount" ? values.subjectNamespace : "",
        subjectRef: {
          kind: values.subjectKind,
          name: values.subject,
          namespace: values.subjectKind === "ServiceAccount" ? values.subjectNamespace : "",
        },
      };
      return createRbac(payload, accessToken);
    },
    onSuccess: () => {
      form.resetFields();
      onSuccess();
      onClose();
    },
  });

  const handleOk = () => {
    void form.validateFields().then((values) => {
      mutation.mutate(values);
    });
  };

  const handleClose = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="新建角色绑定"
      open={open}
      onCancel={handleClose}
      onOk={handleOk}
      okText="创建"
      cancelText="取消"
      confirmLoading={mutation.isPending}
      destroyOnHidden
      width={520}
    >
      {mutation.isError ? (
        <Alert
          type="error"
          showIcon
          message="创建失败"
          description={mutation.error instanceof Error ? mutation.error.message : "创建 RBAC 绑定时发生错误"}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{ kind: "RoleBinding", subjectKind: "User" }}
      >
        {watchedSubjectKind === "ServiceAccount" ? (
          <Form.Item
            name="subject"
            label="ServiceAccount 名称"
            rules={[
              { required: true, message: "请选择或输入 ServiceAccount 名称" },
              { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: "ServiceAccount 名称需符合 DNS-1123 label" },
            ]}
          >
            <Select
              showSearch
              allowClear
              loading={saQuery.isLoading}
              placeholder="从集群中选择或手动输入"
              options={Array.from(new Set((saQuery.data?.items ?? []).map((item) => item.name))).map((name) => ({
                label: name,
                value: name,
              }))}
              notFoundContent="未查到 SA，可手动输入"
            />
          </Form.Item>
        ) : (
          <Form.Item
            name="subject"
            label="主体名称"
            rules={[
              { required: true, message: "请输入主体名称" },
              { pattern: /^[a-zA-Z0-9:._-]{2,64}$/, message: "主体名称仅支持字母数字:._-，长度 2-64" },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="例如：ops-admin / dev-team" />
          </Form.Item>
        )}

        <Form.Item name="subjectKind" label="主体类型" rules={[{ required: true, message: "请选择主体类型" }]}>
          <Select
            options={[
              { label: "User", value: "User" },
              ...(watchedKind === "ClusterRoleBinding" ? [{ label: "Group", value: "Group" }] : []),
              { label: "ServiceAccount", value: "ServiceAccount" },
            ]}
          />
        </Form.Item>

        <Form.Item name="name" label="角色名（RoleName）" rules={[{ required: true, message: "请选择或输入角色名" }]}>
          <Select
            showSearch
            allowClear
            placeholder="选择预定义角色或输入自定义角色名"
            options={PRESET_ROLES}
            optionFilterProp="label"
            mode="tags"
            maxCount={1}
            tokenSeparators={[",", " "]}
            notFoundContent="无匹配角色，可直接输入自定义角色名"
          />
        </Form.Item>

        <Form.Item name="kind" label="绑定类型" rules={[{ required: true, message: "请选择绑定类型" }]}>
          <Select
            options={[
              {
                label: (
                  <Tooltip title="绑定到指定名称空间，需填写名称空间">
                    <span>RoleBinding（名称空间级）</span>
                  </Tooltip>
                ),
                value: "RoleBinding",
              },
              {
                label: (
                  <Tooltip title="全集群生效，名称空间留空">
                    <span>ClusterRoleBinding（集群级）</span>
                  </Tooltip>
                ),
                value: "ClusterRoleBinding",
              },
            ]}
          />
        </Form.Item>

        {watchedKind === "RoleBinding" ? (
          <Form.Item
            name="namespace"
            label="名称空间"
            rules={[{ required: true, message: "RoleBinding 需要指定名称空间" }]}
            tooltip="RoleBinding 需指定名称空间，ClusterRoleBinding 留空即可"
          >
            <Input placeholder="例如: default, production" />
          </Form.Item>
        ) : (
          <Form.Item name="namespace" label="名称空间" tooltip="ClusterRoleBinding 全集群生效，留空即可">
            <Input placeholder="ClusterRoleBinding 可留空" disabled />
          </Form.Item>
        )}

        <Form.Item
          name="subjectNamespace"
          label="主体名称空间"
          tooltip="仅 ServiceAccount 需要填写"
          rules={
            watchedSubjectKind === "ServiceAccount"
              ? [
                  { required: true, message: "ServiceAccount 需要主体名称空间" },
                  { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: "名称空间需符合 DNS-1123 label" },
                ]
              : []
          }
        >
          <Input placeholder={watchedSubjectKind === "ServiceAccount" ? "例如: default" : "非 ServiceAccount 可留空"} />
        </Form.Item>

        {watchedSubjectKind === "ServiceAccount" ? (
          <Form.Item
            name="lookupClusterId"
            label="SA 来源集群（仅用于查询候选）"
            tooltip="此字段仅用于联动查询现有 ServiceAccount，不写入绑定对象"
          >
            <Select
              allowClear
              showSearch
              placeholder="选择集群"
              options={(clustersQuery.data?.items ?? []).map((item) => ({
                label: item.name,
                value: item.id,
              }))}
            />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
}

// ---------- stateTag ----------

function stateTag(state: RbacState): React.ReactNode {
  if (state === "active") {
    return (
      <Badge status="success" text={<Tag color="green">已启用</Tag>} />
    );
  }
  return <Badge status="warning" text={<Tag color="gold">已禁用</Tag>} />;
}

function kindTag(kind: string): React.ReactNode {
  if (kind === "ClusterRoleBinding") {
    return (
      <Tag color="purple" style={{ fontFamily: "monospace" }}>
        {kind}
      </Tag>
    );
  }
  return (
    <Tag color="blue" style={{ fontFamily: "monospace" }}>
      {kind}
    </Tag>
  );
}

// ---------- RbacPage ----------

export default function RbacPage() {
  const queryClient = useQueryClient();
  const { accessToken, isInitializing } = useAuth();
  const [kindFilter, setKindFilter] = useState<string>("");
  const [actionTargetId, setActionTargetId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const tableState = useModuleTableState(10);

  const query = useQuery({
    queryKey: [...RBAC_QUERY_KEY, accessToken],
    queryFn: () => getRbac({}, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const mutation = useMutation({
    mutationFn: ({ id, nextState }: RbacStateChangeInput) => setRbacState(id, nextState, accessToken!),
    onMutate: async ({ id, nextState }) => {
      setActionTargetId(id);
      await queryClient.cancelQueries({ queryKey: [...RBAC_QUERY_KEY, accessToken] });
      const previous = queryClient.getQueryData<RbacListResponse>([...RBAC_QUERY_KEY, accessToken]);

      if (previous) {
        queryClient.setQueryData<RbacListResponse>([...RBAC_QUERY_KEY, accessToken], {
          ...previous,
          items: previous.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  state: nextState,
                  version: item.version + 1,
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        });
      }

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData([...RBAC_QUERY_KEY, accessToken], context.previous);
      }
    },
    onSettled: async () => {
      setActionTargetId("");
      await queryClient.invalidateQueries({ queryKey: [...RBAC_QUERY_KEY, accessToken] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRbac(id, accessToken!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...RBAC_QUERY_KEY, accessToken] });
    },
  });

  const sourceItems = useMemo(() => query.data?.items ?? [], [query.data?.items]);

  const namespaceOptions = useMemo(() => {
    const namespaces = Array.from(new Set(sourceItems.map((item) => item.namespace).filter(Boolean)));
    return namespaces.map((item) => ({ label: item || "(集群级)", value: item }));
  }, [sourceItems]);

  const filtered = useMemo(() => {
    const keyword = tableState.keyword.toLowerCase();
    return sourceItems.filter((item) => {
      const keywordText = `${item.name} ${item.kind} ${item.namespace} ${item.subject} ${item.subjectKind} ${item.subjectNamespace}`.toLowerCase();
      const matchKeyword = keyword ? keywordText.includes(keyword) : true;
      const matchNamespace = tableState.namespace ? item.namespace === tableState.namespace : true;
      const matchKind = kindFilter ? item.kind === kindFilter : true;
      return matchKeyword && matchNamespace && matchKind;
    });
  }, [sourceItems, tableState.keyword, tableState.namespace, kindFilter]);

  const paged = useMemo(() => {
    const start = (tableState.page - 1) * tableState.pageSize;
    return filtered.slice(start, start + tableState.pageSize);
  }, [filtered, tableState.page, tableState.pageSize]);

  const rows = useMemo<RbacTableRecord[]>(() => paged.map((item) => ({ ...item, key: item.id })), [paged]);

  // 统计信息
  const stats = useMemo(() => {
    const active = sourceItems.filter((i) => i.state === "active").length;
    const clusterLevel = sourceItems.filter((i) => i.kind === "ClusterRoleBinding").length;
    const nsLevel = sourceItems.filter((i) => i.kind === "RoleBinding").length;
    return { total: sourceItems.length, active, clusterLevel, nsLevel };
  }, [sourceItems]);

  const columns: TableProps<RbacTableRecord>["columns"] = [
    {
      title: "策略名 / 角色",
      dataIndex: "name",
      key: "name",
      render: (value: string) => {
        const preset = ROLE_DEFINITIONS.find((r) => r.name === value);
        return (
          <Space size={4}>
            {preset ? <span style={{ color: preset.color }}>{preset.icon}</span> : null}
            <Typography.Text strong style={{ fontFamily: "monospace" }}>
              {value}
            </Typography.Text>
            {preset ? (
              <Tag color={preset.color} style={{ fontSize: 11 }}>
                {preset.label}
              </Tag>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "绑定类型",
      dataIndex: "kind",
      key: "kind",
      render: (value: string) => kindTag(value),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      render: (value: string) =>
        value ? (
          <Tag style={{ fontFamily: "monospace" }}>{value}</Tag>
        ) : (
          <Typography.Text type="secondary" italic>
            集群级
          </Typography.Text>
        ),
    },
    {
      title: "绑定主体",
      dataIndex: "subject",
      key: "subject",
      render: (value: string, row) => (
        <Space size={4}>
          <UserOutlined style={{ color: "#8c8c8c" }} />
          <Typography.Text copyable={{ text: value }} style={{ fontFamily: "monospace" }}>
            {row.subjectKind}:{value}
            {row.subjectKind === "ServiceAccount" && row.subjectNamespace ? `@${row.subjectNamespace}` : ""}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "state",
      key: "state",
      render: (value: RbacState) => stateTag(value),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      render: (value: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {value ? new Date(value).toLocaleString("zh-CN") : "-"}
        </Typography.Text>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_, row) => {
        const isActive = row.state === "active";
        const isLoading = mutation.isPending && actionTargetId === row.id;
        return (
          <Space size={4}>
            <Button
              size="small"
              loading={isLoading}
              type={isActive ? "default" : "primary"}
              onClick={() => mutation.mutate({ id: row.id, nextState: isActive ? "disabled" : "active" })}
            >
              {isActive ? "禁用" : "启用"}
            </Button>
            <Popconfirm
              title="确认删除绑定"
              description={`删除绑定 "${row.name}" 后将不可恢复，确认继续？`}
              okText="确认删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteMutation.mutate(row.id)}
            >
              <Button size="small" danger loading={deleteMutation.isPending && deleteMutation.variables === row.id}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      {/* 页头 */}
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Typography.Title level={4} style={{ marginBottom: 4 }}>
              访问控制（RBAC）
            </Typography.Title>
            <Typography.Text type="secondary">
              管理平台角色绑定关系，控制用户对 Kubernetes 资源的访问权限。
            </Typography.Text>
          </Col>
          <Col>
            <Row gutter={16}>
              {[
                { label: "绑定总数", value: stats.total, color: "#1677ff" },
                { label: "已启用", value: stats.active, color: "#52c41a" },
                { label: "集群级", value: stats.clusterLevel, color: "#722ed1" },
                { label: "名称空间级", value: stats.nsLevel, color: "#1677ff" },
              ].map(({ label, value, color }) => (
                <Col key={label} style={{ textAlign: "center" }}>
                  <Typography.Title level={3} style={{ margin: 0, color }}>
                    {query.isLoading ? "-" : value}
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {label}
                  </Typography.Text>
                </Col>
              ))}
            </Row>
          </Col>
        </Row>
      </Card>

      {/* 角色说明卡片 */}
      <RoleCards />

      {/* 筛选栏 */}
      <Card>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={10} lg={8}>
            <Input
              allowClear
              placeholder="搜索策略名 / 用户名 / 名称空间"
              value={tableState.keywordInput}
              onChange={(e) => tableState.setKeywordInput(e.target.value)}
              onPressEnter={tableState.applyKeyword}
              prefix={<SearchOutlined />}
            />
          </Col>
          <Col xs={24} sm={12} md={6} lg={5}>
            <Select
              style={{ width: "100%" }}
              value={tableState.namespace}
              onChange={tableState.setNamespace}
              options={[{ label: "全部名称空间", value: "" }, ...namespaceOptions]}
              placeholder="筛选名称空间"
            />
          </Col>
          <Col xs={24} sm={12} md={6} lg={5}>
            <Select
              style={{ width: "100%" }}
              value={kindFilter}
              onChange={(value) => {
                setKindFilter(value);
                tableState.setPage(1);
              }}
              options={[
                { label: "全部绑定类型", value: "" },
                { label: "RoleBinding", value: "RoleBinding" },
                { label: "ClusterRoleBinding", value: "ClusterRoleBinding" },
              ]}
            />
          </Col>
          <Col xs={24} md={8} lg={6}>
            <Space>
              <Button icon={<SearchOutlined />} type="primary" onClick={tableState.applyKeyword}>
                查询
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void query.refetch()} loading={query.isFetching}>
                刷新
              </Button>
              <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateOpen(true)}>
                新建绑定
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 错误提示 */}
      {!isInitializing && !accessToken ? (
        <Alert type="warning" showIcon message="未检测到登录状态，请先登录。" />
      ) : null}

      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={query.error instanceof Error ? query.error.message : "获取 RBAC 数据时发生错误"}
        />
      ) : null}

      {mutation.isError ? (
        <Alert
          type="error"
          showIcon
          message="操作失败"
          description={mutation.error instanceof Error ? mutation.error.message : "RBAC 启停操作失败"}
        />
      ) : null}

      {deleteMutation.isError ? (
        <Alert
          type="error"
          showIcon
          message="删除失败"
          description={deleteMutation.error instanceof Error ? deleteMutation.error.message : "删除 RBAC 绑定时发生错误"}
        />
      ) : null}

      {/* 绑定列表 */}
      <Card
        title={
          <Space>
            <span>角色绑定列表</span>
            {query.data ? (
              <Tag color="blue">共 {filtered.length} 条</Tag>
            ) : null}
          </Space>
        }
      >
        <Table<RbacTableRecord>
          rowKey="key"
          columns={columns}
          dataSource={rows}
          loading={{ spinning: query.isLoading, description: "RBAC 数据加载中..." }}
          pagination={{
            current: tableState.page,
            pageSize: tableState.pageSize,
            total: filtered.length,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== tableState.pageSize) {
                tableState.setPageSize(nextPageSize);
                return;
              }
              tableState.setPage(nextPage);
            },
          }}
          locale={{
            emptyText:
              query.isLoading ? (
                "正在加载..."
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    tableState.keyword || tableState.namespace || kindFilter
                      ? "暂无符合条件的 RBAC 绑定"
                      : "暂无 RBAC 绑定，点击「新建绑定」创建"
                  }
                />
              ),
          }}
        />
      </Card>

      <CreateRbacModal
        open={createOpen}
        accessToken={accessToken ?? ""}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => void queryClient.invalidateQueries({ queryKey: [...RBAC_QUERY_KEY, accessToken] })}
      />
    </Space>
  );
}
