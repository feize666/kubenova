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
  role: string;
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
