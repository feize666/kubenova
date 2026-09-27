import type { Key } from "react";

const anonymousKeys = new WeakMap<object, string>();
let anonymousSequence = 0;

export function getStableResourceRowKey<T extends object>(record: T): Key {
  const value = record as Record<string, unknown>;
  const metadata = value.metadata && typeof value.metadata === "object"
    ? value.metadata as Record<string, unknown>
    : undefined;
  const directKey = value.key ?? value.id ?? value.uid ?? metadata?.uid;
  if (typeof directKey === "string" || typeof directKey === "number") return directKey;
  const namespace = metadata?.namespace ?? value.namespace;
  const name = metadata?.name ?? value.name;
  if ((typeof name === "string" || typeof name === "number") && (typeof namespace === "string" || typeof namespace === "number")) return `${namespace}/${name}`;
  if (typeof name === "string" || typeof name === "number") return name;
  // ponytail: rows without a business ID retain identity for this data snapshot only.
  // Tables requiring selection across refetches must supply a persistent rowKey.
  let key = anonymousKeys.get(record);
  if (!key) {
    key = `anonymous-row:${++anonymousSequence}`;
    anonymousKeys.set(record, key);
  }
  return key;
}
