"use client";

export function sanitizeInternalReturnTo(value?: string | null): string {
  const candidate = (value ?? "").trim();
  if (!candidate) {
    return "";
  }
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return "";
  }

  const [pathAndQuery, hashFragment = ""] = candidate.split("#", 2);
  const [pathname, queryString = ""] = pathAndQuery.split("?", 2);

  if (!pathname || pathname === "/" || pathname.startsWith("//")) {
    return "";
  }

  const normalizedQuery = queryString ? `?${queryString}` : "";
  const normalizedHash = hashFragment ? `#${hashFragment}` : "";
  return `${pathname}${normalizedQuery}${normalizedHash}`;
}

export function buildInternalReturnTo(pathname: string, search?: string | null): string {
  const normalizedPath = sanitizeInternalReturnTo(pathname);
  if (!normalizedPath) {
    return "";
  }

  const candidateSearch = (search ?? "").trim();
  if (!candidateSearch) {
    return normalizedPath;
  }

  if (candidateSearch.startsWith("?")) {
    return `${normalizedPath}${candidateSearch}`;
  }

  return `${normalizedPath}?${candidateSearch}`;
}

export function buildLoginRoute(returnTo?: string | null): string {
  const target = sanitizeInternalReturnTo(returnTo);
  if (!target) {
    return "/login";
  }
  return `/login?returnTo=${encodeURIComponent(target)}`;
}
