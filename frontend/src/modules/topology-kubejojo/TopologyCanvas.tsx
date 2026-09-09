"use client";

import {
  AimOutlined,
  OneToOneOutlined,
  WarningOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  getNodesBounds,
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
  getKubejojoSelectionPath,
  groupKubejojoGraph,
  layoutKubejojoGraph,
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
} from "./renderers";

type Props = {
  resources: KubejojoResource[];
  relations: KubejojoRelation[];
  groupBy: KubejojoGroupBy;
  focusedId: string | null;
  selectedNodeId: string | null;
  expandAll: boolean;
  includeOverlays?: boolean;
  onFocus: (id: string | null) => void;
  onSelectResource: (selection: KubejojoTopologySelection | null) => void;
  onOpen: (id: string) => void;
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

function countVisibleNodes(node: KubejojoGraphNode): number {
  if (node.collapsed) return node.id === "root" ? 0 : 1;
  return (node.id === "root" ? 0 : 1)
    + (node.nodes ?? []).reduce((total, child) => total + countVisibleNodes(child), 0);
}

function projectCanvasCapacity(
  resources: KubejojoResource[],
  relations: KubejojoRelation[],
  groupBy: KubejojoGroupBy,
  focusedId: string | null,
  expandAll: boolean,
  includeOverlays: boolean,
) {
  const mode = expandAll || Boolean(focusedId) ? "expanded" : "defaultCanvas";
  const renderedNodeLimit = TOPOLOGY_CAPACITY_LIMITS[mode].nodes;
  let resourceNodeBudget: number = renderedNodeLimit;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const projected = applyTopologyCapacity(resources, relations, mode, {
      maxVisibleNodes: resourceNodeBudget,
    });
    const groupedGraph = groupKubejojoGraph(
      projected.resources,
      projected.relations,
      groupBy,
      includeOverlays,
    );
    groupedGraph.capacity = projected.capacity;
    const focusedGroup = findKubejojoNode(groupedGraph, focusedId);
    const graph = collapseKubejojoGraph(groupedGraph, focusedGroup?.id, expandAll);
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
  includeOverlays = false,
  onFocus,
  onSelectResource,
  onOpen,
  fitVersion,
}: Props) {
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const layoutRequest = useRef(0);
  const appliedLayoutRevision = useRef(0);
  const lastFitVersion = useRef(fitVersion);
  const [layout, setLayout] = useState<Layout>({ nodes: [], edges: [] });
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(1.65);
  const [viewMode, setViewMode] = useState<"actual" | "fit" | "custom">("fit");
  const [layoutError, setLayoutError] = useState(false);
  const [layoutRetry, setLayoutRetry] = useState(0);
  const capacityProjection = useMemo(
    () => projectCanvasCapacity(resources, relations, groupBy, focusedId, expandAll, includeOverlays),
    [expandAll, focusedId, groupBy, includeOverlays, relations, resources],
  );
  const { projected, groupedGraph, focusedGroup, graph, renderedNodeCount } = capacityProjection;
  const selectionPath = useMemo(
    () => getKubejojoSelectionPath(groupedGraph, focusedGroup?.id),
    [focusedGroup?.id, groupedGraph],
  );

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
    void layoutKubejojoGraph(graph, aspectRatio)
      .then((next) => {
        if (requestId === layoutRequest.current) {
          setLayout(next);
          setLayoutRevision(requestId);
          setLayoutError(false);
        }
      })
      .catch(() => {
        if (requestId === layoutRequest.current) {
          setLayout({ nodes: [], edges: [] });
          setLayoutError(true);
        }
      });
  }, [aspectRatio, graph, layoutRetry]);

  const showActualSize = useCallback((duration = 180) => {
    setViewMode("actual");
    void flow.setViewport({ x: 20, y: focusedGroup ? 72 : 64, zoom: 1 }, { duration });
  }, [flow, focusedGroup]);

  const fitGraph = useCallback(async (duration = 180) => {
    setViewMode("fit");
    const canvas = canvasRef.current;
    const visibleNodes = flow.getNodes();
    if (!canvas || !visibleNodes.length) {
      await flow.fitView({
        padding: aspectRatio < 0.9 ? 0.16 : 0.08,
        duration,
        minZoom: 0.2,
        maxZoom: 1,
      });
      return;
    }

    // fitView centers short graphs vertically, leaving a large dead band
    // above the first resource row on tall screens. Keep the graph near the
    // top inset while preserving a bounded zoom for large inventories.
    const bounds = getNodesBounds(visibleNodes);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const inset = aspectRatio < 0.9 ? 48 : 28;
    if (width <= 0 || height <= 0 || bounds.width <= 0 || bounds.height <= 0) return;
    const zoom = Math.max(
      0.2,
      Math.min(1, (width - inset * 2) / bounds.width, (height - inset * 2) / bounds.height),
    );
    await flow.setViewport(
      { x: inset - bounds.x * zoom, y: inset - bounds.y * zoom, zoom },
      { duration },
    );
  }, [aspectRatio, flow]);

  useEffect(() => {
    if (!layout.nodes.length || appliedLayoutRevision.current === layoutRevision) return;
    appliedLayoutRevision.current = layoutRevision;
    const frame = requestAnimationFrame(() => {
      if (viewMode === "fit") fitGraph(0);
      else showActualSize(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [fitGraph, layout.nodes.length, layoutRevision, showActualSize, viewMode]);

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
        viewState: !selectedNodeId
          ? "default"
          : node.id === selectedNodeId
            ? "focused"
            : adjacent.has(node.id)
              ? "context"
              : "muted",
      },
    })),
    [adjacent, layout.nodes, selectedNodeId],
  );

  const edges = useMemo(() => {
    const relationById = new Map(projected.relations.map((relation) => [relation.id, relation]));
    return layout.edges.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        route: "elk" as const,
        viewState: edgeViewState(edge.data?.relationIds, relationById, selectedNodeId, adjacent),
      },
    })) as Edge<TopologyRendererEdgeData>[];
  }, [adjacent, layout.edges, projected.relations, selectedNodeId]);
  const handleNodeClick = (node: Node<TopologyRendererNodeData>) => {
    const graphNode = node.data.graphNode;
    if (graphNode.nodes?.length) {
      setViewMode("fit");
      onFocus(graphNode.id);
      onSelectResource(null);
      return;
    }
    const resource = projected.resources.find((item) => item.id === node.id);
    if (!resource) return;
    onSelectResource({
      canvasId: node.id,
      resourceId: resource.aggregation?.representativeId ?? resource.id,
      aggregation: resource.aggregation ?? null,
    });
  };
  return (
    <div className="topology-kubejojo">
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
        <div className="topology-kubejojo__zoom" role="group" aria-label="视图缩放">
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
        </div>
        {selectionPath.length > 1 ? (
          <nav className="topology-kubejojo__focus" aria-label="拓扑层级">
            {selectionPath.map((item, index) => (
              <Fragment key={item.id}>
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {index === selectionPath.length - 1 ? (
                  <span className="topology-kubejojo__focus-label" aria-current="page">
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
          minZoom={0.2}
          maxZoom={1.8}
          panOnDrag
          panOnScroll={false}
          selectionOnDrag={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          onMoveStart={(event) => {
            if (event) setViewMode("custom");
          }}
          onNodeClick={(_, node) => handleNodeClick(node as Node<TopologyRendererNodeData>)}
          onNodeDoubleClick={(_, node) => {
            const resource = projected.resources.find((item) => item.id === node.id);
            if (resource) onOpen(resource.aggregation?.representativeId ?? resource.id);
          }}
          onPaneClick={() => onSelectResource(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--tk-grid)" gap={18} size={1} />
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
