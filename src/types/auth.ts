export type UserRole =
  | 'ops' | 'clinic_admin' | 'ortho' | 'physio' | 'trainer' | 'front_desk';

export const QUALIFIED_ROLES: UserRole[] = ['ortho', 'physio'];
export const CLINICAL_ROLES: UserRole[] = ['ortho', 'physio', 'clinic_admin'];
export const ADMIN_ROLES: UserRole[] = ['ops', 'clinic_admin'];

export type JwtPayload = {
  sub: string;
  clinic_id: string | null;
  branch_id: string | null;
  role: UserRole;
  iat: number;
  exp: number;
};

export type RefreshTokenPayload = {
  session_id: string;
  sub: string;
  iat: number;
  exp: number;
};

export type InviteTokenPayload = {
  email: string;
  clinic_id: string;
  branch_id: string;
  role: UserRole;
  iat: number;
  exp: number;
};

export type AuthedUser = {
  id: string;
  clinic_id: string | null;
  branch_id: string | null;
  role: UserRole;
};
