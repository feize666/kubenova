import { access } from "node:fs/promises";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) throw error;
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (await exists(candidate)) return { url: candidate.href, shortCircuit: true };
    const indexCandidate = new URL(`${specifier}/index.ts`, context.parentURL);
    if (await exists(indexCandidate)) return { url: indexCandidate.href, shortCircuit: true };
    throw error;
  }
}
