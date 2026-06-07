export type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: { page?: number; total?: number; cursor?: string };
};

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'TOKEN_EXPIRED'
  | 'TENANT_MISMATCH'
  | 'ENTITLEMENT_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'NOT_FOUND';
