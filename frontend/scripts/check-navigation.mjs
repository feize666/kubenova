#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const navigationPath = path.join(projectRoot, "src/config/navigation.ts");
const shellLayoutPath = path.join(projectRoot, "src/components/shell-layout.tsx");
const globalsPath = path.join(projectRoot, "src/app/globals.css");
const appRoot = path.join(projectRoot, "src/app");
const forbiddenSidebarPaths = new Set(["/dashboard", "/monitoring"]);
const outputPath = resolveOutputPath();

function isIdentifierChar(char) {
  return /[A-Za-z0-9_$-]/.test(char);
}

function moveScannerState(text, index, state) {
  const char = text[index];
  const next = text[index + 1];

  if (state.lineComment) {
    if (char === "\n") state.lineComment = false;
    return;
  }
  if (state.blockComment) {
    if (char === "*" && next === "/") {
      state.blockComment = false;
      state.skipNext = true;
    }
    return;
  }
  if (state.quote) {
    if (state.escape) {
      state.escape = false;
      return;
    }
    if (char === "\\") {
      state.escape = true;
      return;
    }
    if (char === state.quote) state.quote = "";
    return;
  }
  if (char === "/" && next === "/") {
    state.lineComment = true;
    state.skipNext = true;
    return;
  }
  if (char === "/" && next === "*") {
    state.blockComment = true;
    state.skipNext = true;
    return;
  }
  if (char === '"' || char === "'" || char === "`") {
    state.quote = char;
  }
}

function findMatching(text, openIndex, openChar, closeChar) {
  const state = { quote: "", escape: false, lineComment: false, blockComment: false, skipNext: false };
  let depth = 0;

  for (let index = openIndex; index < text.length; index += 1) {
    state.skipNext = false;
    const char = text[index];
    const inactive = !state.quote && !state.lineComment && !state.blockComment;
    if (inactive && char === openChar) depth += 1;
    if (inactive && char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
    moveScannerState(text, index, state);
    if (state.skipNext) index += 1;
  }

  throw new Error(`No matching "${closeChar}" found.`);
}

function extractInitializer(text, variableName, openChar, closeChar) {
  const variablePattern = new RegExp(`\\b(?:export\\s+)?const\\s+${variableName}\\b`);
  const variableMatch = variablePattern.exec(text);
  if (!variableMatch) throw new Error(`Cannot find const "${variableName}".`);

  const equalsIndex = text.indexOf("=", variableMatch.index);
  if (equalsIndex === -1) throw new Error(`Cannot find initializer for "${variableName}".`);
  const openIndex = text.indexOf(openChar, equalsIndex);
  if (openIndex === -1) throw new Error(`Cannot find "${openChar}" for "${variableName}".`);
  const closeIndex = findMatching(text, openIndex, openChar, closeChar);
  return text.slice(openIndex, closeIndex + 1);
}

function splitTopLevelElements(arrayText) {
  const content = arrayText.slice(1, -1);
  const elements = [];
  const state = { quote: "", escape: false, lineComment: false, blockComment: false, skipNext: false };
  const depth = { brace: 0, bracket: 0, paren: 0 };
  let start = 0;

  for (let index = 0; index < content.length; index += 1) {
    state.skipNext = false;
    const char = content[index];
    const inactive = !state.quote && !state.lineComment && !state.blockComment;

    if (inactive) {
      if (char === "{") depth.brace += 1;
      if (char === "}") depth.brace -= 1;
      if (char === "[") depth.bracket += 1;
      if (char === "]") depth.bracket -= 1;
      if (char === "(") depth.paren += 1;
      if (char === ")") depth.paren -= 1;
      if (char === "," && depth.brace === 0 && depth.bracket === 0 && depth.paren === 0) {
        const element = content.slice(start, index).trim();
        if (element) elements.push(element);
        start = index + 1;
      }
    }

    moveScannerState(content, index, state);
    if (state.skipNext) index += 1;
  }

  const tail = content.slice(start).trim();
  if (tail) elements.push(tail);
  return elements;
}

function findTopLevelPropertyValue(objectText, propertyName) {
  const content = objectText.trim().replace(/^({)/, "").replace(/(})$/, "");
  const state = { quote: "", escape: false, lineComment: false, blockComment: false, skipNext: false };
  const depth = { brace: 0, bracket: 0, paren: 0 };

  for (let index = 0; index < content.length; index += 1) {
    state.skipNext = false;
    const char = content[index];
    const inactive = !state.quote && !state.lineComment && !state.blockComment;

    if (inactive && depth.brace === 0 && depth.bracket === 0 && depth.paren === 0) {
      const before = content[index - 1] || "";
      if (!isIdentifierChar(before)) {
        const unquoted = content.startsWith(propertyName, index);
        const quotedDouble = content.startsWith(`"${propertyName}"`, index);
        const quotedSingle = content.startsWith(`'${propertyName}'`, index);
        const keyLength = unquoted ? propertyName.length : quotedDouble || quotedSingle ? propertyName.length + 2 : 0;
        if (keyLength > 0) {
          let cursor = index + keyLength;
          while (/\s/.test(content[cursor] || "")) cursor += 1;
          if (content[cursor] === ":") {
            cursor += 1;
            while (/\s/.test(content[cursor] || "")) cursor += 1;
            return content.slice(cursor);
          }
        }
      }
    }

    if (inactive) {
      if (char === "{") depth.brace += 1;
      if (char === "}") depth.brace -= 1;
      if (char === "[") depth.bracket += 1;
      if (char === "]") depth.bracket -= 1;
      if (char === "(") depth.paren += 1;
      if (char === ")") depth.paren -= 1;
    }

    moveScannerState(content, index, state);
    if (state.skipNext) index += 1;
  }

  return undefined;
}

function readStringLiteral(valueText) {
  if (!valueText) return undefined;
  const quote = valueText[0];
  if (quote !== '"' && quote !== "'") return undefined;

  let escaped = false;
  for (let index = 1; index < valueText.length; index += 1) {
    const char = valueText[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) {
      return JSON.parse(`"${valueText.slice(1, index).replace(/"/g, '\\"')}"`);
    }
  }
  return undefined;
}

function readRequiredRole(valueText) {
  const value = readStringLiteral(valueText);
  if (value === undefined) return undefined;
  if (value !== "admin") {
    throw new Error(`Unsupported requiredRole "${value}".`);
  }
  return value;
}

function readArrayLiteral(valueText) {
  if (!valueText) return undefined;
  const openIndex = valueText.indexOf("[");
  if (openIndex === -1) return undefined;
  const closeIndex = findMatching(valueText, openIndex, "[", "]");
  return valueText.slice(openIndex, closeIndex + 1);
}

function extractNavigation(navigationText) {
  const navSectionsArray = extractInitializer(navigationText, "navSections", "[", "]");
  return splitTopLevelElements(navSectionsArray).map((sectionText, sectionIndex) => {
    const key = readStringLiteral(findTopLevelPropertyValue(sectionText, "key"));
    if (!key) throw new Error(`navSections[${sectionIndex}] is missing string key.`);

    const sectionPath = readStringLiteral(findTopLevelPropertyValue(sectionText, "path"));
    const sectionLabel = readStringLiteral(findTopLevelPropertyValue(sectionText, "label"));
    const sectionRequiredRole = readRequiredRole(findTopLevelPropertyValue(sectionText, "requiredRole"));
    const itemsArray = readArrayLiteral(findTopLevelPropertyValue(sectionText, "items"));
    if (!itemsArray) throw new Error(`navSections[${sectionIndex}] (${key}) is missing items array.`);

    const items = splitTopLevelElements(itemsArray).map((itemText, itemIndex) => {
      const itemKey = readStringLiteral(findTopLevelPropertyValue(itemText, "key"));
      const itemPath = readStringLiteral(findTopLevelPropertyValue(itemText, "path"));
      const itemLabel = readStringLiteral(findTopLevelPropertyValue(itemText, "label"));
      const itemRequiredRole = readRequiredRole(findTopLevelPropertyValue(itemText, "requiredRole"));
      if (!itemKey) throw new Error(`navSections[${sectionIndex}].items[${itemIndex}] (${key}) missing key.`);
      if (!itemPath) throw new Error(`navSections[${sectionIndex}].items[${itemIndex}] (${key}) missing path.`);
      if (!itemLabel) throw new Error(`navSections[${sectionIndex}].items[${itemIndex}] (${key}) missing label.`);
      return { key: itemKey, path: itemPath, label: itemLabel, requiredRole: itemRequiredRole };
    });

    return {
      key,
      path: sectionPath,
      label: sectionLabel,
      requiredRole: sectionRequiredRole,
      items,
      itemPaths: items.map((item) => item.path),
      itemKeys: items.map((item) => item.key),
    };
  });
}

function extractStringArray(text, variableName) {
  return splitTopLevelElements(extractInitializer(text, variableName, "[", "]")).map((element, index) => {
    const value = readStringLiteral(element);
    if (!value) throw new Error(`${variableName}[${index}] is not a string literal.`);
    return value;
  });
}

function extractObjectKeys(text, variableName) {
  const objectText = extractInitializer(text, variableName, "{", "}");
  return splitTopLevelElements(`[${objectText.slice(1, -1)}]`).map((propertyText) => {
    const colonIndex = propertyText.indexOf(":");
    if (colonIndex === -1) throw new Error(`${variableName} contains property without colon.`);
    const rawKey = propertyText.slice(0, colonIndex).trim();
    const quotedKey = readStringLiteral(rawKey);
    return quotedKey || rawKey;
  });
}

function extractCssBlock(cssText, selector) {
  const selectorIndex = cssText.indexOf(selector);
  if (selectorIndex === -1) return "";
  const openIndex = cssText.indexOf("{", selectorIndex);
  if (openIndex === -1) return "";
  const closeIndex = findMatching(cssText, openIndex, "{", "}");
  return cssText.slice(openIndex + 1, closeIndex);
}

function extractCssVariables(cssText, selector, prefix) {
  const variables = new Map();
  const variablePattern = new RegExp(`(${prefix}[A-Za-z0-9_-]+)\\s*:\\s*([^;]+);`, "g");
  let searchIndex = 0;
  while (searchIndex < cssText.length) {
    const selectorIndex = cssText.indexOf(selector, searchIndex);
    if (selectorIndex === -1) break;
    const openIndex = cssText.indexOf("{", selectorIndex);
    if (openIndex === -1) break;
    const closeIndex = findMatching(cssText, openIndex, "{", "}");
    const block = cssText.slice(openIndex + 1, closeIndex);
    for (const match of block.matchAll(variablePattern)) {
      variables.set(match[1], match[2].trim());
    }
    searchIndex = closeIndex + 1;
  }
  return variables;
}

function toAppPagePath(routePath) {
  if (!routePath.startsWith("/")) {
    throw new Error(`Navigation path must start with "/": ${routePath}`);
  }
  if (routePath.includes("?") || routePath.includes("#")) {
    throw new Error(`Navigation path must not include query/hash: ${routePath}`);
  }
  const routeSegments = routePath.split("/").filter(Boolean);
  return path.join(appRoot, ...routeSegments, "page.tsx");
}

function formatList(values) {
  return values.length === 0 ? "(none)" : values.map((value) => `  - ${value}`).join("\n");
}

function findDuplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function resolveOutputPath() {
  const raw = process.env.CHECK_NAVIGATION_OUTPUT?.trim();
  if (!raw) return "";
  if (raw === "1" || raw === "true" || raw === "default") {
    return path.join(
      os.tmpdir(),
      "kubenova",
      "check-navigation",
      `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}.json`,
    );
  }
  return raw;
}

function writeSummary(summary) {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`[check-navigation] summary=${outputPath}`);
}

function main() {
  const navigationText = fs.readFileSync(navigationPath, "utf8");
  const shellLayoutText = fs.readFileSync(shellLayoutPath, "utf8");
  const globalsText = fs.readFileSync(globalsPath, "utf8");

  const sections = extractNavigation(navigationText);
  const sectionKeys = sections.map((section) => section.key);
  const sectionKeySet = new Set(sectionKeys);
  const itemKeys = sections.flatMap((section) => section.itemKeys);
  const navigationPaths = sections.flatMap((section) => [
    ...(section.path ? [section.path] : []),
    ...section.itemPaths,
  ]);

  const sidebarOrder = extractStringArray(shellLayoutText, "SIDEBAR_SECTION_ORDER");
  const sidebarOrderSet = new Set(sidebarOrder);
  const iconKeys = extractObjectKeys(shellLayoutText, "sectionIconMap");
  const iconKeySet = new Set(iconKeys);

  const missingPages = navigationPaths.filter((routePath) => !fs.existsSync(toAppPagePath(routePath)));
  const missingFromOrder = sectionKeys.filter((key) => !sidebarOrderSet.has(key));
  const missingFromIcons = sectionKeys.filter((key) => !iconKeySet.has(key));
  const unknownOrderKeys = sidebarOrder.filter((key) => !sectionKeySet.has(key));
  const duplicateSections = findDuplicates(sectionKeys);
  const duplicateItems = findDuplicates(itemKeys);
  const duplicateSectionItemKeys = findDuplicates([...sectionKeys, ...itemKeys]);
  const duplicatePaths = findDuplicates(navigationPaths);
  const forbiddenPaths = navigationPaths.filter((routePath) => forbiddenSidebarPaths.has(routePath));
  const invalidSections = sections
    .filter((section) => !section.label?.trim() || (section.path && section.items.length > 0) || (!section.path && section.items.length === 0))
    .map((section) => {
      if (!section.label?.trim()) return `${section.key}: missing label`;
      if (section.path && section.items.length > 0) return `${section.key}: section path cannot also declare child items`;
      return `${section.key}: section without path must declare child items`;
    });
  const requiredShellContracts = [
    "PREFETCHABLE_NAV_PATHS",
    "navSections.flatMap",
    "filterNavSectionsByRole",
    "findActiveSectionKey",
    "getSectionOrder",
    "sectionIconMap[section.key]",
    "className=\"app-sidebar-menu__link app-sidebar-menu__link--section\"",
    "className=\"app-sidebar-menu__link app-sidebar-menu__link--nested\"",
    "className=\"shell-status-band\"",
    "className=\"shell-mobile-nav-trigger\"",
    "className=\"shell-mobile-scope\"",
    "className=\"shell-mobile-search-trigger\"",
    "className=\"shell-topbar-actions\"",
    "id=\"shell-global-search\"",
    "id=\"shell-mobile-global-search\"",
    "className={`shell-theme-toggle shell-theme-toggle--${mode}`}",
  ];
  const missingShellContracts = requiredShellContracts.filter((contract) => !shellLayoutText.includes(contract));
  const requiredCssContracts = [
    "[data-theme=\"light\"] .app-sidebar.ant-layout-sider",
    "background: #ffffff !important;",
    "--sidebar-icon-config: #db2777;",
    "--sidebar-icon-config: #f472b6;",
    ".app-sidebar-menu__label--nested::before",
    ".app-sidebar-menu__link--nested",
    ".shell-status-band",
    ".shell-mobile-nav-trigger.ops-icon-action-button.ant-btn",
    ".shell-mobile-search-trigger.ops-icon-action-button.ant-btn",
    ".shell-mobile-scope",
    ".shell-mobile-nav-dropdown .ant-dropdown-menu",
    ".shell-topbar-action.ops-icon-action-button.ant-btn",
    ".app-header .ant-input-affix-wrapper",
    "height: 34px;",
    "height: 32px;",
  ];
  const missingCssContracts = requiredCssContracts.filter((contract) => !globalsText.includes(contract));
  const sidebarIconNames = [
    "--sidebar-icon-overview",
    "--sidebar-icon-panorama",
    "--sidebar-icon-cluster",
    "--sidebar-icon-workloads",
    "--sidebar-icon-network",
    "--sidebar-icon-storage",
    "--sidebar-icon-config",
    "--sidebar-icon-delivery",
    "--sidebar-icon-observability",
    "--sidebar-icon-intelligence",
    "--sidebar-icon-security",
    "--sidebar-icon-system",
  ];
  const lightSidebarIconValues = extractCssVariables(globalsText, "[data-theme=\"light\"] .app-sidebar-menu.ant-menu", "--sidebar-icon-");
  const darkSidebarIconValues = extractCssVariables(globalsText, "[data-theme=\"dark\"] .app-sidebar-menu.ant-menu", "--sidebar-icon-");
  const missingLightSidebarIcons = sidebarIconNames.filter((name) => !lightSidebarIconValues.has(name));
  const missingDarkSidebarIcons = sidebarIconNames.filter((name) => !darkSidebarIconValues.has(name));
  const duplicateLightSidebarIconColors = findDuplicates(sidebarIconNames.map((name) => lightSidebarIconValues.get(name)).filter(Boolean));
  const duplicateDarkSidebarIconColors = findDuplicates(sidebarIconNames.map((name) => darkSidebarIconValues.get(name)).filter(Boolean));
  const clusterDomain = sections.find((section) => section.key === "section-cluster-domain");
  const clusterDomainPaths = clusterDomain?.items.map((item) => item.path) ?? [];
  const nodeIndex = clusterDomainPaths.indexOf("/clusters/nodes");
  const namespaceIndex = clusterDomainPaths.indexOf("/namespaces");
  const invalidClusterDomainOrder =
    nodeIndex === -1 || namespaceIndex === -1 || namespaceIndex !== nodeIndex + 1
      ? [`section-cluster-domain: /namespaces must be directly below /clusters/nodes (current order: ${clusterDomainPaths.join(", ")})`]
      : [];

  const failures = [];
  if (missingPages.length > 0) failures.push(`Missing app pages:\n${formatList(missingPages)}`);
  if (missingFromOrder.length > 0) failures.push(`Missing from SIDEBAR_SECTION_ORDER:\n${formatList(missingFromOrder)}`);
  if (missingFromIcons.length > 0) failures.push(`Missing from sectionIconMap:\n${formatList(missingFromIcons)}`);
  if (unknownOrderKeys.length > 0) failures.push(`Unknown keys in SIDEBAR_SECTION_ORDER:\n${formatList(unknownOrderKeys)}`);
  if (duplicateSections.length > 0) failures.push(`Duplicate section keys:\n${formatList(duplicateSections)}`);
  if (duplicateItems.length > 0) failures.push(`Duplicate item keys:\n${formatList(duplicateItems)}`);
  if (duplicateSectionItemKeys.length > 0) failures.push(`Section/item key collisions:\n${formatList(duplicateSectionItemKeys)}`);
  if (duplicatePaths.length > 0) failures.push(`Duplicate navigation paths:\n${formatList(duplicatePaths)}`);
  if (forbiddenPaths.length > 0) failures.push(`Forbidden sidebar paths:\n${formatList([...new Set(forbiddenPaths)])}`);
  if (invalidSections.length > 0) failures.push(`Invalid section shapes:\n${formatList(invalidSections)}`);
  if (missingShellContracts.length > 0) failures.push(`Missing shell navigation contracts:\n${formatList(missingShellContracts)}`);
  if (missingCssContracts.length > 0) failures.push(`Missing shell CSS contracts:\n${formatList(missingCssContracts)}`);
  if (missingLightSidebarIcons.length > 0) failures.push(`Missing light sidebar icon tokens:\n${formatList(missingLightSidebarIcons)}`);
  if (missingDarkSidebarIcons.length > 0) failures.push(`Missing dark sidebar icon tokens:\n${formatList(missingDarkSidebarIcons)}`);
  if (duplicateLightSidebarIconColors.length > 0) failures.push(`Duplicate light sidebar icon colors:\n${formatList(duplicateLightSidebarIconColors)}`);
  if (duplicateDarkSidebarIconColors.length > 0) failures.push(`Duplicate dark sidebar icon colors:\n${formatList(duplicateDarkSidebarIconColors)}`);
  if (invalidClusterDomainOrder.length > 0) failures.push(`Invalid cluster domain order:\n${formatList(invalidClusterDomainOrder)}`);

  const summary = {
    status: failures.length > 0 ? "fail" : "pass",
    sectionCount: sections.length,
    pathCount: navigationPaths.length,
    orderedKeyCount: sidebarOrder.length,
    failures,
    missingPages,
    missingFromOrder,
    missingFromIcons,
    unknownOrderKeys,
    duplicateSections,
    duplicateItems,
    duplicateSectionItemKeys,
    duplicatePaths,
    forbiddenPaths: [...new Set(forbiddenPaths)],
    invalidSections,
    missingShellContracts,
    missingCssContracts,
    missingLightSidebarIcons,
    missingDarkSidebarIcons,
    duplicateLightSidebarIconColors,
    duplicateDarkSidebarIconColors,
    invalidClusterDomainOrder,
    generatedAt: new Date().toISOString(),
  };

  if (failures.length > 0) {
    writeSummary(summary);
    console.error(`[check-navigation] FAIL\n${failures.join("\n\n")}`);
    process.exit(1);
  }

  writeSummary(summary);
  console.log(
    `[check-navigation] PASS: ${sections.length} sections, ${navigationPaths.length} paths, ${sidebarOrder.length} ordered keys.`,
  );
}

main();
