export const SIDEBAR_PREFERENCE_KEY = "kubenova.sidebar.collapsed";
export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

export function parseSidebarPreference(value: string | null): boolean {
  return value === "true";
}
