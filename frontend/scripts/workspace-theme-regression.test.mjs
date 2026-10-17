import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const antd = require("antd");
const icons = require("@ant-design/icons");
const { chromium } = require("playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");

// Compile real render functions without importing auth, queries or runtime
// overlays. All rendered UI primitives are the production AntD components.
function sourceFile(path) {
  return ts.createSourceFile(path, readFileSync(resolve(root, path), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function compile(source, exports, dependencies) {
  const js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${js}\nreturn { ${exports.join(", ")} };`)(...Object.values(dependencies));
}

function functions(file, names, dependencies) {
  const nodes = file.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(nodes.length, names.length, "production render functions must be available");
  return compile(nodes.map((node) => node.getText(file).replace(/^export /, "")).join("\n"), names, dependencies);
}

const dependencies = {
  React,
  Button: antd.Button, Tooltip: antd.Tooltip, Space: antd.Space,
  Empty: antd.Empty, Typography: antd.Typography,
  ContainerOutlined: icons.ContainerOutlined, CopyOutlined: icons.CopyOutlined,
  ArrowLeftOutlined: icons.ArrowLeftOutlined, NodeIndexOutlined: icons.NodeIndexOutlined,
};
const detail = functions(sourceFile("src/app/clusters/[clusterId]/resource/[kind]/[...id]/detail-config.tsx"), ["ContainersTabContent", "DataTabContent"], dependencies);
const { OpsIconActionButton } = functions(sourceFile("src/components/ops/ops-button.tsx"), ["OpsIconActionButton"], dependencies);
const shell = sourceFile("src/components/cluster-workspace-shell.tsx");
let brand;
function findBrand(node) {
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.text === "className" && attr.initializer?.text === "cluster-workspace-brand")) brand = node;
  ts.forEachChild(node, findBrand);
}
findBrand(shell);
assert.ok(brand, "production workspace brand must be available");
const { RenderBrand } = compile(`function RenderBrand({ collapsed, clusterName, router }) { return (${brand.getText(shell)}); }`, ["RenderBrand"], { ...dependencies, OpsIconActionButton });
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined }); });
after(async () => { await browser?.close(); });

async function fixture(page, mode, collapsed = false) {
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement("aside", { className: `app-sidebar ant-layout-sider${collapsed ? " ant-layout-sider-collapsed" : ""}`, style: { width: collapsed ? 72 : 224 } },
      React.createElement(RenderBrand, { collapsed, clusterName: "fixture-cluster", router: { push() { throw new Error("fixture must not navigate"); } } })),
    React.createElement("section", { id: "containers" }, React.createElement(detail.ContainersTabContent, { detail: { runtime: { containerDetails: [{ name: "web", env: [{ name: "MODE", value: "test" }, { name: "SECRET", valueFrom: { secretKeyRef: { name: "test", key: "value" } } }] }] } } })),
    React.createElement("section", { id: "data" }, React.createElement(detail.DataTabContent, { detail: { rawSpec: { data: { config: "fixture-value" } } } })),
    React.createElement("div", { id: "surface-probe", style: { background: "var(--kn-surface-subtle)" } }),
    React.createElement("div", { id: "text-probe", style: { color: "var(--kn-text)" } }),
  ));
  await page.setContent(`<html data-theme="${mode}"><head><style>${css}</style></head><body>${markup}</body></html>`);
}

test("container environment and Data surfaces follow both theme palettes", async () => {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  try {
    const backgrounds = [];
    for (const mode of ["dark", "light"]) {
      await fixture(page, mode);
      const styles = await page.evaluate(() => {
        const envLabel = [...document.querySelectorAll("#containers .ant-typography")].find((node) => node.textContent.startsWith("环境变量"));
        return {
          env: getComputedStyle(envLabel.nextElementSibling).backgroundColor,
          data: getComputedStyle(document.querySelector("#data > div > div > div")).backgroundColor,
          text: getComputedStyle(document.querySelector("#data pre")).color,
          surface: getComputedStyle(document.querySelector("#surface-probe")).backgroundColor,
          foreground: getComputedStyle(document.querySelector("#text-probe")).color,
        };
      });
      assert.equal(styles.env, styles.surface, `${mode}: environment fill must match its theme`);
      assert.equal(styles.data, styles.surface, `${mode}: Data heading fill must match its theme`);
      assert.equal(styles.text, styles.foreground, `${mode}: Data value must remain readable`);
      assert.match(await page.locator("#containers").innerText(), /MODE.*test/s);
      assert.match(await page.locator("#containers").innerText(), /SECRET.*secretKeyRef/s);
      backgrounds.push(styles.env);
    }
    assert.notEqual(backgrounds[0], backgrounds[1], "theme changes must update environment fills");
  } finally { await page.close(); }
});

test("workspace return stays 32px and bordered despite global button rules", async () => {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  try {
    for (const mode of ["dark", "light"]) {
      for (const collapsed of [false, true]) {
        await fixture(page, mode, collapsed);
        const button = page.getByRole("button", { name: "返回集群列表" });
        const styles = await button.evaluate((node) => {
          const style = getComputedStyle(node);
          const icon = node.querySelector(".anticon");
          const rect = node.getBoundingClientRect();
          const sidebar = node.closest("aside").getBoundingClientRect();
          return { height: rect.height, width: rect.width, minHeight: style.minHeight, borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle, borderColor: style.borderTopColor, fontSize: style.fontSize, iconSize: getComputedStyle(icon).fontSize, left: rect.left, right: rect.right, sidebarLeft: sidebar.left, sidebarRight: sidebar.right };
        });
        assert.equal(styles.height, 32, `${mode}/${collapsed}: global min-height must not enlarge return`);
        assert.equal(styles.minHeight, "32px");
        assert.equal(styles.borderWidth, "1px");
        assert.equal(styles.borderStyle, "solid");
        assert.notEqual(styles.borderColor, "rgba(0, 0, 0, 0)");
        assert.equal(styles.fontSize, "12px");
        assert.equal(styles.iconSize, "14px");
        assert.ok(styles.left >= styles.sidebarLeft && styles.right <= styles.sidebarRight, "return must fit sidebar");
        if (collapsed) {
          assert.equal(styles.width, 32);
          assert.equal(await button.innerText(), "");
          assert.ok(await button.locator(".anticon").isVisible(), "collapsed return icon must not be hidden with its label");
        } else {
          assert.equal(await button.innerText(), "返回");
        }
        await button.hover();
        assert.equal((await button.boundingBox()).height, 32, "hover must not resize the control");
        await button.focus();
        const focus = await button.evaluate((node) => ({ visible: node.matches(":focus-visible"), shadow: getComputedStyle(node).boxShadow }));
        assert.ok(focus.visible);
        assert.notEqual(focus.shadow, "none", "keyboard focus must remain visible");
      }
    }
  } finally { await page.close(); }
});
