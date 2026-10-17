import { resourceFingerprint } from '@/lib/resource-editor';
import type { MapRow } from './native-model';

type MapState = { source: unknown; rows: MapRow[]; error: string };
type AdvancedState = { source: unknown; text: string; dirty: boolean; error: string };

export function reconcileMapState(state: MapState, value: unknown, published: unknown, makeRows: (value: unknown) => MapRow[]): MapState {
  if (resourceFingerprint(state.source) === resourceFingerprint(value)) return state;
  const ownUpdate = resourceFingerprint(value) === resourceFingerprint(published);
  return { source: value, rows: ownUpdate ? state.rows : makeRows(value), error: ownUpdate ? state.error : '' };
}

export function reconcileAdvancedState(state: AdvancedState, value: unknown, serialize: (value: unknown) => string): AdvancedState {
  if (resourceFingerprint(state.source) === resourceFingerprint(value)) return state;
  return { source: value, text: serialize(value), dirty: false, error: '' };
}
