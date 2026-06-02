#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const navigationPath = path.join(projectRoot, "src/config/navigation.ts");
const shellLayoutPath = path.join(projectRoot, "src/components/shell-layout.tsx");
const appRoot = path.join(projectRoot, "src/app");
const forbiddenSidebarPaths = new Set(["/dashboard", "/monitoring"]);

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
    const itemsArray = readArrayLiteral(findTopLevelPropertyValue(sectionText, "items"));
    if (!itemsArray) throw new Error(`navSections[${sectionIndex}] (${key}) is missing items array.`);

    const itemPaths = splitTopLevelElements(itemsArray).map((itemText, itemIndex) => {
      const itemPath = readStringLiteral(findTopLevelPropertyValue(itemText, "path"));
      if (!itemPath) throw new Error(`navSections[${sectionIndex}].items[${itemIndex}] (${key}) missing path.`);
      return itemPath;
    });

    return { key, path: sectionPath, itemPaths };
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

function main() {
  const navigationText = fs.readFileSync(navigationPath, "utf8");
  const shellLayoutText = fs.readFileSync(shellLayoutPath, "utf8");

  const sections = extractNavigation(navigationText);
  const sectionKeys = sections.map((section) => section.key);
  const sectionKeySet = new Set(sectionKeys);
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
  const duplicateSections = sectionKeys.filter((key, index) => sectionKeys.indexOf(key) !== index);
  const duplicatePaths = navigationPaths.filter((routePath, index) => navigationPaths.indexOf(routePath) !== index);
  const forbiddenPaths = navigationPaths.filter((routePath) => forbiddenSidebarPaths.has(routePath));

  const failures = [];
  if (missingPages.length > 0) failures.push(`Missing app pages:\n${formatList(missingPages)}`);
  if (missingFromOrder.length > 0) failures.push(`Missing from SIDEBAR_SECTION_ORDER:\n${formatList(missingFromOrder)}`);
  if (missingFromIcons.length > 0) failures.push(`Missing from sectionIconMap:\n${formatList(missingFromIcons)}`);
  if (unknownOrderKeys.length > 0) failures.push(`Unknown keys in SIDEBAR_SECTION_ORDER:\n${formatList(unknownOrderKeys)}`);
  if (duplicateSections.length > 0) failures.push(`Duplicate section keys:\n${formatList([...new Set(duplicateSections)])}`);
  if (duplicatePaths.length > 0) failures.push(`Duplicate navigation paths:\n${formatList([...new Set(duplicatePaths)])}`);
  if (forbiddenPaths.length > 0) failures.push(`Forbidden sidebar paths:\n${formatList([...new Set(forbiddenPaths)])}`);

  if (failures.length > 0) {
    console.error(`[check-navigation] FAIL\n${failures.join("\n\n")}`);
    process.exit(1);
  }

  console.log(
    `[check-navigation] PASS: ${sections.length} sections, ${navigationPaths.length} paths, ${sidebarOrder.length} ordered keys.`,
  );
}

main();
