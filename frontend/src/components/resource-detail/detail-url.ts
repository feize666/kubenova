export interface DetailUrlRequest {
  kind: string;
  id: string;
  label?: string;
}

export interface DetailUrlBrowser {
  location: { href: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url: string): void };
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

const keys = ["detailKind", "detailId", "detailLabel"] as const;
const controls = /[\u0000-\u001f\u007f]/;

function parseUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    return ["http:", "https:"].includes(url.protocol) && !url.pathname.startsWith("//") ? url : null;
  } catch { return null; }
}

function validRequest(request: DetailUrlRequest): boolean {
  return /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(request.kind)
    && Boolean(request.id.trim()) && request.id.length <= 2048 && !controls.test(request.id)
    && (request.label === undefined || (request.label.length <= 256 && !controls.test(request.label)));
}

export function readDetailUrl(href: string): DetailUrlRequest | null {
  const url = parseUrl(href);
  if (!url || keys.some((key) => url.searchParams.getAll(key).length > 1)) return null;
  const kind = url.searchParams.get("detailKind") ?? "";
  const id = url.searchParams.get("detailId") ?? "";
  const label = url.searchParams.get("detailLabel");
  const request = { kind, id, ...(label !== null ? { label } : {}) };
  return validRequest(request) ? request : null;
}

export function writeDetailUrl(href: string, request: DetailUrlRequest | null): string | null {
  const url = parseUrl(href);
  if (!url || (request && !validRequest(request))) return null;
  for (const key of keys) url.searchParams.delete(key);
  if (request) {
    url.searchParams.set("detailKind", request.kind);
    url.searchParams.set("detailId", request.id);
    if (request.label) url.searchParams.set("detailLabel", request.label);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A single URL owner per browser, rather than one listener/writer per drawer. */
export function createDetailUrlController(browser: DetailUrlBrowser) {
  type Receiver = (request: DetailUrlRequest | null, source: "restore" | "navigate") => void;
  const owners = new Map<object, { pathname: string; receive: Receiver }>();
  let activeOwner: object | undefined;
  const restore = () => {
    const url = parseUrl(browser.location.href);
    const owner = activeOwner && owners.get(activeOwner);
    if (owner) owner.receive(url?.pathname === owner.pathname ? readDetailUrl(browser.location.href) : null, "restore");
  };
  return {
    register(owner: object, receive: Receiver) {
      if (owners.size === 0) browser.addEventListener("popstate", restore);
      owners.set(owner, { pathname: parseUrl(browser.location.href)?.pathname ?? "", receive });
      if (!activeOwner) { activeOwner = owner; restore(); }
      else receive(null, "restore");
      return () => {
        owners.delete(owner);
        if (activeOwner === owner) { activeOwner = owners.keys().next().value; restore(); }
        if (owners.size === 0) browser.removeEventListener("popstate", restore);
      };
    },
    navigate(owner: object, request: DetailUrlRequest | null) {
      const entry = owners.get(owner);
      if (!entry || parseUrl(browser.location.href)?.pathname !== entry.pathname) return;
      if (!request && activeOwner !== owner) return;
      const href = writeDetailUrl(browser.location.href, request);
      if (!href) return;
      if (activeOwner !== owner) {
        if (activeOwner) owners.get(activeOwner)?.receive(null, "restore");
        activeOwner = owner;
      }
      // Keep Next's router tree and any background filter/search state intact.
      browser.history.replaceState(browser.history.state, "", href);
      entry.receive(request, "navigate");
    },
  };
}

const controllers = new WeakMap<DetailUrlBrowser, ReturnType<typeof createDetailUrlController>>();
export function getDetailUrlController(browser: DetailUrlBrowser) {
  let controller = controllers.get(browser);
  if (!controller) { controller = createDetailUrlController(browser); controllers.set(browser, controller); }
  return controller;
}
