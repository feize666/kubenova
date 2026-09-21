import { apiRequest } from "./client";
import { buildResourceListQuery, type ExtendedListQueryParams } from "./helpers";

export type UserState = "active" | "disabled";

export interface UserListItem {
  id: string;
  username: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  mfaEnabled?: boolean;
}

export interface UsersListResponse {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

export interface CreateUserPayload {
  username: string;
  password: string;
}

export interface UpdateUserPayload {
  username?: string;
  name?: string;
  role?: string;
  password?: string;
}

export interface DeleteUserResponse {
  id: string;
  deleted: true;
}

export interface UserStateChangeInput {
  id: string;
  nextState: UserState;
}
export interface AccessGrantListResponse { items: Array<{ id: string; principal: { type: string; username?: string; name?: string } | null; cluster: { id: string; name: string }; role: string; state: string; validFrom: string; expiresAt: string | null; namespaces: Array<{ name: string; uid: string }>; capabilities: string[]; version: number; updatedAt: string }>; total: number; timestamp: string }
export function getAccessGrants(clusterId: string | undefined, token: string) {
  return apiRequest<AccessGrantListResponse>("/api/users/access-grants", { method: "GET", query: clusterId ? { clusterId } : undefined, token });
}

export function revokeAccessGrant(id: string, token: string) {
  return apiRequest<{ id: string; revoked: boolean }>(`/api/users/access-grants/${encodeURIComponent(id)}/revoke`, { method: "POST", token });
}

export interface CreateAccessGrantPayload {
  userId?: string;
  groupId?: string;
  clusterId: string;
  role: "cluster-admin" | "operator" | "viewer";
  namespaces: string[];
  capabilities: string[];
  expiresAt?: string;
}

export function getGrantGroups(keyword: string, token: string) {
  return apiRequest<{ items: Array<{ id: string; name: string }> }>("/api/users/grant-groups", { token, query: { keyword } });
}

export interface GroupMember {
  id: string;
  state: string;
  validFrom: string;
  expiresAt: string | null;
  user: { id: string; email: string; name: string | null; isActive: boolean };
}
export function getGroupMembers(id: string, page: number, token: string) {
  return apiRequest<{ group: { id: string; name: string; active: boolean; managedExternally: boolean }; items: GroupMember[]; total: number }>(`/api/users/identity-groups/${encodeURIComponent(id)}/members`, { token, query: { page } });
}
export function createIdentityGroup(name: string, token: string) {
  return apiRequest<{ id: string; name: string }, { name: string }>("/api/users/identity-groups", { method: "POST", body: { name }, token });
}
export function setGroupMember(groupId: string, userId: string, active: boolean, token: string) {
  return apiRequest<{ active: boolean }>(`/api/users/identity-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, { method: active ? "PUT" : "DELETE", token });
}

export function createAccessGrant(body: CreateAccessGrantPayload, token: string) {
  return apiRequest<{ id: string; version: number }, CreateAccessGrantPayload>("/api/users/access-grants", { method: "POST", token, body });
}

export interface AuthorizationChange {
  id: string;
  actorUserId: string;
  affectedUserId: string | null;
  grantId: string | null;
  version: number;
  reason: string;
  committedAt: string;
}

export function getAuthorizationChanges(page: number, token: string) {
  return apiRequest<{ items: AuthorizationChange[]; total: number; page: number; pageSize: number }>("/api/users/authorization-changes", {
    method: "GET", token, query: { page, pageSize: 20 },
  });
}

export function getUsers(params: ExtendedListQueryParams = {}, token: string) {
  return apiRequest<UsersListResponse>("/api/users", {
    method: "GET",
    query: buildResourceListQuery(params),
    token,
  });
}

export function createUser(payload: CreateUserPayload, token: string) {
  return apiRequest<UserListItem, CreateUserPayload>("/api/users", {
    method: "POST",
    body: payload,
    token,
  });
}

export function updateUser(id: string, payload: UpdateUserPayload, token: string) {
  return apiRequest<UserListItem, UpdateUserPayload>(`/api/users/${id}`, {
    method: "PATCH",
    body: payload,
    token,
  });
}

export function setUserMfa(id: string, enabled: boolean, token: string) {
  return apiRequest<{ id: string; mfaEnabled: boolean }, { enabled: boolean }>(`/api/users/${id}/mfa`, {
    method: "PATCH", body: { enabled }, token,
  });
}

export interface ExternalIdentity {
  id: string;
  issuer: string;
  subject: string;
  createdAt: string;
}

export function getExternalIdentities(userId: string, token: string) {
  return apiRequest<{ items: ExternalIdentity[] }>(`/api/users/${encodeURIComponent(userId)}/external-identities`, { method: "GET", token });
}

export function bindExternalIdentity(userId: string, body: Pick<ExternalIdentity, "issuer" | "subject">, token: string) {
  return apiRequest<ExternalIdentity, typeof body>(`/api/users/${encodeURIComponent(userId)}/external-identities`, { method: "POST", body, token });
}

export function unbindExternalIdentity(userId: string, identityId: string, token: string) {
  return apiRequest<{ removed: boolean }>(`/api/users/${encodeURIComponent(userId)}/external-identities/${encodeURIComponent(identityId)}`, { method: "DELETE", token });
}

export function deleteUser(id: string, token: string) {
  return apiRequest<DeleteUserResponse>(`/api/users/${id}`, {
    method: "DELETE",
    token,
  });
}

export function disableUser(id: string, token: string) {
  return apiRequest<UserListItem>(`/api/users/${id}/disable`, {
    method: "POST",
    token,
  });
}

export function enableUser(id: string, token: string) {
  return apiRequest<UserListItem>(`/api/users/${id}/enable`, {
    method: "POST",
    token,
  });
}

export function setUserState(id: string, nextState: UserState, token: string) {
  return nextState === "active" ? enableUser(id, token) : disableUser(id, token);
}
