/**
 * Resolver hook used by `scripts/run-node-tests.mjs`.
 *
 * Teaches Node the two specifier styles the app source relies on — the `@/`
 * path alias and extensionless relative imports — plus the extensionless
 * dependency subpaths a few packages ship. Bundler builds handle these
 * themselves; Node does not, so the hook exists only for local test runs.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "src");
const SUFFIXES = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx", "/index.js"];

function firstExisting(base) {
  for (const suffix of SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function candidateBases(specifier, parentURL) {
  if (specifier.startsWith("@/")) {
    return [resolvePath(SRC_DIR, specifier.slice(2))];
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (!parentURL) return [];
    return [resolvePath(dirname(fileURLToPath(parentURL)), specifier)];
  }
  if (parentURL && !specifier.startsWith("node:")) {
    // Dependencies that ship extensionless subpaths, e.g. `elkjs/lib/elk-api`.
    return [resolvePath(dirname(fileURLToPath(parentURL)), "node_modules", specifier)];
  }
  return [];
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const base of candidateBases(specifier, context.parentURL)) {
      const resolved = firstExisting(base);
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
