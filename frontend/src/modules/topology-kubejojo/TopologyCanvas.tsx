"use client";

import {
  AimOutlined,
  CompressOutlined,
  ExpandOutlined,
  OneToOneOutlined,
  WarningOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import {
  applyTopologyCapacity,
  collapseKubejojoGraph,
  findKubejojoNode,
  getCenteredTopologyViewport,
  getTopologyViewportFrame,
  getKubejojoSelectionPath,
  groupKubejojoGraph,
  layoutKubejojoGraph,
  isTopologyRootKind,
  projectTopologyDisplayMode,
  TOPOLOGY_CAPACITY_LIMITS,
  type KubejojoGraphNode,
  type KubejojoGroupBy,
  type KubejojoRelation,
  type KubejojoResource,
  type CapacityResourceAggregation,
} from "./engine";
import {
  topologyKubejojoEdgeTypes,
  topologyKubejojoNodeTypes,
  type TopologyRendererEdgeData,
  type TopologyRendererNodeData,
  type TopologyNodeStatus,
} from "./renderers";

type Props = {
  resources: KubejojoResource[];
  relations: KubejojoRelation[];
  groupBy: KubejojoGroupBy;
  focusedId: string | null;
  selectedNodeId: string | null;
  expandAll: boolean;
  displayMode?: "core" | "full";
  onFocus: (id: string | null) => void;
  onCollapseAllStacks?: () => void;
  onSelectResource: (selection: KubejojoTopologySelection | null) => void;
  onOpen: (id: string) => void;
  onNavigate: (id: string) => void;
  onOpenTopologyRoot?: (id: string) => void;
  topologyRootLabel?: string;
  topologyRootKind?: string;
  onExitTopology?: () => void;
  fitVersion: string;
};

export type KubejojoTopologySelection = {
  canvasId: string;
  resourceId: string;
  aggregation: CapacityResourceAggregation | null;
};

type Layout = {
  nodes: Node<TopologyRendererNodeData>[];
  edges: Edge<TopologyRendererEdgeData>[];
};

function layoutBounds(nodes: Node<TopologyRendererNodeData>[]) {
  const topLevel = nodes.filter((node) => !node.parentId);
  if (!topLevel.length) return null;
  const boxes = topLevel.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: Number(node.style?.width ?? node.width ?? 0),
    height: Number(node.style?.height ?? node.height ?? 0),
  })).filter((box) => box.width > 0 && box.height > 0);
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function relationHealth(
  relation: KubejojoRelation | undefined,
  resourceStatusById: Map<string, TopologyNodeStatus>,
): TopologyNodeStatus {
  if (!relation) return "unknown";
  const statuses = [resourceStatusById.get(relation.source), resourceStatusById.get(relation.target)];
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  if (statuses.every((status) => status === "healthy")) return "healthy";
  return "unknown";
}

function aggregateEdgeHealth(statuses: TopologyNodeStatus[]): TopologyNodeStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  if (statuses.length > 0 && statuses.every((status) => status === "healthy")) return "healthy";
  return "unknown";
}

function countVisibleNodes(node: KubejojoGraphNode): number {
  if (node.collapsed) return node.id === "root" ? 0 : 1;
  return (node.id === "root" ? 0 : 1)
    + (node.nodes ?? []).reduce((total, child) => total + countVisibleNodes(child), 0);
}

function collectExpandableStackIds(node: KubejojoGraphNode): string[] {
  const ids: string[] = [];
  if (node.groupKind === "stack" && (node.nodes?.length ?? 0) > 0) ids.push(node.id);
  for (const child of node.nodes ?? []) ids.push(...collectExpandableStackIds(child));
  return ids;
}

function projectCanvasCapacity(
  resources: KubejojoResource[],
  relations: KubejojoRelation[],
  groupBy: KubejojoGroupBy,
  focusedId: string | null,
  expandAll: boolean,
  displayMode: "core" | "full",
  expandedStackIds: ReadonlySet<string>,
) {
  const mode = expandAll || Boolean(focusedId) ? "expanded" : "defaultCanvas";
  const renderedNodeLimit = TOPOLOGY_CAPACITY_LIMITS[mode].nodes;
  const visible = projectTopologyDisplayMode(resources, relations, displayMode);
  let resourceNodeBudget: number = renderedNodeLimit;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const projected = applyTopologyCapacity(visible.resources, visible.relations, mode, {
      maxVisibleNodes: resourceNodeBudget,
    });
    const groupedGraph = groupKubejojoGraph(
      projected.resources,
      projected.relations,
      groupBy,
    );
    groupedGraph.capacity = projected.capacity;
    const focusedGroup = findKubejojoNode(groupedGraph, focusedId);
    const graph = collapseKubejojoGraph(groupedGraph, focusedGroup?.id, expandAll, expandedStackIds);
    const renderedNodeCount = countVisibleNodes(graph);
    if (renderedNodeCount <= renderedNodeLimit) {
      return { projected, groupedGraph, focusedGroup, graph, renderedNodeCount };
    }
    resourceNodeBudget = Math.max(1, resourceNodeBudget - (renderedNodeCount - renderedNodeLimit));
  }

  throw new RangeError(`Topology grouping cannot fit within the ${renderedNodeLimit}-node ${mode} canvas budget.`);
}

function edgeViewState(
  relationIds: string[] | undefined,
  relationById: Map<string, KubejojoRelation>,
  selectedResourceId: string | null,
  adjacent: Set<string>,
) {
  if (!selectedResourceId) return "default" as const;
  const linked = (relationIds ?? []).map((id) => relationById.get(id)).filter(Boolean) as KubejojoRelation[];
  if (linked.some((relation) => relation.source === selectedResourceId || relation.target === selectedResourceId)) return "focused" as const;
  if (linked.some((relation) => adjacent.has(relation.source) || adjacent.has(relation.target))) return "context" as const;
  return "muted" as const;
}

function Canvas({
  resources,
  relations,
  groupBy,
  focusedId,
  selectedNodeId,
  expandAll,
  displayMode = "core",
  onFocus,
  onCollapseAllStacks,
  onSelectResource,
  onOpen,
  onNavigate,
  onOpenTopologyRoot,
  topologyRootLabel,
  topologyRootKind,
  onExitTopology,
  fitVersion,
}: Props) {
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const layoutRequest = useRef(0);
  const appliedLayoutRevision = useRef(0);
  const lastFitVersion = useRef(fitVersion);
  const pendingViewport = useRef<ReturnType<typeof flow.getViewport> | null>(null);
  const previousSceneId = useRef(focusedId);
  const hasLayout = useRef(false);
  const fitNextLayout = useRef(false);
  const [layout, setLayout] = useState<Layout>({ nodes: [], edges: [] });
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(1.65);
  const [viewMode, setViewMode] = useState<"actual" | "fit" | "custom">("fit");
  const [layoutError, setLayoutError] = useState(false);
  const [layoutRetry, setLayoutRetry] = useState(0);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [expandedStackIds, setExpandedStackIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!selectedNodeId && !selectedEdgeId) return;
    const clearOutsideSelection = (event: PointerEvent) => {
      const target = event.target;
      // The drawer backdrop closes details, not the selected relationship.
      if (!(target instanceof Element) || target.closest(".react-flow__node, .react-flow__edge, .ant-drawer")) return;
      setSelectedEdgeId(null);
      onSelectResource(null);
    };
    document.addEventListener("pointerdown", clearOutsideSelection);
    return () => document.removeEventListener("pointerdown", clearOutsideSelection);
  }, [onSelectResource, selectedEdgeId, selectedNodeId]);
  const capacityProjection = useMemo(
    () => projectCanvasCapacity(resources, relations, groupBy, focusedId, expandAll, displayMode, expandedStackIds),
    [displayMode, expandAll, expandedStackIds, focusedId, groupBy, relations, resources],
  );
  const { projected, groupedGraph, focusedGroup, graph, renderedNodeCount } = capacityProjection;
  // Stack cards can be nested below namespace, component, or workload groups.
  // Scan the rendered graph instead of only the currently focused component so
  // the bulk control is available at every canvas level.
  const visibleStackIds = useMemo(
    () => Array.from(new Set([
      ...collectExpandableStackIds(graph),
      ...(focusedGroup?.nodes ?? [])
        .filter((node) => node.groupKind === "stack" && (node.nodes?.length ?? 0) > 0)
        .map((node) => node.id),
    ])),
    [focusedGroup?.nodes, graph],
  );
  const hasExpandedStacks = visibleStackIds.some((id) => expandedStackIds.has(id))
    || (expandAll && visibleStackIds.length > 0);
  const selectionPath = useMemo(
    () => getKubejojoSelectionPath(groupedGraph, focusedGroup?.id),
    [focusedGroup?.id, groupedGraph],
  );
  // Only a drilled-in path is a relationship scene. A focused id can exist
  // briefly while the aggregate canvas is resolving its next layout.
  const isRelationshipScene = selectionPath.some((item) => item.kind === "component");

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const updateAspectRatio = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const next = Math.round((width / height) * 100) / 100;
      setAspectRatio((current) => Math.abs(current - next) >= 0.03 ? next : current);
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateAspectRatio(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    updateAspectRatio(element.clientWidth, element.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const requestId = ++layoutRequest.current;
    const sceneChanged = previousSceneId.current !== focusedId;
    previousSceneId.current = focusedId;
    void layoutKubejojoGraph(graph, aspectRatio)
      .then((next) => {
        if (requestId === layoutRequest.current) {
          const shouldFit = fitNextLayout.current;
          pendingViewport.current = !sceneChanged && hasLayout.current && !shouldFit ? flow.getViewport() : null;
          fitNextLayout.current = false;
          hasLayout.current = next.nodes.length > 0;
          setLayout(next);
          setSelectedEdgeId((current) => current && next.edges.some((edge) => edge.id === current) ? current : null);
          setLayoutRevision(requestId);
          setLayoutError(false);
        }
      })
      .catch(() => {
        if (requestId === layoutRequest.current) {
          hasLayout.current = false;
          setLayout({ nodes: [], edges: [] });
          setLayoutError(true);
        }
      });
  }, [aspectRatio, flow, focusedId, graph, layoutRetry]);

  const showActualSize = useCallback((duration = 180) => {
    setViewMode("actual");
    const canvas = canvasRef.current;
    const bounds = layoutBounds(layout.nodes);
    if (!canvas || !bounds) return;
    const frame = getTopologyViewportFrame(canvas.clientWidth, canvas.clientHeight);
    const viewport = getCenteredTopologyViewport(
      bounds,
      frame.size,
      { zoom: 1, minZoom: 1, maxZoom: 1 },
    );
    if (viewport) void flow.setViewport({ ...viewport, y: viewport.y + frame.offsetY }, { duration });
  }, [flow, layout.nodes]);

  const fitGraph = useCallback(async (duration = 180) => {
    setViewMode("fit");
    const canvas = canvasRef.current;
    const bounds = layoutBounds(layout.nodes);
    if (!canvas || !bounds) {
      await flow.fitView({
        padding: aspectRatio < 0.9 ? 0.16 : 0.08,
        duration,
        minZoom: 0.05,
        maxZoom: 1,
      });
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const compact = aspectRatio < 0.9;
    const inset = compact ? 48 : 28;
    const frame = getTopologyViewportFrame(width, height);
    const viewport = getCenteredTopologyViewport(
      bounds,
      frame.size,
      { minZoom: 0.05, maxZoom: 1, padding: inset },
    );
    if (viewport) await flow.setViewport({ ...viewport, y: viewport.y + frame.offsetY }, { duration });
  }, [aspectRatio, flow, layout.nodes]);

  useEffect(() => {
    if (!layout.nodes.length || appliedLayoutRevision.current === layoutRevision) return;
    appliedLayoutRevision.current = layoutRevision;
    const frame = requestAnimationFrame(() => {
      const viewport = pendingViewport.current;
      pendingViewport.current = null;
      if (viewport) void flow.setViewport(viewport, { duration: 0 });
      else if (viewMode === "fit") fitGraph(0);
      else showActualSize(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [fitGraph, flow, layout.nodes.length, layoutRevision, showActualSize, viewMode]);

  useEffect(() => {
    if (fitVersion === lastFitVersion.current) return;
    lastFitVersion.current = fitVersion;
    const frame = requestAnimationFrame(() => fitGraph());
    return () => cancelAnimationFrame(frame);
  }, [fitGraph, fitVersion]);

  const adjacent = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedNodeId) return ids;
    ids.add(selectedNodeId);
    projected.relations.forEach((relation) => {
      if (relation.source === selectedNodeId) ids.add(relation.target);
      if (relation.target === selectedNodeId) ids.add(relation.source);
    });
    return ids;
  }, [projected.relations, selectedNodeId]);

  const nodes = useMemo(
    () => layout.nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        onOpenResource: onNavigate,
        onToggleStack: (id: string) => {
          fitNextLayout.current = true;
          setViewMode("fit");
          setExpandedStackIds(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        },
        viewState: selectedEdgeId
          ? layout.edges.find((edge) => edge.id === selectedEdgeId && (edge.source === node.id || edge.target === node.id))
            ? "focused"
            : "muted"
          : !selectedNodeId
          ? "default"
          : node.id === selectedNodeId
            ? "focused"
            : adjacent.has(node.id)
              ? "context"
              : "muted",
      },
    })),
    [adjacent, layout.edges, layout.nodes, onNavigate, selectedEdgeId, selectedNodeId],
  );

  const edges = useMemo(() => {
    const relationById = new Map(projected.relations.map((relation) => [relation.id, relation]));
    const resourceStatusById = new Map(projected.resources.map((resource) => [resource.id, resource.status ?? "unknown"]));
    return layout.edges.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        flowActive: Boolean(selectedNodeId && !selectedEdgeId &&
          (edge.data?.relationIds ?? []).some((id) => {
            const relation = relationById.get(id);
            return relation?.source === selectedNodeId || relation?.target === selectedNodeId;
          })),
        labelVisible: layout.edges.length <= 18,
        route: "bezier" as const,
        status: aggregateEdgeHealth(
          (edge.data?.relationIds ?? []).map((id) => relationHealth(relationById.get(id), resourceStatusById)),
        ),
        viewState: selectedEdgeId
          ? edge.id === selectedEdgeId ? "focused" as const : "muted" as const
          : edgeViewState(edge.data?.relationIds, relationById, selectedNodeId, adjacent),
      },
    })) as Edge<TopologyRendererEdgeData>[];
  }, [adjacent, layout.edges, projected.relations, projected.resources, selectedEdgeId, selectedNodeId]);
  const handleNodeClick = (node: Node<TopologyRendererNodeData>) => {
    setSelectedEdgeId(null);
    const graphNode = node.data.graphNode;
    if (graphNode.nodes?.length) {
      if (graphNode.groupKind === "stack") {
        fitNextLayout.current = true;
        setViewMode("fit");
        setExpandedStackIds(current => {
          const next = new Set(current);
          if (next.has(graphNode.id)) next.delete(graphNode.id);
          else next.add(graphNode.id);
          return next;
        });
        return;
      }
      // Every folded card advertises 进入, so every folded card must enter.
      // Headlamp selects the group and promotes it to the root of the scene;
      // refusing scope/isolated groups left the affordance dead.
      setViewMode("fit");
      onFocus(graphNode.id);
      onSelectResource(null);
      return;
    }
    const resource = projected.resources.find((item) => item.id === node.id);
    if (!resource) return;
    if (onOpenTopologyRoot && isTopologyRootKind(resource.kind)) {
      onOpenTopologyRoot(resource.aggregation?.representativeId ?? resource.id);
    }
    onSelectResource({
      canvasId: node.id,
      resourceId: resource.aggregation?.representativeId ?? resource.id,
      aggregation: resource.aggregation ?? null,
    });
    onOpen(resource.aggregation?.representativeId ?? resource.id);
  };
  return (
    <div className={`topology-kubejojo${selectionPath.length > 1 ? " is-focused-scene" : ""}`}>
      <div ref={canvasRef} className="topology-kubejojo__canvas">
        {!projected.capacity.complete ? (
          <div
            className="topology-kubejojo__capacity"
            role="status"
            aria-live="polite"
          >
            <WarningOutlined aria-hidden="true" />
            <span>
              当前图已将 {projected.capacity.input.nodes} 个资源、{projected.capacity.input.edges} 条关系聚合为 {renderedNodeCount} 个画布节点、{projected.capacity.visible.edges} 条连线；聚合节点完整保留成员计数，可缩小筛选范围查看明细。
            </span>
          </div>
        ) : null}
        {layoutError ? (
          <div className="topology-kubejojo__layout-error" role="alert">
            <WarningOutlined aria-hidden="true" />
            <span>拓扑布局计算失败。</span>
            <button
              type="button"
              onClick={() => {
                setLayoutError(false);
                setLayoutRetry((value) => value + 1);
              }}
            >
              重试
            </button>
          </div>
        ) : null}
        {isRelationshipScene ? <div className="topology-kubejojo__zoom topology-kubejojo__controls" role="toolbar" aria-label="拓扑视图工具栏">
          <button type="button" aria-label="缩小" onClick={() => { setViewMode("custom"); void flow.zoomOut({ duration: 180 }); }}>
            <ZoomOutOutlined />
          </button>
          <button type="button" aria-label="放大" onClick={() => { setViewMode("custom"); void flow.zoomIn({ duration: 180 }); }}>
            <ZoomInOutlined />
          </button>
          <button
            type="button"
            className={viewMode === "actual" ? "is-active" : undefined}
            aria-label="按百分之百显示"
            aria-pressed={viewMode === "actual"}
            title="100%"
            onClick={() => showActualSize()}
          >
            <OneToOneOutlined />
            <span>100%</span>
          </button>
          <button
            type="button"
            className={viewMode === "fit" ? "is-active" : undefined}
            aria-label="适配全图"
            aria-pressed={viewMode === "fit"}
            title="适配全图"
            onClick={() => fitGraph()}
          >
            <AimOutlined />
            <span>适配全图</span>
          </button>
          {visibleStackIds.length ? (
            <button
              type="button"
              className={`topology-kubejojo__collapse-all${hasExpandedStacks ? " is-active" : ""}`}
              aria-label={`${hasExpandedStacks ? "折叠" : "展开"}所有资源堆叠`}
              aria-pressed={hasExpandedStacks}
              title={`${hasExpandedStacks ? "折叠" : "展开"}所有资源堆叠`}
              onClick={() => {
                fitNextLayout.current = true;
                setViewMode("fit");
                if (hasExpandedStacks) {
                  setExpandedStackIds((current) => {
                    const next = new Set(current);
                    visibleStackIds.forEach((id) => next.delete(id));
                    return next;
                  });
                  onCollapseAllStacks?.();
                  return;
                }
                setExpandedStackIds((current) => new Set([...current, ...visibleStackIds]));
              }}
            >
              {hasExpandedStacks ? <CompressOutlined /> : <ExpandOutlined />}
              <span>{hasExpandedStacks ? "折叠全部" : "展开全部"}</span>
            </button>
          ) : null}
        </div> : null}
        {topologyRootLabel ? (
          <nav className="topology-kubejojo__focus topology-kubejojo__resource-path" aria-label="资源拓扑路径">
            <button
              type="button"
              className="topology-kubejojo__resource-path-back"
              onClick={() => {
                setViewMode("fit");
                onExitTopology?.();
              }}
            >
              资源拓扑
            </button>
            <span aria-hidden="true">/</span>
            <span className="topology-kubejojo__focus-label" aria-current={!selectionPath.some((item) => item.id !== "root") ? "page" : undefined}>
              <span className="topology-kubejojo__resource-path-kind">{topologyRootKind ?? "工作负载"}</span>
              <strong>{topologyRootLabel}</strong>
            </span>
            {selectionPath.filter((item) => item.id !== "root").map((item, index, path) => (
              <Fragment key={item.id}>
                <span aria-hidden="true">/</span>
                {index === path.length - 1 ? (
                  <span className="topology-kubejojo__focus-label" aria-current={index === path.length - 1 ? "page" : undefined}>
                    <strong>{item.label}</strong>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode("fit");
                      onFocus(item.id);
                      onSelectResource(null);
                    }}
                  >
                    {item.label}
                  </button>
                )}
              </Fragment>
            ))}
            <span className="topology-kubejojo__focus-count">
              {selectionPath.at(-1)?.resourceCount ?? 0} 个资源
            </span>
          </nav>
        ) : selectionPath.length > 1 ? (
          <nav className="topology-kubejojo__focus" aria-label="拓扑层级">
            {selectionPath.map((item, index) => (
              <Fragment key={item.id}>
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {index === selectionPath.length - 1 ? (
                  <span className="topology-kubejojo__focus-label" aria-current={index === selectionPath.length - 1 ? "page" : undefined}>
                    <strong>{item.label}</strong>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const nextFocus = item.id === "root" ? null : item.id;
                      setViewMode("fit");
                      onFocus(nextFocus);
                      onSelectResource(null);
                    }}
                  >
                    {item.id === "root" ? "全局" : item.label}
                  </button>
                )}
              </Fragment>
            ))}
            <span className="topology-kubejojo__focus-count">
              {selectionPath.at(-1)?.resourceCount ?? 0} 个资源
            </span>
          </nav>
        ) : null}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={topologyKubejojoNodeTypes}
          edgeTypes={topologyKubejojoEdgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          onlyRenderVisibleElements
          minZoom={0.05}
          maxZoom={1.8}
          panOnDrag
          panOnScroll={false}
          selectionOnDrag={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          onMoveStart={(event) => {
            // A plain press on a node also opens a d3-zoom gesture, but it does
            // not move the viewport. Treating it as a manual move flips the view
            // out of fit mode, and the selection strip's resize then re-layouts
            // straight to 100% and clips the graph.
            if (!event) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest?.(".react-flow__node")) return;
            setViewMode("custom");
          }}
          onNodeClick={(_, node) => handleNodeClick(node as Node<TopologyRendererNodeData>)}
          onNodeDoubleClick={(_, node) => {
            const resource = projected.resources.find((item) => item.id === node.id);
            if (resource) onOpen(resource.aggregation?.representativeId ?? resource.id);
          }}
          onEdgeClick={(_, edge) => {
            setSelectedEdgeId(edge.id);
          }}
          onPaneClick={() => {
            setSelectedEdgeId(null);
            onSelectResource(null);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} color="var(--tk-grid)" gap={22} size={1.2} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function KubejojoTopologyCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
