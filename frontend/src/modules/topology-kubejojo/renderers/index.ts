import type { EdgeTypes, NodeTypes } from "@xyflow/react";

import { TopologyEdge } from "./TopologyEdge";
import { TopologyGroupNode, TopologyObjectNode } from "./TopologyNodes";

export * from "./contracts";
export { TopologyEdge } from "./TopologyEdge";
export { TopologyGroupNode, TopologyObjectNode } from "./TopologyNodes";

export const topologyKubejojoNodeTypes: NodeTypes = {
  topologyObject: TopologyObjectNode,
  topologyGroup: TopologyGroupNode,
};

export const topologyKubejojoEdgeTypes: EdgeTypes = {
  topologyEdge: TopologyEdge,
};
