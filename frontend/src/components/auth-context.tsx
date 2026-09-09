"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AUTH_EXPIRED_EVENT, CONTROL_API_BASE, resetAuthExpiryState } from "@/lib/api/client";

type LoginPayload = {
  username: string;
  password: string;
  remember: boolean;
};

type AuthUser = {
  username: string;
  displayName?: string;
  role?: string;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  isInitializing: boolean;
  username: string;
  role: string;
  lastRequestId: string;
  login: (payload: LoginPayload) => Promise<{ ok: boolean; message: string }>;
  logout: () => Promise<void>;
  accessToken: string;
};

type AuthSnapshot = {
  accessToken: string;
  refreshToken: string;
  username: string;
  role: string;
  expiresAt?: string;
};

type RefreshResponse = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  expiresAt?: string;
};

type RefreshAttempt = {
  snapshot: AuthSnapshot | null;
  unauthorized: boolean;
};

function normalizeRole(role: string | undefined | null): string {
  return (role ?? "").trim().toLowerCase();
}

const LOCAL_ACCESS_KEY = "aiops_auth_access";
const LOCAL_REFRESH_KEY = "aiops_auth_refresh";
const LOCAL_USER_KEY = "aiops_auth_user";
const LOCAL_ROLE_KEY = "aiops_auth_role";
const LOCAL_EXPIRES_KEY = "aiops_auth_expires_at";

const LEGACY_LOCAL_ACCESS_KEY = "access_token";
const LEGACY_LOCAL_REFRESH_KEY = "refresh_token";
const LEGACY_LOCAL_USER_KEY = "username";
const LEGACY_LOCAL_ROLE_KEY = "role";
const LEGACY_LOCAL_EXPIRES_KEY = "expires_at";

const SESSION_ACCESS_KEY = "aiops_auth_session_access";
const SESSION_REFRESH_KEY = "aiops_auth_session_refresh";
const SESSION_USER_KEY = "aiops_auth_session_user";
const SESSION_ROLE_KEY = "aiops_auth_session_role";
const SESSION_EXPIRES_KEY = "aiops_auth_session_expires_at";

const LEGACY_SESSION_ACCESS_KEY = "access_token";
const LEGACY_SESSION_REFRESH_KEY = "refresh_token";
const LEGACY_SESSION_USER_KEY = "username";
const LEGACY_SESSION_ROLE_KEY = "role";
const LEGACY_SESSION_EXPIRES_KEY = "expires_at";

const REQUEST_ID_HEADERS = ["x-request-id", "request-id"];
const REFRESH_SKEW_MS = 60_000;
let authExpiredHandled = false;

class AuthApiError extends Error {
  status: number;
  requestId: string;

  constructor(message: string, status: number, requestId: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

function readAuthSnapshot(): AuthSnapshot | null {
  if (typeof window === "undefined") return null;

  const localAccess = window.localStorage.getItem(LOCAL_ACCESS_KEY) ?? window.localStorage.getItem(LEGACY_LOCAL_ACCESS_KEY);
  const localRefresh = window.localStorage.getItem(LOCAL_REFRESH_KEY) ?? window.localStorage.getItem(LEGACY_LOCAL_REFRESH_KEY);
  const localUser = window.localStorage.getItem(LOCAL_USER_KEY) ?? window.localStorage.getItem(LEGACY_LOCAL_USER_KEY);
  const localRole = window.localStorage.getItem(LOCAL_ROLE_KEY) ?? window.localStorage.getItem(LEGACY_LOCAL_ROLE_KEY);
  const localExpiresAt = window.localStorage.getItem(LOCAL_EXPIRES_KEY) ?? window.localStorage.getItem(LEGACY_LOCAL_EXPIRES_KEY);
  if (localAccess) {
    return {
      accessToken: localAccess,
      refreshToken: localRefresh ?? "",
      username: localUser ?? "",
      role: normalizeRole(localRole),
      expiresAt: localExpiresAt ?? undefined,
    };
  }

  const sessionAccess = window.sessionStorage.getItem(SESSION_ACCESS_KEY) ?? window.sessionStorage.getItem(LEGACY_SESSION_ACCESS_KEY);
  const sessionRefresh = window.sessionStorage.getItem(SESSION_REFRESH_KEY) ?? window.sessionStorage.getItem(LEGACY_SESSION_REFRESH_KEY);
  const sessionUser = window.sessionStorage.getItem(SESSION_USER_KEY) ?? window.sessionStorage.getItem(LEGACY_SESSION_USER_KEY);
  const sessionRole = window.sessionStorage.getItem(SESSION_ROLE_KEY) ?? window.sessionStorage.getItem(LEGACY_SESSION_ROLE_KEY);
  const sessionExpiresAt = window.sessionStorage.getItem(SESSION_EXPIRES_KEY) ?? window.sessionStorage.getItem(LEGACY_SESSION_EXPIRES_KEY);
  if (sessionAccess) {
    return {
      accessToken: sessionAccess,
      refreshToken: sessionRefresh ?? "",
      username: sessionUser ?? "",
      role: normalizeRole(sessionRole),
      expiresAt: sessionExpiresAt ?? undefined,
    };
  }

  return null;
}

function clearPersistedAuth() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(LOCAL_ACCESS_KEY);
  window.localStorage.removeItem(LOCAL_REFRESH_KEY);
  window.localStorage.removeItem(LOCAL_USER_KEY);
  window.localStorage.removeItem(LOCAL_ROLE_KEY);
  window.localStorage.removeItem(LOCAL_EXPIRES_KEY);
  window.localStorage.removeItem(LEGACY_LOCAL_ACCESS_KEY);
  window.localStorage.removeItem(LEGACY_LOCAL_REFRESH_KEY);
  window.localStorage.removeItem(LEGACY_LOCAL_USER_KEY);
  window.localStorage.removeItem(LEGACY_LOCAL_ROLE_KEY);
  window.localStorage.removeItem(LEGACY_LOCAL_EXPIRES_KEY);

  window.sessionStorage.removeItem(SESSION_ACCESS_KEY);
  window.sessionStorage.removeItem(SESSION_REFRESH_KEY);
  window.sessionStorage.removeItem(SESSION_USER_KEY);
  window.sessionStorage.removeItem(SESSION_ROLE_KEY);
  window.sessionStorage.removeItem(SESSION_EXPIRES_KEY);
  window.sessionStorage.removeItem(LEGACY_SESSION_ACCESS_KEY);
  window.sessionStorage.removeItem(LEGACY_SESSION_REFRESH_KEY);
  window.sessionStorage.removeItem(LEGACY_SESSION_USER_KEY);
  window.sessionStorage.removeItem(LEGACY_SESSION_ROLE_KEY);
  window.sessionStorage.removeItem(LEGACY_SESSION_EXPIRES_KEY);
}

function persistAuth(snapshot: AuthSnapshot, remember: boolean) {
  if (typeof window === "undefined") return;

  clearPersistedAuth();

  if (remember) {
    window.localStorage.setItem(LOCAL_ACCESS_KEY, snapshot.accessToken);
    window.localStorage.setItem(LOCAL_REFRESH_KEY, snapshot.refreshToken);
    window.localStorage.setItem(LOCAL_USER_KEY, snapshot.username);
    window.localStorage.setItem(LOCAL_ROLE_KEY, snapshot.role);
    if (snapshot.expiresAt) {
      window.localStorage.setItem(LOCAL_EXPIRES_KEY, snapshot.expiresAt);
    }
    window.localStorage.setItem(LEGACY_LOCAL_ACCESS_KEY, snapshot.accessToken);
    window.localStorage.setItem(LEGACY_LOCAL_REFRESH_KEY, snapshot.refreshToken);
    window.localStorage.setItem(LEGACY_LOCAL_USER_KEY, snapshot.username);
    window.localStorage.setItem(LEGACY_LOCAL_ROLE_KEY, snapshot.role);
    if (snapshot.expiresAt) {
      window.localStorage.setItem(LEGACY_LOCAL_EXPIRES_KEY, snapshot.expiresAt);
    }
    return;
  }

  window.sessionStorage.setItem(SESSION_ACCESS_KEY, snapshot.accessToken);
  window.sessionStorage.setItem(SESSION_REFRESH_KEY, snapshot.refreshToken);
  window.sessionStorage.setItem(SESSION_USER_KEY, snapshot.username);
  window.sessionStorage.setItem(SESSION_ROLE_KEY, snapshot.role);
  if (snapshot.expiresAt) {
    window.sessionStorage.setItem(SESSION_EXPIRES_KEY, snapshot.expiresAt);
  }
  window.sessionStorage.setItem(LEGACY_SESSION_ACCESS_KEY, snapshot.accessToken);
  window.sessionStorage.setItem(LEGACY_SESSION_REFRESH_KEY, snapshot.refreshToken);
  window.sessionStorage.setItem(LEGACY_SESSION_USER_KEY, snapshot.username);
  window.sessionStorage.setItem(LEGACY_SESSION_ROLE_KEY, snapshot.role);
  if (snapshot.expiresAt) {
    window.sessionStorage.setItem(LEGACY_SESSION_EXPIRES_KEY, snapshot.expiresAt);
  }
}

function extractRequestId(headers: Headers): string {
  for (const key of REQUEST_ID_HEADERS) {
    const value = headers.get(key);
    if (value) return value;
  }
  return "";
}

function shouldFallback(error: unknown): boolean {
  if (error instanceof AuthApiError) {
    return error.status === 0 || error.status >= 500 || error.status === 404;
  }
  return true;
}

function resolveAuthApiBases(): string[] {
  const set = new Set<string>();
  const configuredBase = CONTROL_API_BASE.trim().replace(/\/+$/, "");
  const sameOrigin = typeof window !== "undefined" ? window.location.origin.replace(/\/+$/, "") : "";

  if (configuredBase && /^https?:\/\//i.test(configuredBase)) {
    try {
      const hostname = new URL(configuredBase).hostname.toLowerCase();
      if (typeof window !== "undefined" && hostname === "control-api") {
        set.add(sameOrigin);
      } else {
        set.add(configuredBase);
      }
    } catch {
      set.add(sameOrigin);
    }
  } else if (sameOrigin) {
    set.add(sameOrigin);
  } else {
    set.add("");
  }

  return Array.from(set);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<{ data: T; requestId: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "NetworkError";
    throw new AuthApiError(
      `无法连接控制面服务，请确认服务已启动并稍后重试。原始错误: ${detail}`,
      0,
      "",
    );
  }

  const requestId = extractRequestId(response.headers);
  const rawText = await response.text();
  let raw: ({ data?: T; message?: string } & T) | null = null;
  try {
    raw = (rawText ? JSON.parse(rawText) : {}) as { data?: T; message?: string } & T;
  } catch {
    const preview = rawText.trim().slice(0, 80);
    throw new AuthApiError(
      `认证服务响应异常，请稍后重试（${preview || "empty"}）`,
      0,
      requestId,
    );
  }
  if (!response.ok) {
    throw new AuthApiError(raw?.message || "请求失败", response.status, requestId);
  }
  const data = (raw as { data?: T }).data !== undefined ? (raw as { data: T }).data : (raw as unknown as T);
  return { data, requestId };
}

async function requestAuthJson<T>(path: string, init?: RequestInit): Promise<{ data: T; requestId: string }> {
  const bases = resolveAuthApiBases();
  let lastError: unknown;

  for (const base of bases) {
    const v1Url = `${base}/api/v1/auth/${path}`;
    try {
      return await requestJson<T>(v1Url, init);
    } catch (error) {
      lastError = error;
      if (!shouldFallback(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? new AuthApiError(
        `${lastError.message}（已尝试: ${bases.map((base) => base || "same-origin /api").join(" , ")}）`,
        lastError instanceof AuthApiError ? lastError.status : 0,
        lastError instanceof AuthApiError ? lastError.requestId : "",
      )
    : new AuthApiError(`登录接口不可达（已尝试: ${bases.map((base) => base || "same-origin /api").join(" , ")}）`, 0, "");
}

function clearAuthState(setState?: {
  setAccessToken?: (value: string) => void;
  setRefreshToken?: (value: string) => void;
  setUsername?: (value: string) => void;
  setRole?: (value: string) => void;
  setExpiresAt?: (value: string) => void;
}) {
  clearPersistedAuth();
  resetAuthExpiryState();
  setState?.setAccessToken?.("");
  setState?.setRefreshToken?.("");
  setState?.setUsername?.("");
  setState?.setRole?.("");
  setState?.setExpiresAt?.("");
}

function isExpiringSoon(expiresAt: string | undefined): boolean {
  if (!expiresAt) {
    return false;
  }
  const timestamp = new Date(expiresAt).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return timestamp - Date.now() <= REFRESH_SKEW_MS;
}

function isUnauthorizedAuthError(error: unknown): error is AuthApiError {
  return error instanceof AuthApiError && error.status === 401;
}

function snapshotFromRefresh(data: RefreshResponse): AuthSnapshot {
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    username: data.user.username,
    role: normalizeRole(data.user.role),
    expiresAt: data.expiresAt,
  };
}

async function waitForRotatedSnapshot(
  currentRefreshToken: string,
): Promise<AuthSnapshot | null> {
  // A second tab can receive 401 while the winning tab is still persisting
  // the rotated token. Give the winner a short grace window before logging out.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const snapshot = readAuthSnapshot();
    if (
      snapshot?.accessToken &&
      snapshot.refreshToken &&
      snapshot.refreshToken !== currentRefreshToken
    ) {
      return snapshot;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  return null;
}

type RefreshLockNavigator = Navigator & {
  locks?: {
    request<T>(
      name: string,
      options: { mode: "exclusive" },
      callback: () => Promise<T>,
    ): Promise<T>;
  };
};

function withRefreshLock<T>(callback: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && (navigator as RefreshLockNavigator).locks) {
    return (navigator as RefreshLockNavigator).locks!.request<T>(
      "kubenova-auth-refresh",
      { mode: "exclusive" },
      callback,
    );
  }
  return callback();
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("认证上下文不可用");
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [lastRequestId, setLastRequestId] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const bootstrappedRef = useRef(false);
  const authGenerationRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<RefreshAttempt> | null>(null);
  const storageSyncTimerRef = useRef<number | null>(null);

  const markAuthGeneration = () => {
    authGenerationRef.current += 1;
    return authGenerationRef.current;
  };

  const applyClearAuthState = (expectedGeneration?: number) => {
    if (typeof expectedGeneration === "number" && expectedGeneration !== authGenerationRef.current) {
      return;
    }
    clearAuthState({
      setAccessToken,
      setRefreshToken,
      setUsername,
      setRole,
      setExpiresAt,
    });
  };

  const refreshSession = useCallback(
    async (
      currentRefreshToken: string,
      expectedGeneration = authGenerationRef.current,
    ): Promise<RefreshAttempt> => {
      if (!currentRefreshToken) {
        return { snapshot: null, unauthorized: true };
      }
      if (refreshInFlightRef.current) {
        return refreshInFlightRef.current;
      }

      const executeRefresh = async (): Promise<RefreshAttempt> => {
        try {
          const refreshed = await requestAuthJson<RefreshResponse>("refresh", {
            method: "POST",
            body: JSON.stringify({ refreshToken: currentRefreshToken }),
          });
          if (expectedGeneration !== authGenerationRef.current) {
            return { snapshot: null, unauthorized: false };
          }
          const nextSnapshot = snapshotFromRefresh(refreshed.data);
          const remember = Boolean(window.localStorage.getItem(LOCAL_ACCESS_KEY));
          markAuthGeneration();
          authExpiredHandled = false;
          resetAuthExpiryState();
          persistAuth(nextSnapshot, remember);
          setAccessToken(nextSnapshot.accessToken);
          setRefreshToken(nextSnapshot.refreshToken);
          setUsername(nextSnapshot.username);
          setRole(nextSnapshot.role);
          setExpiresAt(nextSnapshot.expiresAt ?? "");
          setLastRequestId(refreshed.requestId);
          return { snapshot: nextSnapshot, unauthorized: false };
        } catch (error) {
          if (error instanceof AuthApiError) {
            setLastRequestId(error.requestId);
          }
          if (isUnauthorizedAuthError(error)) {
            const rotatedSnapshot = await waitForRotatedSnapshot(currentRefreshToken);
            if (rotatedSnapshot && expectedGeneration === authGenerationRef.current) {
              markAuthGeneration();
              authExpiredHandled = false;
              resetAuthExpiryState();
              setAccessToken(rotatedSnapshot.accessToken);
              setRefreshToken(rotatedSnapshot.refreshToken);
              setUsername(rotatedSnapshot.username);
              setRole(rotatedSnapshot.role);
              setExpiresAt(rotatedSnapshot.expiresAt ?? "");
              return { snapshot: rotatedSnapshot, unauthorized: false };
            }
          }
          return {
            snapshot: null,
            unauthorized: isUnauthorizedAuthError(error),
          };
        } finally {
          refreshInFlightRef.current = null;
        }
      };
      const task = withRefreshLock(executeRefresh);
      refreshInFlightRef.current = task;
      return task;
    },
    [],
  );

  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }
    bootstrappedRef.current = true;

    const run = async () => {
      const snapshot = readAuthSnapshot();
      if (!snapshot?.accessToken) {
        setIsInitializing(false);
        return;
      }
      const requestGeneration = authGenerationRef.current;
      setAccessToken(snapshot.accessToken);
      setRefreshToken(snapshot.refreshToken);
      setUsername(snapshot.username);
      setRole(snapshot.role);
      setExpiresAt(snapshot.expiresAt ?? "");

      let activeSnapshot = snapshot;
      if (snapshot.refreshToken && isExpiringSoon(snapshot.expiresAt)) {
        const refreshedSnapshot = await refreshSession(snapshot.refreshToken, requestGeneration);
        if (!refreshedSnapshot.snapshot) {
          if (refreshedSnapshot.unauthorized) {
            applyClearAuthState(requestGeneration);
          }
          setIsInitializing(false);
          return;
        }
        activeSnapshot = refreshedSnapshot.snapshot;
      }

      try {
        const me = await requestAuthJson<{ user: AuthUser; expiresAt?: string }>("me", {
          headers: { Authorization: `Bearer ${activeSnapshot.accessToken}` },
        });
        if (requestGeneration !== authGenerationRef.current) {
          return;
        }
        setUsername(me.data.user.username);
        setRole(normalizeRole(me.data.user.role));
        setLastRequestId(me.requestId);
        if (typeof me.data.expiresAt === "string") {
          setExpiresAt(me.data.expiresAt);
        }
      } catch (error) {
        if (error instanceof AuthApiError) {
          setLastRequestId(error.requestId);
        }
        if (isUnauthorizedAuthError(error) && activeSnapshot.refreshToken) {
          const refreshedSnapshot = await refreshSession(
            activeSnapshot.refreshToken,
            authGenerationRef.current,
          );
          if (refreshedSnapshot.snapshot) {
            setIsInitializing(false);
            return;
          }
          if (refreshedSnapshot.unauthorized) {
            applyClearAuthState(authGenerationRef.current);
          }
        }
        if (isUnauthorizedAuthError(error)) {
          applyClearAuthState(authGenerationRef.current);
        }
      } finally {
        setIsInitializing(false);
      }
    };

    void run();
  }, [refreshSession]);

  useEffect(() => {
    if (isInitializing || !refreshToken || !expiresAt) {
      return;
    }
    let cancelled = false;

    const runRefresh = async () => {
      const requestGeneration = authGenerationRef.current;
      const result = await refreshSession(refreshToken, requestGeneration);
      if (!cancelled && result.unauthorized) {
        applyClearAuthState(requestGeneration);
      }
    };

    if (isExpiringSoon(expiresAt)) {
      void runRefresh();
      return () => {
        cancelled = true;
      };
    }

    const timeoutMs = Math.max(new Date(expiresAt).getTime() - Date.now() - REFRESH_SKEW_MS, 5_000);
    const timer = window.setTimeout(() => {
      void runRefresh();
    }, timeoutMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [expiresAt, isInitializing, refreshSession, refreshToken]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) {
        return;
      }
      if (
        ![
          LOCAL_ACCESS_KEY,
          LOCAL_REFRESH_KEY,
          LOCAL_USER_KEY,
          LOCAL_ROLE_KEY,
          LOCAL_EXPIRES_KEY,
        ].includes(event.key ?? "")
      ) {
        return;
      }
      if (storageSyncTimerRef.current !== null) {
        window.clearTimeout(storageSyncTimerRef.current);
      }
      storageSyncTimerRef.current = window.setTimeout(() => {
        storageSyncTimerRef.current = null;
        const snapshot = readAuthSnapshot();
        markAuthGeneration();
        authExpiredHandled = false;
        resetAuthExpiryState();
        setAccessToken(snapshot?.accessToken ?? "");
        setRefreshToken(snapshot?.refreshToken ?? "");
        setUsername(snapshot?.username ?? "");
        setRole(snapshot?.role ?? "");
        setExpiresAt(snapshot?.expiresAt ?? "");
      }, 25);
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      if (storageSyncTimerRef.current !== null) {
        window.clearTimeout(storageSyncTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleAuthExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (authExpiredHandled || !detail?.message) {
        return;
      }
      authExpiredHandled = true;
      void refreshSession(refreshToken).then((result) => {
        if (result.snapshot) {
          authExpiredHandled = false;
          return;
        }
        if (result.unauthorized) {
          applyClearAuthState();
        } else {
          authExpiredHandled = false;
        }
      });
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired as EventListener);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired as EventListener);
    };
  }, [refreshSession, refreshToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(accessToken),
      isInitializing,
      username,
      role,
      lastRequestId,
      accessToken,
      login: async ({ username: inputUser, password, remember }) => {
        try {
          const payload = await requestAuthJson<{
            accessToken: string;
            refreshToken: string;
            expiresAt?: string;
            user: AuthUser;
          }>("login", {
            method: "POST",
            body: JSON.stringify({ username: inputUser.trim(), password }),
          });

          if (!payload.data?.accessToken || !payload.data?.refreshToken || !payload.data?.user?.username) {
            throw new AuthApiError(
              "登录响应缺少必要字段（accessToken/refreshToken/user），可能命中了错误的 API 路由",
              0,
              payload.requestId,
            );
          }

          setLastRequestId(payload.requestId);

          const snapshot: AuthSnapshot = {
            accessToken: payload.data.accessToken,
            refreshToken: payload.data.refreshToken,
            username: payload.data.user.username,
            role: normalizeRole(payload.data.user.role),
            expiresAt: payload.data.expiresAt,
          };

          markAuthGeneration();
          authExpiredHandled = false;
          resetAuthExpiryState();
          persistAuth(snapshot, remember);
          setAccessToken(snapshot.accessToken);
          setRefreshToken(snapshot.refreshToken);
          setUsername(snapshot.username);
          setRole(snapshot.role);
          setExpiresAt(snapshot.expiresAt ?? "");
          return { ok: true, message: "登录成功" };
        } catch (error) {
          let msg = error instanceof Error ? error.message : "登录失败";
          if (error instanceof AuthApiError) {
            setLastRequestId(error.requestId);
            if (error.status === 401) {
              applyClearAuthState();
            }
            if (error.status === 0) {
              if (msg.includes("错误路由") || msg.includes("非 JSON")) {
                msg = `${msg}。请稍后重试。`;
              } else {
                msg = "登录请求未送达控制面服务，请稍后重试。";
              }
            }
            if (error.requestId) {
              msg = `${msg}（请求ID: ${error.requestId}）`;
            }
          }
          return { ok: false, message: msg };
        }
      },
      logout: async () => {
        try {
          if (accessToken) {
            const result = await requestAuthJson<{ message: string }>("logout", {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            setLastRequestId(result.requestId);
          }
        } catch (error) {
          if (error instanceof AuthApiError) {
            setLastRequestId(error.requestId);
          }
        } finally {
          markAuthGeneration();
          authExpiredHandled = false;
          resetAuthExpiryState();
          applyClearAuthState();
        }
      },
    }),
    [accessToken, isInitializing, lastRequestId, role, username],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
