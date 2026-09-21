import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../../app/network/topology/page.tsx", import.meta.url), "utf8");
const topologyCss = readFileSync(new URL("../../app/topology-kubejojo.css", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("./engine/index.ts", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("./TopologyCanvas.tsx", import.meta.url), "utf8");
const clusterWorkspaceSource = readFileSync(new URL("../../components/cluster-workspace-shell.tsx", import.meta.url), "utf8");
const sourceFilterSource = readFileSync(new URL("../../components/topology-source-filter.tsx", import.meta.url), "utf8");

test("focused resource topology exposes an immersive page state", () => {
  assert.match(pageSource, /resource-map-shell--focused/);
  assert.match(topologyCss, /\.resource-map-shell--workbench\s*\{[^}]*display:\s*flex/);
});

test("topology canvas fills the remaining workbench without a fixed height floor", () => {
  assert.match(
    topologyCss,
    /\.resource-map-shell--workbench \.resource-map-canvas,\s*\.topology-kubejojo,\s*\.topology-kubejojo__canvas\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/,
  );
});

test("topology layout keeps the Headlamp-style horizontal spine", () => {
  assert.match(topologyCss, /stroke-linecap:\s*round/);
  assert.match(engineSource, /import dagre from "@dagrejs\/dagre"/);
  assert.match(engineSource, /rankdir:\s*"LR"/);
  assert.match(engineSource, /algorithm:\s*hasEdges \? "dagre"/);
});

test("focused scenes use theme tokens and keep relationship paths visually smooth", () => {
  assert.match(topologyCss, /\.topology-kubejojo\.is-focused-scene/);
  assert.match(topologyCss, /stroke-linecap:\s*round/);
  assert.match(topologyCss, /\[data-theme="dark"\] \.topology-kubejojo/);
  assert.match(topologyCss, /\[data-theme="dark"\] \.topology-kubejojo__node:hover \.topology-kubejojo__node-card/);
  assert.match(topologyCss, /--tk-highlight/);
});

test("topology detail drawer uses the current Ant Design sizing API", () => {
  assert.match(pageSource, /<Drawer[\s\S]*size=\{440\}/);
  assert.doesNotMatch(pageSource, /<Drawer[\s\S]*width=\{440\}/);
});

test("namespace is a filter context and workload resources are the only topology entry points", () => {
  assert.match(pageSource, /isTopologyRootKind/);
  assert.match(pageSource, /选择工作负载查看资源拓扑/);
  assert.match(pageSource, /Deployment、StatefulSet、DaemonSet、Job 或 CronJob/);
  assert.doesNotMatch(pageSource, /projectTopologyNeighborhood/);
  assert.doesNotMatch(pageSource, /setNeighborhoodResourceId/);
  assert.match(topologyCss, /resource-map-canvas-state\.topology-root-picker-state\s*\{[^}]*position:\s*relative/);
  assert.match(topologyCss, /resource-map-canvas-state\.topology-root-picker-state\s*\{[^}]*max-width:\s*none/);
});

test("canvas does not turn scope or isolated aggregates into topology scenes", () => {
  assert.match(canvasSource, /graphNode\.groupKind === "scope" \|\| graphNode\.groupKind === "isolated"/);
  assert.match(canvasSource, /onOpenTopologyRoot\?:/);
  assert.match(canvasSource, /isTopologyRootKind\(resource\.kind\)/);
  assert.match(pageSource, /displayMode=\{topologyDisplayMode\}/);
  assert.match(pageSource, /核心链路/);
  assert.match(pageSource, /完整关联/);
  assert.doesNotMatch(pageSource, /链路中/);
  assert.doesNotMatch(pageSource, /完整链路/);
  assert.match(canvasSource, /item\.kind === "scope"/);
});

test("namespace scope control uses a direct option list instead of a nested select", () => {
  const scopeSource = readFileSync(new URL("../../components/resource-scope-filter-button.tsx", import.meta.url), "utf8");
  const namespaceSource = readFileSync(new URL("../../components/namespace-select.tsx", import.meta.url), "utf8");
  assert.match(scopeSource, /isWorkspaceLocked[\s\S]*<NamespaceSelect/);
  assert.match(namespaceSource, /export function NamespaceFilterSelect/);
  assert.match(namespaceSource, /className="namespace-filter-select__label"/);
  assert.match(namespaceSource, /classNames=\{\{ popup: \{ root: "namespace-filter-select-dropdown"/);
  assert.match(namespaceSource, /showSearch/);
  assert.match(namespaceSource, /全部命名空间/);
  assert.match(globalCss, /\.namespace-filter-select \.ant-select-content,[\s\S]*display:\s*flex\s*!important/);
  assert.match(globalCss, /\.namespace-filter-select \.ant-select-prefix,[\s\S]*height:\s*30px/);
  assert.match(globalCss, /\.namespace-filter-select__label[\s\S]*line-height:\s*21px/);
});

test("topology toolbar uses the shared VKE-style namespace filter and compact controls", () => {
  const namespaceSource = readFileSync(new URL("../../components/namespace-select.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /<NamespaceFilterSelect/);
  assert.doesNotMatch(pageSource, /aria-label="选择命名空间"[\s\S]{0,500}<\/Select>/);
  assert.match(pageSource, /resource-map-toolbar__primary/);
  assert.match(pageSource, /resource-map-toolbar__secondary/);
  assert.doesNotMatch(pageSource, /已显示|已隐藏/);
  assert.match(namespaceSource, /filterOption=/);
  assert.match(namespaceSource, /popupMatchSelectWidth/);
});

test("namespace stays a filter context and is not offered as a visual grouping", () => {
  const groupOptions = pageSource.match(/const GROUP_OPTIONS[\s\S]*?;\n\nconst KIND_LABEL/);
  assert.ok(groupOptions, "topology grouping options should be explicit");
  assert.match(groupOptions[0], /value: "instance"/);
  assert.match(groupOptions[0], /value: "node"/);
  assert.doesNotMatch(groupOptions[0], /value:\s*"namespace"/);
  // Fit/zoom lives in the canvas control rail; avoid a second, conflicting
  // fit action in the page toolbar.
  assert.doesNotMatch(pageSource, /aria-label="适配拓扑视图"/);
});

test("topology source filter follows Headlamp's single-entry selection pattern", () => {
  assert.match(pageSource, /<TopologySourceFilter/);
  assert.doesNotMatch(pageSource, /resource-map-source-chips[\s\S]*map\(\(source\)/);
  assert.match(sourceFilterSource, /<Popover/);
  assert.match(sourceFilterSource, /<Checkbox/);
  assert.match(sourceFilterSource, /资源域/);
  assert.match(sourceFilterSource, /selectedCount/);
});

test("cluster scoped resource pages do not render an empty namespace scope slot", () => {
  const filterSource = readFileSync(new URL("../../components/resource-cluster-namespace-filters.tsx", import.meta.url), "utf8");
  assert.match(filterSource, /const showScopeControl = !workspace \|\| namespaceVisible/);
  assert.match(filterSource, /\{showScopeControl \? \(/);
  assert.match(filterSource, /if \(!showScopeControl && !showKeywordSearch && !extraFilters\) return null/);
});

test("cluster workspace follows the active theme instead of forcing a light sider", () => {
  assert.match(clusterWorkspaceSource, /useThemeMode/);
  assert.match(clusterWorkspaceSource, /theme=\{mode\}/);
  assert.doesNotMatch(clusterWorkspaceSource, /theme="light"/);
  assert.match(globalCss, /\[data-theme="dark"\] \.cluster-workspace-shell__sidebar/);
  assert.match(globalCss, /\.cluster-workspace-menu\.ant-menu-dark/);
});

test("legacy topology chips keep readable dark-theme surfaces", () => {
  assert.match(globalCss, /\[data-theme="dark"\] \.topology-mode-card__chip/);
  assert.match(globalCss, /\[data-theme="dark"\] \.topology-name-trigger/);
  assert.match(globalCss, /\[data-theme="dark"\] \.topology-risk-chip--high/);
});
