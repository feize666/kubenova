"use client";

import { PlusOutlined, ReloadOutlined, SearchOutlined, UserOutlined, CrownOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, Col, Empty, Form, Input, Modal,
  Popconfirm, Row, Select, Space, Table, Tag, Typography, theme, Badge,
} from "antd";
import type { TableProps } from "antd";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { useModuleTableState } from "@/components/module-page";
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
    <Modal
      title="新建用户"
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
    >
      {mutation.isError ? (
        <Alert
          type="error"
          showIcon
          message="创建失败"
          description={mutation.error instanceof Error ? mutation.error.message : "创建用户时发生错误"}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form form={form} layout="vertical" requiredMark>
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
      </Form>
    </Modal>
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
    <Modal
      title="编辑用户"
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
      afterOpenChange={(visible) => {
        if (visible && record) {
          form.setFieldsValue({ username: record.username, role: record.role });
        }
      }}
    >
      {mutation.isError ? (
        <Alert
          type="error"
          showIcon
          message="编辑失败"
          description={mutation.error instanceof Error ? mutation.error.message : "编辑用户时发生错误"}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form form={form} layout="vertical" requiredMark>
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
        <Form.Item
          name="password"
          label="新密码（可选，留空则不修改）"
          rules={[{ min: 8, message: "密码至少 8 位" }]}
        >
          <Input.Password placeholder="留空则不修改密码" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { token: themeToken } = theme.useToken();
  const queryClient = useQueryClient();
  const { accessToken, isInitializing } = useAuth();
  const [status, setStatus] = useState<string>("");
  const [actionTargetId, setActionTargetId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<UserTableRecord | null>(null);
  const tableState = useModuleTableState(10);

  const query = useQuery({
    queryKey: [...USERS_QUERY_KEY, accessToken],
    queryFn: () => getUsers({}, accessToken!),
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
    const keyword = tableState.keyword.toLowerCase();
    return sourceItems.filter((item) => {
      const keywordText = `${item.name} ${item.username} ${item.role}`.toLowerCase();
      const matchKeyword = keyword ? keywordText.includes(keyword) : true;
      const matchStatus = status ? (item.isActive ? "active" : "disabled") === status : true;
      return matchKeyword && matchStatus;
    });
  }, [sourceItems, tableState.keyword, status]);

  const paged = useMemo(() => {
    const start = (tableState.page - 1) * tableState.pageSize;
    return filtered.slice(start, start + tableState.pageSize);
  }, [filtered, tableState.page, tableState.pageSize]);

  const rows = useMemo<UserTableRecord[]>(
    () => paged.map((item) => ({ ...item, key: item.id })),
    [paged],
  );

  const columns: TableProps<UserTableRecord>["columns"] = [
    {
      title: "用户",
      key: "user",
      render: (_, row) => (
        <Space>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: row.role === "admin"
                ? "linear-gradient(135deg, #1677ff, #0ea5e9)"
                : "linear-gradient(135deg, #10b981, #059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {(row.name || row.username || "?")[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: themeToken.colorText }}>
              {row.name || "—"}
            </div>
            <div style={{ fontSize: 12, color: themeToken.colorTextSecondary }}>
              {row.username}
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      render: (role: string) =>
        role === "admin" ? (
          <Tag icon={<CrownOutlined />} color="gold">管理员</Tag>
        ) : (
          <Tag icon={<UserOutlined />} color="blue">普通用户</Tag>
        ),
    },
    {
      title: "状态",
      key: "state",
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
      render: (v: string) => new Date(v).toLocaleDateString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      render: (_, row) => {
        const isActive = row.isActive;
        const isLoading = stateMutation.isPending && actionTargetId === row.id;
        return (
          <Space size={4}>
            <Button
              size="small"
              loading={isLoading}
              onClick={() =>
                stateMutation.mutate({ id: row.id, nextState: isActive ? "disabled" : "active" })
              }
            >
              {isActive ? "禁用" : "启用"}
            </Button>
            <Button size="small" onClick={() => setEditRecord(row)}>
              编辑
            </Button>
            <Popconfirm
              title="确认删除用户"
              description={`删除用户 ${row.name || row.username} 后将不可恢复`}
              okText="确认"
              cancelText="取消"
              onConfirm={() => deleteMutation.mutate(row.id)}
            >
              <Button
                size="small"
                danger
                loading={deleteMutation.isPending && deleteMutation.variables === row.id}
              >
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
      <Card>
        <Typography.Title level={4} style={{ marginBottom: 4, color: themeToken.colorText }}>
          用户管理
        </Typography.Title>
        <Typography.Text type="secondary">
          管理平台用户账号、角色权限与账号状态。用户创建后可使用用户名+密码登录。
        </Typography.Text>
      </Card>

      <Card>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={10} lg={8}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder="搜索用户名/角色"
              value={tableState.keywordInput}
              onChange={(e) => tableState.setKeywordInput(e.target.value)}
              onPressEnter={tableState.applyKeyword}
            />
          </Col>
          <Col xs={24} sm={12} md={6} lg={5}>
            <Select
              style={{ width: "100%" }}
              value={status}
              onChange={(value) => {
                setStatus(value);
                tableState.setPage(1);
              }}
              options={[
                { label: "全部状态", value: "" },
                { label: "已启用", value: "active" },
                { label: "已禁用", value: "disabled" },
              ]}
            />
          </Col>
          <Col xs={24} md={8} lg={11}>
            <Space>
              <Button icon={<SearchOutlined />} type="primary" onClick={tableState.applyKeyword}>
                查询
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
                刷新
              </Button>
              <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateOpen(true)}>
                新建用户
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {!isInitializing && !accessToken ? (
        <Alert type="warning" showIcon message="未检测到登录状态，请先登录。" />
      ) : null}

      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={query.error instanceof Error ? query.error.message : "获取用户数据时发生错误"}
        />
      ) : null}

      <Card>
        <Table<UserTableRecord>
          rowKey="key"
          columns={columns}
          dataSource={rows}
          loading={{ spinning: query.isLoading, description: "用户数据加载中..." }}
          pagination={{
            current: tableState.page,
            pageSize: tableState.pageSize,
            total: filtered.length,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 位用户`,
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
                <Empty description="暂无用户数据" />
              ),
          }}
        />
      </Card>

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
    </Space>
  );
}
