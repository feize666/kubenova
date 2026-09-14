"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ThHTMLAttributes,
} from "react";
import type { ColumnType, ColumnsType, TableProps } from "antd/es/table";

export const RESOURCE_TABLE_WIDTHS_STORAGE_PREFIX = "resource-table-widths:";

export type ResourceTableColumnWidthMap = Record<string, number>;

type ResizableHeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  baseComponent?: ElementType;
  maxWidth?: number;
  minWidth?: number;
  onReset?: () => void;
  onResize?: (width: number) => void;
  resizeLabel?: string;
  width?: number | string;
};

function toFiniteWidth(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function clampWidth(value: number, minWidth = 96, maxWidth = 520): number {
  return Math.min(Math.max(Math.round(value), minWidth), maxWidth);
}

function getHeaderWidth(
  width: number | string | undefined,
  element: HTMLElement | null,
): number {
  return (
    toFiniteWidth(width) ??
    (element ? Math.round(element.getBoundingClientRect().width) : undefined) ??
    160
  );
}

/**
 * Ant Design's header cell receives the extra resize props returned by
 * `column.onHeaderCell`. Keeping the handle inside the cell means the table
 * keeps ownership of sorting, sticky columns, and keyboard navigation.
 */
export const ResizableHeaderCell = forwardRef<HTMLTableCellElement, ResizableHeaderCellProps>(
  function ResizableHeaderCell(
    {
      children,
      baseComponent,
      className,
      maxWidth = 520,
      minWidth = 96,
      onReset,
      onResize,
      resizeLabel,
      style,
      width,
      ...restProps
    },
    ref,
  ) {
    const cleanupRef = useRef<(() => void) | null>(null);
    const numericWidth = toFiniteWidth(width);

    useEffect(() => {
      return () => {
        cleanupRef.current?.();
      };
    }, []);

    const resizeTo = useCallback(
      (nextWidth: number) => {
        onResize?.(clampWidth(nextWidth, minWidth, maxWidth));
      },
      [maxWidth, minWidth, onResize],
    );

    const handlePointerDown = useCallback(
      (event: ReactPointerEvent<HTMLSpanElement>) => {
        if (!onResize || event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        cleanupRef.current?.();

        const handle = event.currentTarget;
        const header = handle.closest("th");
        const startX = event.clientX;
        const startWidth = getHeaderWidth(width, header);

        const finish = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          document.body.classList.remove("resource-table-is-resizing");
          cleanupRef.current = null;
        };
        const move = (moveEvent: PointerEvent) => {
          resizeTo(startWidth + moveEvent.clientX - startX);
        };

        cleanupRef.current = finish;
        document.body.classList.add("resource-table-is-resizing");
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
        handle.setPointerCapture?.(event.pointerId);
      },
      [onResize, resizeTo, width],
    );

    const handleKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLSpanElement>) => {
        if (!onResize) {
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          const currentWidth = numericWidth ?? 160;
          resizeTo(currentWidth + (event.key === "ArrowRight" ? 16 : -16));
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          event.stopPropagation();
          resizeTo(event.key === "Home" ? minWidth : maxWidth);
        }
      },
      [maxWidth, minWidth, numericWidth, onResize, resizeTo],
    );

    const HeaderComponent = baseComponent ?? "th";

    return (
      <HeaderComponent
        {...restProps}
        ref={ref}
        className={[className, onResize ? "resource-table-resizable-header-cell" : undefined]
          .filter(Boolean)
          .join(" ")}
        style={{
          ...style,
          position: style?.position ?? "relative",
        } as CSSProperties}
      >
        {children}
        {onResize ? (
          <span
            aria-label={resizeLabel ?? "调整列宽"}
            aria-valuemax={maxWidth}
            aria-valuemin={minWidth}
            aria-valuenow={numericWidth}
            aria-orientation="vertical"
            className="resource-table-resize-handle"
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onReset?.();
            }}
            onKeyDown={handleKeyDown}
            onPointerDown={handlePointerDown}
            role="separator"
            tabIndex={0}
            title="拖动调整列宽，双击恢复默认"
          />
        ) : null}
      </HeaderComponent>
    );
  },
);

ResizableHeaderCell.displayName = "ResizableHeaderCell";

function readStoredWidths(storageKey: string | undefined): ResourceTableColumnWidthMap {
  if (typeof window === "undefined" || !storageKey) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.entries(parsed as Record<string, unknown>).reduce<ResourceTableColumnWidthMap>(
      (result, [key, value]) => {
        const width = toFiniteWidth(value);
        if (width && width >= 40 && width <= 1000) {
          result[key] = width;
        }
        return result;
      },
      {},
    );
  } catch {
    return {};
  }
}

function writeStoredWidths(storageKey: string | undefined, widths: ResourceTableColumnWidthMap) {
  if (typeof window === "undefined" || !storageKey) {
    return;
  }
  try {
    if (Object.keys(widths).length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    // A blocked or full localStorage must not make a resource list unusable.
  }
}

function getColumnIdentity<T extends object>(column: NonNullable<ColumnsType<T>[number]>): string {
  const key = (column as { key?: unknown }).key;
  if (typeof key === "string" || typeof key === "number") {
    return `key:${String(key)}`;
  }
  const dataIndex = (column as { dataIndex?: unknown }).dataIndex;
  if (typeof dataIndex === "string" || typeof dataIndex === "number") {
    return `data:${String(dataIndex)}`;
  }
  if (Array.isArray(dataIndex) && dataIndex.length > 0) {
    return `data:${dataIndex.map(String).join(".")}`;
  }
  const title = (column as { title?: unknown }).title;
  if (typeof title === "string" || typeof title === "number") {
    return `title:${String(title)}`;
  }
  return "";
}

function getColumnText<T extends object>(column: NonNullable<ColumnsType<T>[number]>): string {
  const identity = getColumnIdentity(column);
  const title = (column as { title?: unknown }).title;
  return `${identity} ${typeof title === "string" || typeof title === "number" ? String(title) : ""}`
    .trim()
    .toLowerCase();
}

function getWidthBounds<T extends object>(column: NonNullable<ColumnsType<T>[number]>) {
  const identity = getColumnText(column);
  if (/(action|actions|operation|operations|quick-actions|操作)/i.test(identity)) {
    return { minWidth: 76, maxWidth: 220 };
  }
  if (/(name|resourcename|title|名称|资源名称|原始名称)/i.test(identity)) {
    return { minWidth: 160, maxWidth: 560 };
  }
  return { minWidth: 96, maxWidth: 520 };
}

function makeUniqueColumnKey<T extends object>(
  column: NonNullable<ColumnsType<T>[number]>,
  path: string,
  seen: Map<string, number>,
): string {
  const base = getColumnIdentity(column) || `column:${path}`;
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}:${count}`;
}

function deriveWidthStorageKey<T extends object>(
  tableKey: string | undefined,
  columns: ColumnsType<T>,
): string {
  if (tableKey) {
    return `${RESOURCE_TABLE_WIDTHS_STORAGE_PREFIX}${tableKey}`;
  }
  const identities: string[] = [];
  const seen = new Map<string, number>();
  const collect = (items: ColumnsType<T>, path: string) => {
    items.forEach((column, index) => {
      if (!column || typeof column !== "object") return;
      if ("children" in column && column.children) {
        collect(column.children as ColumnsType<T>, `${path}.${index}`);
        return;
      }
      identities.push(makeUniqueColumnKey(column as ColumnType<T>, `${path}.${index}`, seen));
    });
  };
  collect(columns, "root");
  const route = typeof window === "undefined" ? "server" : window.location.pathname;
  return `${RESOURCE_TABLE_WIDTHS_STORAGE_PREFIX}${route}:${identities.join("|")}`;
}

export function useResizableResourceTableColumns<T extends object>(
  columns: ColumnsType<T>,
  tableKey?: string,
) {
  const storageKey = useMemo(
    () => deriveWidthStorageKey(tableKey, columns),
    [columns, tableKey],
  );
  const [widthsByStorageKey, setWidthsByStorageKey] = useState<
    Record<string, ResourceTableColumnWidthMap>
  >({});
  const hasStoredState = Object.prototype.hasOwnProperty.call(widthsByStorageKey, storageKey);
  const widths = useMemo(
    () => (hasStoredState ? widthsByStorageKey[storageKey] ?? {} : readStoredWidths(storageKey)),
    [hasStoredState, storageKey, widthsByStorageKey],
  );

  useEffect(() => {
    if (!hasStoredState) return;
    writeStoredWidths(storageKey, widths);
  }, [hasStoredState, storageKey, widths]);

  const updateWidths = useCallback(
    (updater: (previous: ResourceTableColumnWidthMap) => ResourceTableColumnWidthMap) => {
      setWidthsByStorageKey((previousByKey) => {
        const previous = Object.prototype.hasOwnProperty.call(previousByKey, storageKey)
          ? previousByKey[storageKey] ?? {}
          : readStoredWidths(storageKey);
        const next = updater(previous);
        return next === previous ? previousByKey : { ...previousByKey, [storageKey]: next };
      });
    },
    [storageKey],
  );

  const columnKeys = useMemo(() => {
    const seen = new Map<string, number>();
    const map = new Map<string, NonNullable<ColumnsType<T>[number]>>();
    const collect = (items: ColumnsType<T>, path: string) => {
      items.forEach((column, index) => {
        if (!column || typeof column !== "object") return;
        if ("children" in column && column.children) {
          collect(column.children as ColumnsType<T>, `${path}.${index}`);
          return;
        }
        const key = makeUniqueColumnKey(column as ColumnType<T>, `${path}.${index}`, seen);
        map.set(key, column as ColumnType<T>);
      });
    };
    collect(columns, "root");
    return map;
  }, [columns]);

  const resizeColumn = useCallback(
    (key: string, nextWidth: number) => {
      const column = columnKeys.get(key);
      if (!column) return;
      const bounds = getWidthBounds(column);
      const clamped = clampWidth(nextWidth, bounds.minWidth, bounds.maxWidth);
      updateWidths((previous) => (previous[key] === clamped ? previous : { ...previous, [key]: clamped }));
    },
    [columnKeys, updateWidths],
  );

  const resetColumnWidth = useCallback((key: string) => {
    updateWidths((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }, [updateWidths]);

  const resetColumnWidths = useCallback(() => {
    updateWidths(() => ({}));
  }, [updateWidths]);

  const resizableColumns = useMemo<ColumnsType<T>>(() => {
    const seen = new Map<string, number>();
    const mapColumns = (items: ColumnsType<T>, path: string): ColumnsType<T> =>
      items.map((column, index) => {
        if (!column || typeof column !== "object") return column;
        if ("children" in column && column.children) {
          return {
            ...column,
            children: mapColumns(column.children as ColumnsType<T>, `${path}.${index}`),
          };
        }

        const baseColumn = column as ColumnType<T>;
        const key = makeUniqueColumnKey(column, `${path}.${index}`, seen);
        const bounds = getWidthBounds(column);
        const width = widths[key] ?? toFiniteWidth(baseColumn.width);
        const baseOnHeaderCell = baseColumn.onHeaderCell;
        return {
          ...baseColumn,
          ...(width ? { width } : {}),
          onHeaderCell: (headerColumn: ColumnType<T>) => {
            const baseProps = baseOnHeaderCell?.(headerColumn as never) ?? {};
            return {
              ...baseProps,
              maxWidth: bounds.maxWidth,
              minWidth: bounds.minWidth,
              onReset: () => resetColumnWidth(key),
              onResize: (nextWidth: number) => resizeColumn(key, nextWidth),
              resizeLabel: `${typeof baseColumn.title === "string" ? baseColumn.title : "当前"}列宽`,
              width,
            } as typeof baseProps & ResizableHeaderCellProps;
          },
        };
      });
    return mapColumns(columns, "root");
  }, [columns, resetColumnWidth, resizeColumn, widths]);

  return {
    columns: resizableColumns,
    resetColumnWidths,
    storageKey,
  };
}

export function withResizableHeaderCell<T extends object>(
  components: TableProps<T>["components"] | undefined,
) {
  const baseCell = components?.header?.cell;
  const HeaderCell = baseCell
    ? forwardRef<HTMLTableCellElement, ResizableHeaderCellProps>(function ResizableHeaderCellWithBase(props, ref) {
        return <ResizableHeaderCell {...props} ref={ref} baseComponent={baseCell as ElementType} />;
      })
    : ResizableHeaderCell;

  return {
    ...components,
    header: {
      ...(components?.header ?? {}),
      cell: HeaderCell,
    },
  } as NonNullable<TableProps<T>["components"]>;
}
