import type { ColumnsType } from "antd/es/table";
import { TABLE_COL_WIDTH } from "@/lib/table-column-widths";

export type ResourceTableColumn<T> = NonNullable<ColumnsType<T>[number]>;

type StandardColumnKey = "name" | "cluster" | "namespace" | "actions";
type ResourceTableColumnAlign = NonNullable<ResourceTableColumn<unknown>["align"]>;

export type StandardResourceTableColumns<T> = {
  name: ResourceTableColumn<T>;
  cluster?: ResourceTableColumn<T> | null;
  namespace?: ResourceTableColumn<T> | null;
  body?: Array<ResourceTableColumn<T> | null | undefined>;
  actions?: ResourceTableColumn<T>;
};

export function buildResourceTableColumns<T>(
  schema: StandardResourceTableColumns<T>,
): ColumnsType<T> {
  const columns: Array<ResourceTableColumn<T>> = [schema.name];

  if (schema.cluster) {
    columns.push(schema.cluster);
  }
  if (schema.namespace) {
    columns.push(schema.namespace);
  }
  if (schema.body?.length) {
    columns.push(
      ...schema.body.filter((column): column is ResourceTableColumn<T> => Boolean(column)),
    );
  }
  if (schema.actions) {
    columns.push(schema.actions);
  }

  return columns;
}

export function withResourceTableColumnDefaults<T>(
  column: ResourceTableColumn<T>,
  defaults: {
    align?: ResourceTableColumnAlign;
    ellipsis?: boolean;
  } = {},
): ResourceTableColumn<T> {
  return {
    align: defaults.align ?? "left",
    ellipsis: defaults.ellipsis ?? true,
    ...column,
  };
}

export function buildResourceTableActionsColumn<T>(
  render: ResourceTableColumn<T>["render"],
  options: {
    title?: ResourceTableColumn<T>["title"];
    key?: string;
    width?: number;
  } = {},
): ResourceTableColumn<T> {
  return {
    title: options.title ?? "操作",
    key: options.key ?? "actions",
    width: options.width ?? TABLE_COL_WIDTH.actionCompact,
    fixed: "right",
    align: "left",
    render,
  };
}

export function buildResourceTableOrder(
  columns: Array<{ key?: string } | null | undefined>,
): StandardColumnKey[] {
  const keys = columns
    .map((column) => column?.key)
    .filter((key): key is string => typeof key === "string");

  return keys.filter((key): key is StandardColumnKey =>
    key === "name" || key === "cluster" || key === "namespace" || key === "actions",
  );
}
