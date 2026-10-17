export interface LeaveState { dirty: boolean; busy: boolean; saved: boolean }
export function createEditorLeaveGuard(state: () => LeaveState, confirm: (accept: () => void, cancel: () => void) => void) {
  let pending = false;
  let leaving = false;
  return (action: () => void) => {
    if (state().busy || pending || leaving) return;
    const navigate = () => { leaving = true; action(); };
    if (!state().dirty || state().saved) { navigate(); return; }
    pending = true;
    let settled = false;
    confirm(() => {
      if (settled) return;
      settled = true; pending = false;
      if (!state().busy) navigate();
    }, () => { if (settled) return; settled = true; pending = false; });
  };
}
export interface LinkIntent {
  href: string; target?: string | null; download?: boolean;
  button: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; defaultPrevented?: boolean;
}
export function editorInternalLink(intent: LinkIntent, currentHref: string): string | null {
  if (intent.defaultPrevented || intent.button !== 0 || intent.metaKey || intent.ctrlKey || intent.shiftKey || intent.altKey || intent.download || (intent.target && intent.target !== '_self')) return null;
  if (!intent.href || intent.href.startsWith('#')) return null;
  try {
    const current = new URL(currentHref);
    const next = new URL(intent.href, current);
    if (!['http:', 'https:'].includes(next.protocol) || next.origin !== current.origin) return null;
    if (next.pathname === current.pathname && next.search === current.search) return null;
    return intent.href;
  } catch { return null; }
}
