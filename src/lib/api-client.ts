'use client';

import type { ApiResponse } from '@/types/api';

const ACCESS_KEY  = 'kriya_access_token';
const REFRESH_KEY = 'kriya_refresh_token';

export const tokenStore = {
  get(): { access: string | null; refresh: string | null } {
    if (typeof window === 'undefined') return { access: null, refresh: null };
    return {
      access: localStorage.getItem(ACCESS_KEY),
      refresh: localStorage.getItem(REFRESH_KEY),
    };
  },
  set(access: string, refresh: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

type RequestOptions = {
  headers?: Record<string, string>;
  skipAuthRefresh?: boolean;
};

async function refreshTokens(): Promise<string | null> {
  const { refresh } = tokenStore.get();
  if (!refresh) return null;

  try {
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return null;
    const json: ApiResponse<{ access_token: string; refresh_token: string }> = await res.json();
    if (!json.data) return null;
    tokenStore.set(json.data.access_token, json.data.refresh_token);
    return json.data.access_token;
  } catch {
    return null;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { access } = tokenStore.get();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (access) headers['Authorization'] = `Bearer ${access}`;

  const fetchOptions: RequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  let res: Response;
  try {
    res = await fetch(path, fetchOptions);
  } catch {
    return {
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection and that the dev server is running.' },
    };
  }

  if (res.status === 401 && !options.skipAuthRefresh) {
    const newToken = await refreshTokens();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      try {
        res = await fetch(path, { ...fetchOptions, headers });
      } catch {
        return {
          data: null,
          error: { code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection.' },
        };
      }
    } else {
      tokenStore.clear();
      if (typeof window !== 'undefined') {
        window.location.href = '/clinic/login';
      }
      return { data: null, error: { code: 'AUTH_REQUIRED', message: 'Session expired' } };
    }
  }

  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { data: null, error: { code: 'INTERNAL_ERROR', message: 'Invalid response from server' } };
  }
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),
};
