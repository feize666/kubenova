import { apiRequest } from "./client";
import { buildResourceListQuery, type ExtendedListQueryParams } from "./helpers";

export type RbacState = "active" | "disabled";
export type RbacKind = "RoleBinding" | "ClusterRoleBinding";
export type RbacSubjectKind = "User" | "Group" | "ServiceAccount";

export interface RbacSubjectRef {
  kind?: RbacSubjectKind;
  name?: string;
  namespace?: string;
}

export interface RbacListItem {
  id: string;
  name: string;
  kind: RbacKind;
  namespace: string;
  subject: string;
  subjectKind: RbacSubjectKind;
  subjectNamespace: string;
  subjectRef?: RbacSubjectRef;
  state: RbacState;
  version: number;
  updatedAt: string;
}

export interface RbacListResponse {
  items: RbacListItem[];
  total: number;
  timestamp: string;
}

export interface CreateRbacPayload {
  name: string;
  kind: RbacKind;
  namespace: string;
  subject?: string;
  subjectKind?: RbacSubjectKind;
  subjectNamespace?: string;
  subjectRef?: RbacSubjectRef;
}

export interface UpdateRbacPayload {
  name?: string;
  kind?: RbacKind;
  namespace?: string;
  subject?: string;
  subjectKind?: RbacSubjectKind;
  subjectNamespace?: string;
  subjectRef?: RbacSubjectRef;
}

export interface DeleteRbacResponse {
  id: string;
  deleted: true;
  state: "deleted";
  version: number;
}

export interface RbacStateChangeInput {
  id: string;
  nextState: RbacState;
}

export function getRbac(params: ExtendedListQueryParams = {}, token: string) {
  return apiRequest<RbacListResponse>("/api/users/rbac", {
    method: "GET",
    query: buildResourceListQuery(params),
    token,
  }).then((res) => ({
    ...res,
    items: (res.items ?? []).map((item) => ({
      ...item,
      subject: item.subject ?? item.subjectRef?.name ?? "",
      subjectKind: item.subjectKind ?? item.subjectRef?.kind ?? "User",
      subjectNamespace:
        (item.subjectKind ?? item.subjectRef?.kind) === "ServiceAccount"
          ? item.subjectNamespace ?? item.subjectRef?.namespace ?? ""
          : "",
    })),
  }));
}

export function createRbac(payload: CreateRbacPayload, token: string) {
  return apiRequest<RbacListItem, CreateRbacPayload>("/api/users/rbac", {
    method: "POST",
    body: payload,
    token,
  });
}

export function updateRbac(id: string, payload: UpdateRbacPayload, token: string) {
  return apiRequest<RbacListItem, UpdateRbacPayload>(`/api/users/rbac/${id}`, {
    method: "PATCH",
    body: payload,
    token,
  });
}

export function deleteRbac(id: string, token: string) {
  return apiRequest<DeleteRbacResponse>(`/api/users/rbac/${id}`, {
    method: "DELETE",
    token,
  });
}

export function disableRbac(id: string, token: string) {
  return apiRequest<RbacListItem>(`/api/users/rbac/${id}/disable`, {
    method: "POST",
    token,
  });
}

export function enableRbac(id: string, token: string) {
  return apiRequest<RbacListItem>(`/api/users/rbac/${id}/enable`, {
    method: "POST",
    token,
  });
}

export function setRbacState(id: string, nextState: RbacState, token: string) {
  return nextState === "active" ? enableRbac(id, token) : disableRbac(id, token);
}
