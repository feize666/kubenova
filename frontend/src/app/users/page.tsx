"use client";

import { ReloadOutlined, UserOutlined, CrownOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Form, Input, Select, Space, Typography, theme, Badge } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { BusinessDetailDrawer, type BusinessDetailSection } from "@/components/business-detail-drawer";
import { useModuleTableState } from "@/components/module-page";
import { OpsFilterChip, OpsFormSection, OpsIconActionButton, OpsModalShell, OpsPageHeader, OpsSurface } from "@/components/ops";
import {
  ResourceActionDropdown,
  type ResourceActionItem,
} from "@/components/resource-action-bar";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceTable } from "@/components/resource-table";
import type { HeadlampResourceTableColumn, HeadlampTableFilters } from "@/components/resource-table";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { buildTablePagination } from "@/lib/table/pagination";
import { usePersistentTableSortState } from "@/lib/table/use-persistent-table-sort-state";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import {
  createUser,
  deleteUser,
  getUsers,
  setUserState,
  updateUser,
  type CreateUserPayload,
  type UpdateUserPayload,
  type UserListItem,
  type UserStateChangeInput,
  type UsersListResponse,
} from "@/lib/api/users";

type UserTableRecord = UserListItem & { key: string };

const USERS_QUERY_KEY = ["users", "list"] as const;

// ── CreateUserModal ────────────────────────────────────────────────────────────
interface CreateUserFormValues {
  username: string;
  password: string;
  role: string;
}

interface CreateUserModalProps {
  open: boolean;
  accessToken: string;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateUserModal({ open, accessToken, onClose, onSuccess }: CreateUserModalProps) {
  const [form] = Form.useForm<CreateUserFormValues>();

  const mutation = useMutation({
    mutationFn: (values: CreateUserFormValues) => {
      const payload: CreateUserPayload = {
        username: values.username,
        password: values.password,
        role: values.role,
      };
      return createUser(payload, accessToken);
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

  return (
    <OpsModalShell
      title="新建用户"
      description="创建可登录 Kubenova 控制台的本地用户，并分配基础访问角色。"
      identity="用户"
      open={open}
      onCancel={() => {
        form.resetFields();
        mutation.reset();
        onClose();
      }}
      onOk={handleOk}
      okText="创建"
      cancelText="取消"
      confirmLoading={mutation.isPending}
      destroyOnHidden
      width={520}
    >
      {mutation.isError ? (
        <Alert
          className="identity-resource-state-alert"
          type="error"
          showIcon
          title="创建失败"
          description={mutation.error instanceof Error ? mutation.error.message : "创建用户时发生错误"}
        />
      ) : null}
      <Form form={form} layout="vertical" requiredMark>
        <OpsFormSection title="登录身份" description="用户名用于审计和登录，密码仅在创建时写入。">
          <Form.Item
            name="username"
            label="用户名（用于登录）"
            rules={[
              { required: true, message: "请输入用户名" },
              { pattern: /^[a-zA-Z0-9._-]{3,32}$/, message: "用户名仅支持字母数字._-，长度 3-32" },
            ]}
          >
            <Input placeholder="例如：ops-admin" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="登录密码"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 8, message: "密码至少 8 位" },
            ]}
          >
            <Input.Password placeholder="请输入密码（至少 8 位）" autoComplete="new-password" />
          </Form.Item>
        </OpsFormSection>
        <OpsFormSection title="权限范围" description="角色决定用户可访问的控制台能力。">
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: "请选择角色" }]}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                管理员：拥有所有权限；普通用户：只能查看基础资源
              </Typography.Text>
            }
          >
            <Select
              options={[
                { label: "管理员 (admin)", value: "admin" },
                { label: "普通用户 (user)", value: "user" },
              ]}
              placeholder="请选择角色"
            />
          </Form.Item>
        </OpsFormSection>
      </Form>
    </OpsModalShell>
  );
}

// ── EditUserModal ──────────────────────────────────────────────────────────────
interface EditUserFormValues {
  username: string;
  role: string;
  password?: string;
}

interface EditUserModalProps {
  record: UserTableRecord | null;
  accessToken: string;
  onClose: () => void;
  onSuccess: () => void;
}

function EditUserModal({ record, accessToken, onClose, onSuccess }: EditUserModalProps) {
  const [form] = Form.useForm<EditUserFormValues>();

  const mutation = useMutation({
    mutationFn: (values: EditUserFormValues) => {
      const payload: UpdateUserPayload = {
        username: values.username,
        role: values.role,
        ...(values.password ? { password: values.password } : {}),
      };
      return updateUser(record!.id, payload, accessToken);
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

  return (
    <OpsModalShell
      title="编辑用户"
      description="更新用户登录标识、角色或密码；留空密码则保留原密码。"
      identity={record?.username ?? "用户"}
      open={Boolean(record)}
      onCancel={() => {
        form.resetFields();
        mutation.reset();
        onClose();
      }}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      confirmLoading={mutation.isPending}
      destroyOnHidden
      width={520}
      afterOpenChange={(visible) => {
        if (visible && record) {
          form.setFieldsValue({ username: record.username, role: record.role });
        }
      }}
    >
      {mutation.isError ? (
        <Alert
          className="identity-resource-state-alert"
          type="error"
          showIcon
          title="编辑失败"
          description={mutation.error instanceof Error ? mutation.error.message : "编辑用户时发生错误"}
        />
      ) : null}
      <Form form={form} layout="vertical" requiredMark>
        <OpsFormSection title="账号资料" description="用户名与角色会立即影响控制台访问范围。">
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: "请输入用户名" },
              { pattern: /^[a-zA-Z0-9._-]{3,32}$/, message: "用户名仅支持字母数字._-，长度 3-32" },
            ]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
            <Select
              options={[
                { label: "管理员 (admin)", value: "admin" },
                { label: "普通用户 (user)", value: "user" },
              ]}
              placeholder="请选择角色"
            />
          </Form.Item>
        </OpsFormSection>
        <OpsFormSection title="密码" description="留空则不修改当前登录密码。">
          <Form.Item
            name="password"
            label="新密码（可选，留空则不修改）"
            rules={[{ min: 8, message: "密码至少 8 位" }]}
          >
            <Input.Password placeholder="留空则不修改密码" autoComplete="new-password" />
          </Form.Item>
        </OpsFormSection>
      </Form>
    </OpsModalShell>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { token: themeToken } = theme.useToken();
  const queryClient = useQueryClient();
  const { accessToken, isInitializing } = useAuth();
  const [status, setStatus] = useState<string>("");
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [actionTargetId, setActionTargetId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<UserTableRecord | null>(null);
  const [detailRecord, setDetailRecord] = useState<UserTableRecord | null>(null);
  const tableState = useModuleTableState(10);
  const {
    sortBy,
    sortOrder,
    getSortableColumnProps,
    handleTableChange,
  } = usePersistentTableSortState<UserTableRecord>({
    storageKey: "users.list.sort",
    allowedSortBy: ["username", "role", "createdAt", "updatedAt"],
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
  });

  const query = useQuery({
    queryKey: [...USERS_QUERY_KEY, accessToken, tableState.page, tableState.pageSize, sortBy, sortOrder],
    queryFn: () =>
      getUsers(
        {
          page: tableState.page,
          pageSize: tableState.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
        },
        accessToken!,
      ),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const stateMutation = useMutation({
    mutationFn: ({ id, nextState }: UserStateChangeInput) => setUserState(id, nextState, accessToken!),
    onMutate: async ({ id, nextState }) => {
      setActionTargetId(id);
      await queryClient.cancelQueries({ queryKey: [...USERS_QUERY_KEY, accessToken] });
      const previous = queryClient.getQueryData<UsersListResponse>([...USERS_QUERY_KEY, accessToken]);
      if (previous) {
        queryClient.setQueryData<UsersListResponse>([...USERS_QUERY_KEY, accessToken], {
          ...previous,
          items: previous.items.map((item) =>
            item.id === id ? { ...item, isActive: nextState === "active" } : item,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData([...USERS_QUERY_KEY, accessToken], context.previous);
      }
    },
    onSettled: async () => {
      setActionTargetId("");
      await queryClient.invalidateQueries({ queryKey: [...USERS_QUERY_KEY, accessToken] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUser(id, accessToken!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...USERS_QUERY_KEY, accessToken] });
    },
  });

  const sourceItems = useMemo(() => query.data?.items ?? [], [query.data?.items]);

  const filtered = useMemo(() => {
    const keyword = tableState.keywordInput.trim().toLowerCase();
    const userFilter = typeof tableFilters.user === "string" ? tableFilters.user.toLowerCase() : "";
    const roleFilter = typeof tableFilters.role === "string" ? tableFilters.role : "";
    const stateFilter = typeof tableFilters.state === "string" ? tableFilters.state : status;
    return sourceItems.filter((item) => {
      const keywordText = `${item.name} ${item.username} ${item.role}`.toLowerCase();
      const matchKeyword = keyword ? keywordText.includes(keyword) : true;
      const matchUser = userFilter ? keywordText.includes(userFilter) : true;
      const matchRole = roleFilter ? item.role === roleFilter : true;
      const matchStatus = stateFilter ? (item.isActive ? "active" : "disabled") === stateFilter : true;
      return matchKeyword && matchUser && matchRole && matchStatus;
    });
  }, [sourceItems, status, tableFilters.role, tableFilters.state, tableFilters.user, tableState.keywordInput]);

  const paged = useMemo(() => filtered, [filtered]);

  const rows = useMemo<UserTableRecord[]>(
    () => paged.map((item) => ({ ...item, key: item.id })),
    [paged],
  );
  const userWidth = useMemo(
    () => getAdaptiveNameWidth(rows.map((row) => row.name || row.username), { max: 280 }),
    [rows],
  );

  const columns: Array<HeadlampResourceTableColumn<UserTableRecord>> = [
    {
      title: "用户",
      key: "user",
      required: true,
      width: userWidth,
      ellipsis: true,
      filter: { type: "text", placeholder: "以用户过滤" },
      render: (_, row) => (
        <Space style={{ maxWidth: "100%" }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: `1px solid ${row.role === "admin" ? "var(--ops-status-info-border)" : "var(--ops-status-success-border)"}`,
              background: row.role === "admin" ? "var(--ops-status-info-bg)" : "var(--ops-status-success-bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: row.role === "admin" ? "var(--ops-status-info-text)" : "var(--ops-status-success-text)",
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {(row.name || row.username || "?")[0].toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <Typography.Link
              onClick={() => setDetailRecord(row)}
              ellipsis
              title={row.name || row.username}
              style={{ display: "block", maxWidth: 190, fontWeight: 600, fontSize: 13 }}
            >
              {row.name || "—"}
            </Typography.Link>
            <Typography.Text
              ellipsis={{ tooltip: row.username }}
              style={{ display: "block", maxWidth: 190, fontSize: 12, color: themeToken.colorTextSecondary }}
            >
              {row.username}
            </Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 130,
      ellipsis: true,
      filter: {
        type: "select",
        placeholder: "以角色过滤",
        options: [
          { label: "管理员", value: "admin" },
          { label: "普通用户", value: "user" },
        ],
      },
      ...getSortableColumnProps("role", query.isLoading && !query.data),
      render: (role: string) =>
        role === "admin" ? (
          <OpsFilterChip icon={<CrownOutlined />} tone="warning">管理员</OpsFilterChip>
        ) : (
          <OpsFilterChip icon={<UserOutlined />} tone="info">普通用户</OpsFilterChip>
        ),
    },
    {
      title: "状态",
      key: "state",
      width: TABLE_COL_WIDTH.state,
      ellipsis: true,
      filter: {
        type: "select",
        placeholder: "以状态过滤",
        options: [
          { label: "已启用", value: "active" },
          { label: "已禁用", value: "disabled" },
        ],
      },
      render: (_, row) =>
        row.isActive ? (
          <Badge status="success" text={<span style={{ color: themeToken.colorText }}>已启用</span>} />
        ) : (
          <Badge status="default" text={<span style={{ color: themeToken.colorTextSecondary }}>已禁用</span>} />
        ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: TABLE_COL_WIDTH.time,
      ellipsis: true,
      ...getSortableColumnProps("createdAt", query.isLoading && !query.data),
      render: (v: string) => new Date(v).toLocaleDateString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      required: true,
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      render: (_, row) => {
        const isActive = row.isActive;
        const isLoading = stateMutation.isPending && actionTargetId === row.id;
        const actions: ResourceActionItem[] = [
          {
            key: isActive ? "disable" : "enable",
            label: isActive ? "禁用" : "启用",
            loading: isLoading,
            onClick: () =>
              stateMutation.mutate({ id: row.id, nextState: isActive ? "disabled" : "active" }),
          },
          {
            key: "edit",
            label: "编辑",
            onClick: () => setEditRecord(row),
          },
          {
            key: "delete",
            label: "删除",
            danger: true,
            loading: deleteMutation.isPending && deleteMutation.variables === row.id,
            onClick: () => deleteMutation.mutate(row.id),
            confirm: {
              title: "确认删除用户",
              description: `删除用户 ${row.name || row.username} 后将不可恢复`,
              okText: "确认",
              cancelText: "取消",
              okDanger: true,
            },
          },
        ];
        return (
          <ResourceActionDropdown actions={actions} ariaLabel={`${row.username} 更多操作`} />
        );
      },
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <OpsPageHeader
        className="resource-page-header"
        title="用户管理"
        subtitle="管理平台用户账号、角色权限与账号状态。用户创建后可使用用户名+密码登录。"
      />

      {!isInitializing && !accessToken ? (
        <Alert className="identity-resource-state-alert" type="warning" showIcon title="未检测到登录状态，请先登录。" />
      ) : null}

      {query.isError ? (
        <Alert
          className="identity-resource-state-alert"
          type="error"
          showIcon
          title="加载失败"
          description={query.error instanceof Error ? query.error.message : "获取用户数据时发生错误"}
        />
      ) : null}

      <OpsSurface variant="panel" padding="sm">
        <ResourceTable<UserTableRecord>
          rowKey="key"
          tableKey="business.users"
          columns={columns as ColumnsType<UserTableRecord>}
          dataSource={rows}
          layoutOptions={{ nameValues: rows.map((row) => row.name || row.username), actionWidth: TABLE_COL_WIDTH.actionCompact }}
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: tableState.keywordInput,
            onChange: (value) => {
              tableState.setKeywordInput(value);
              tableState.setPage(1);
            },
            placeholder: "搜索用户名/角色",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            setStatus(typeof nextFilters.state === "string" ? nextFilters.state : "");
            tableState.setPage(1);
          }}
          toolbarExtra={
            <Space size={8} wrap>
              <OpsIconActionButton icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
                刷新
              </OpsIconActionButton>
              <ResourceAddButton compact={false} label="新建用户" onClick={() => setCreateOpen(true)} aria-label="新建用户" />
            </Space>
          }
          loading={{ spinning: query.isLoading, description: "用户数据加载中..." }}
          onChange={(pagination, filters, sorter, extra) => {
            handleTableChange(pagination, filters, sorter, extra, query.isLoading && !query.data);
            if (pagination.current && pagination.current !== tableState.page) {
              tableState.setPage(pagination.current);
            }
            if (pagination.pageSize && pagination.pageSize !== tableState.pageSize) {
              tableState.setPageSize(pagination.pageSize);
            }
          }}
          pagination={buildTablePagination({
            current: tableState.page,
            pageSize: tableState.pageSize,
            total: query.data?.total ?? filtered.length,
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== tableState.pageSize) {
                tableState.setPageSize(nextPageSize);
                return;
              }
              tableState.setPage(nextPage);
            },
            showTotal: (total) => `共 ${total} 位用户`,
          })}
          emptyDescription="暂无用户数据"
        />
      </OpsSurface>

      <CreateUserModal
        open={createOpen}
        accessToken={accessToken ?? ""}
        onClose={() => setCreateOpen(false)}
        onSuccess={() =>
          void queryClient.invalidateQueries({ queryKey: [...USERS_QUERY_KEY, accessToken] })
        }
      />
      <EditUserModal
        record={editRecord}
        accessToken={accessToken ?? ""}
        onClose={() => setEditRecord(null)}
        onSuccess={() =>
          void queryClient.invalidateQueries({ queryKey: [...USERS_QUERY_KEY, accessToken] })
        }
      />
      <BusinessDetailDrawer
        open={Boolean(detailRecord)}
        title={detailRecord ? `用户详情 · ${detailRecord.name || detailRecord.username}` : "用户详情"}
        subtitle={detailRecord?.username}
        onClose={() => setDetailRecord(null)}
        sections={buildUserDetailSections(detailRecord)}
      />
    </Space>
  );
}

function buildUserDetailSections(record: UserTableRecord | null): BusinessDetailSection[] {
  if (!record) {
    return [];
  }
  return [
    {
      key: "basic",
      title: "基础信息",
      items: [
        { key: "name", label: "姓名", value: record.name || "-" },
        { key: "username", label: "用户名", value: <Typography.Text code>{record.username}</Typography.Text> },
        { key: "role", label: "角色", value: record.role === "admin" ? "管理员" : "普通用户" },
        { key: "state", label: "状态", value: record.isActive ? "已启用" : "已禁用" },
      ],
    },
    {
      key: "lifecycle",
      title: "生命周期",
      items: [
        { key: "createdAt", label: "创建时间", value: new Date(record.createdAt).toLocaleString("zh-CN") },
        { key: "updatedAt", label: "更新时间", value: record.updatedAt ? new Date(record.updatedAt).toLocaleString("zh-CN") : "-" },
      ],
    },
  ];
}
