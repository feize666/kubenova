import { apiRequest } from "./client";

export type TablePreferenceValue = unknown;
export type TableColumnVisibilityPreference = Record<string, boolean>;

export type TablePreferences = {
  columnVisibility?: TableColumnVisibilityPreference;
  filterRowVisible?: boolean;
};

export type TablePreferencesClient = {
  loadTablePreferences?: (tableKey: string) => Promise<TablePreferences | null | undefined>;
  saveTablePreferences?: (tableKey: string, preferences: TablePreferences) => Promise<void>;
};

export interface TablePreferenceResponse<TValue = TablePreferenceValue> {
  tableKey: string;
  value: TValue | null;
  updatedAt: string | null;
}

export interface UpdateTablePreferencePayload<TValue = TablePreferenceValue> {
  value: TValue;
}

export function getTablePreference<TValue = TablePreferenceValue>(
  tableKey: string,
  token: string,
) {
  return apiRequest<TablePreferenceResponse<TValue>>(
    `/api/users/preferences/table/${encodeURIComponent(tableKey)}`,
    {
      method: "GET",
      token,
    },
  );
}

export function saveTablePreference<TValue = TablePreferenceValue>(
  tableKey: string,
  value: TValue,
  token: string,
) {
  return apiRequest<TablePreferenceResponse<TValue>, UpdateTablePreferencePayload<TValue>>(
    `/api/users/preferences/table/${encodeURIComponent(tableKey)}`,
    {
      method: "PUT",
      body: { value },
      token,
    },
  );
}

export function createTablePreferencesClient(token: string | undefined): TablePreferencesClient | undefined {
  if (!token) {
    return undefined;
  }
  return {
    loadTablePreferences: async (tableKey) => {
      try {
        const response = await getTablePreference<TablePreferences>(tableKey, token);
        return response.value;
      } catch {
        return null;
      }
    },
    saveTablePreferences: async (tableKey, preferences) => {
      try {
        await saveTablePreference(tableKey, preferences, token);
      } catch {
        // Local storage remains source of truth until the preference API is available.
      }
    },
  };
}
