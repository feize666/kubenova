// Run: node scripts/check-topology-interactions.mjs
// Exercise the real TSX event handlers without starting a browser or API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const jsx = (type, props) => ({ type, props });
const state = [];
const react = {
  memo: (component) => component,
  useCallback: (callback) => callback,
  useMemo: (callback) => callback(),
  useState: (initial) => {
    const index = state.push(typeof initial === "function" ? initial() : initial) - 1;
    return [state[index], (next) => {
      state[index] = typeof next === "function" ? next(state[index]) : next;
    }];
  },
};
function loadComponent(path, mocks) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const compiled = { exports: {} };
  const imports = { react, "react/jsx-runtime": { jsx, jsxs: jsx }, ...mocks };
  new Function("require", "module", "exports", outputText)(
    (name) => Object.hasOwn(imports, name) ? imports[name] : require(name),
    compiled, compiled.exports,
  );
  return compiled.exports;
}
function find(element, predicate) {
  if (!element || typeof element !== "object") return undefined;
  if (predicate(element)) return element;
  return [element.props?.children].flat(Infinity).map((child) => find(child, predicate)).find(Boolean);
}

const navigation = [];
const { TopologyObjectNode } = loadComponent("modules/topology-kubejojo/renderers/TopologyNodes.tsx", {
  "@xyflow/react": { Position: { Top: "top", Bottom: "bottom" }, Handle: "handle" },
  "@ant-design/icons": {},
  "../kind": { normalizeTopologyKind: (kind) => kind },
});
const card = TopologyObjectNode({ data: {
  graphNode: { id: "pod", label: "example-pod", resource: { id: "pod", kind: "Pod", name: "example-pod" } },
  onOpenResource: (id) => navigation.push(id),
} });
const name = find(card, (element) => element.props?.role === "link");
assert.ok(name, "resource name must expose a separate link");
let stopped = false;
name.props.onClick({ stopPropagation: () => { stopped = true; } });
assert.equal(stopped, true, "name clicks must not bubble into the detail-card handler");
assert.deepEqual(navigation, ["pod"]);
let opens = 0;
const cardTarget = { click: () => { opens++; } };
card.props.onKeyDown({ key: "Enter", target: {}, currentTarget: cardTarget });
assert.equal(opens, 0, "Enter on the inner name must not activate the outer card");
card.props.onKeyDown({ key: "Enter", target: cardTarget, currentTarget: cardTarget, preventDefault() {} });
assert.equal(opens, 1, "the card itself remains keyboard accessible");

const request = { kind: "Service", id: "cluster/namespace/service", name: "service" };
const { ResourceDetailDrawer } = loadComponent("components/resource-detail/resource-detail-drawer.tsx", {
  "@ant-design/icons": {},
  antd: { Space: "space", Typography: {} },
  "@tanstack/react-query": { useQuery: ({ queryKey }) => ({ data: queryKey[1] === "clusters"
    ? { items: [] } : { overview: { kind: "Service", name: "service" } } }) },
  "@/lib/api/clusters": {},
  "@/lib/api/resources": {},
  "@/components/ops": { OpsDrawerShell: "drawer", OpsIconActionButton: "action" },
  "@/components/resource-yaml-drawer": {},
  "./renderers": { ResourceDetailContent: "content" },
  "./utils": { normalizeKind: (kind) => kind.toLowerCase(), getRenderProfile: () => ({ title: "Service" }) },
  "@/app/clusters/[clusterId]/resource/[kind]/[...id]/detail-config": {},
});
const targets = [];
const drawer = ResourceDetailDrawer({ open: true, request, onClose() {}, onNavigateRequest: (next) => targets.push(next) });
const content = find(drawer, (element) => element.type === "content");
content.props.onNavigateRequest(request);
assert.deepEqual(targets, [request], "clicking the current resource title must reach the owning page");
assert.equal(state[0], null, "the current title must not create a duplicate drawer history entry");
const related = { kind: "Pod", id: "cluster/namespace/pod", name: "pod" };
content.props.onNavigateRequest(related);
assert.deepEqual(targets, [request, related]);
assert.deepEqual(state[0].stack, [request], "related-resource navigation must retain drawer history");
console.log("PASS: topology name/card keyboard separation and drawer title/related-resource navigation");
