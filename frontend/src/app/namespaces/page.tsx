"use client";

import { DeleteOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Card,
  Col,
  Dropdown,
  Button,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourcePageHeader } from "@/components/resource-page-header";
import {
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  renderPodLikeResourceActionStyles,
  renderResourceActionTriggerButton,
} from "@/components/resource-action-bar";
import { getClusters } from "@/lib/api/clusters";
import {
  createNamespace,
  deleteNamespace,
  getNamespaces,
  updateNamespace,
  type NamespaceListItem,
} from "@/lib/api/namespaces";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";

interface FormValues {
  clusterId: string;
  namespace: string;
  labelsText?: string;
}

function parseLabels(input?: string): Record<string, string> {
  if (!input?.trim()) return {};
  const labels: Record<string, string> = {};
  input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [k, ...rest] = line.split("=");
      const key = k?.trim();
      if (!key) return;
      labels[key] = rest.join("=").trim();
    });
  return labels;
}

function labelsToText(labels?: Record<string, string>): string {
  if (!labels) return "";
  return Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export default function NamespacesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { accessToken, isInitializing } = useAuth();

  const [clusterId, setClusterId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NamespaceListItem | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);

  const clustersQuery = useQuery({
    queryKey: ["clusters", "namespace-admin", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });
  const namespacesQuery = useQuery({
    queryKey: ["namespaces", clusterId, keyword, accessToken],
    queryFn: () =>
      getNamespaces(
        {
          clusterId: clusterId || undefined,
          keyword: keyword.trim() || undefined,
        },
        accessToken,
      ),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterOptions = useMemo(
    () => [
      { label: "全部集群", value: "" },
      ...((clustersQuery.data?.items ?? [])
        .map((item) => ({ label: item.name, value: item.id }))),
    ],
    [clustersQuery.data],
  );

  const mutateCreate = useMutation({
    mutationFn: async (values: FormValues) =>
      createNamespace(
        {
          clusterId: values.clusterId,
          namespace: values.namespace,
          labels: parseLabels(values.labelsText),
        },
        accessToken,
      ),
    onSuccess: async () => {
      message.success("名称空间创建成功");
      setOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : "创建失败"),
  });

  const mutateUpdate = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!editing) throw new Error("未选择目标名称空间");
      return updateNamespace(editing.id, { labels: parseLabels(values.labelsText) }, accessToken);
    },
    onSuccess: async () => {
      message.success("标签更新成功");
      setOpen(false);
      setEditing(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : "更新失败"),
  });

  const mutateDelete = useMutation({
    mutationFn: async (id: string) => deleteNamespace(id, accessToken),
    onSuccess: async () => {
      message.success("名称空间已删除");
      await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : "删除失败"),
  });

  const openEditModal = (row: NamespaceListItem) => {
    setEditing(row);
    form.setFieldsValue({
      clusterId: row.clusterId,
      namespace: row.namespace,
      labelsText: labelsToText(row.labels),
    });
    setOpen(true);
  };

  const buildRowActions = (row: NamespaceListItem): MenuProps["items"] => [
    { key: "describe", label: "描述" },
    { key: "yaml", label: "YAML" },
    { type: "divider" },
    { key: "delete", icon: <DeleteOutlined />, danger: true, label: "删除" },
  ];

  const handleRowAction = (row: NamespaceListItem, key: string) => {
    if (key === "describe") {
      setDetailTarget({ kind: "Namespace", id: row.id });
      return;
    }
    if (key === "yaml") {
      setYamlTarget({
        clusterId: row.clusterId,
        namespace: row.namespace,
        kind: "Namespace",
        name: row.namespace,
      });
      return;
    }
    if (key === "delete") {
      Modal.confirm({
        title: "删除名称空间",
        content: `确认删除 ${row.namespace} 吗？`,
        okText: "确认",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => mutateDelete.mutate(row.id),
      });
    }
  };

  const columns: ColumnsType<NamespaceListItem> = [
    { title: "名称空间", dataIndex: "namespace", key: "namespace", width: getAdaptiveNameWidth(namespacesQuery.data?.items?.map((item) => item.namespace) ?? []) },
    { title: "集群", dataIndex: "clusterName", key: "clusterName", width: TABLE_COL_WIDTH.cluster },
    {
      title: "标签",
      key: "labels",
      render: (_, row) => {
        const labels = Object.entries(row.labels ?? {});
        if (!labels.length) return <Typography.Text type="secondary">-</Typography.Text>;
        return (
          <Space size={[4, 4]} wrap>
            {labels.map(([k, v]) => (
              <Tag key={`${row.id}-${k}`}>{`${k}=${v}`}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 86,
      align: "center",
      fixed: "right",
      render: (_, row) => (
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          classNames={{ root: POD_ACTION_MENU_CLASS }}
          menu={{
            items: buildRowActions(row),
            onClick: ({ key }) => handleRowAction(row, String(key)),
          }}
        >
          {renderResourceActionTriggerButton({
            ariaLabel: "更多操作",
            baseClassName: POD_ACTION_TRIGGER_CLASS,
          })}
        </Dropdown>
      ),
    },
  ];

  const modalSubmitting = mutateCreate.isPending || mutateUpdate.isPending;

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/namespaces"
          embedded
          style={{ marginBottom: 12 }}
          description="统一管理名称空间、标签与资源隔离范围。"
          titleSuffix={
            <ResourceAddButton
              onClick={() => {
                setEditing(null);
                form.resetFields();
                setOpen(true);
              }}
              aria-label="新增名称空间"
            />
          }
        />
      </Card>

      <Card className="cyber-panel">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}>
            <Select
              value={clusterId}
              onChange={(v) => setClusterId(v)}
              options={clusterOptions}
              style={{ width: "100%" }}
            />
          </Col>
          <Col xs={24} md={10}>
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onPressEnter={() => setKeyword(keywordInput.trim())}
              placeholder="按名称空间搜索"
            />
          </Col>
          <Col xs={24} md={6}>
            <Button icon={<SearchOutlined />} type="primary" onClick={() => setKeyword(keywordInput.trim())}>
              查询
            </Button>
          </Col>
        </Row>
      </Card>

      {!isInitializing && !accessToken ? (
        <Alert type="warning" showIcon message="请先登录后访问 Namespace 管理。" />
      ) : null}

      {namespacesQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="Namespace 加载失败"
          description={namespacesQuery.error instanceof Error ? namespacesQuery.error.message : "请求失败"}
        />
      ) : null}

      <Card className="cyber-panel">
        <Table<NamespaceListItem>
          rowKey="id"
          columns={columns}
          dataSource={namespacesQuery.data?.items ?? []}
          loading={namespacesQuery.isLoading}
          pagination={{
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 项`,
          }}
          scroll={{ x: getTableScrollX(columns) }}
        />
      </Card>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken || undefined}
      />

      <ResourceYamlDrawer
        open={Boolean(yamlTarget)}
        onClose={() => setYamlTarget(null)}
        identity={yamlTarget}
        token={accessToken || undefined}
      />

      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}

      <Modal
        title={editing ? "编辑 Namespace 标签" : "新建 Namespace"}
        open={open}
        onCancel={() => {
          if (!modalSubmitting) {
            setOpen(false);
            setEditing(null);
            form.resetFields();
          }
        }}
        onOk={() =>
          void form.validateFields().then((values) => {
            if (editing) {
              mutateUpdate.mutate(values);
            } else {
              mutateCreate.mutate(values);
            }
          })
        }
        confirmLoading={modalSubmitting}
        okText={editing ? "保存" : "创建"}
        cancelText="取消"
      >
        <Form<FormValues> form={form} layout="vertical" initialValues={{ clusterId: clusterId || undefined }}>
          <Form.Item name="clusterId" label="集群" rules={[{ required: true, message: "请选择集群" }]}>
            <Select
              options={(clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id }))}
              disabled={Boolean(editing)}
            />
          </Form.Item>
          <Form.Item name="namespace" label="名称空间" rules={[{ required: true, message: "请输入名称空间" }]}>
            <Input disabled={Boolean(editing)} placeholder="例如：k8s-test" />
          </Form.Item>
          <Form.Item
            name="labelsText"
            label="标签（每行 key=value）"
            extra="可用于记录配额策略、限额说明等运维元信息。"
          >
            <Input.TextArea rows={6} placeholder={"team=platform\nenv=prod\nquota.cpu=2"} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
