import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

function accessKey() {
  return new TextEncoder().encode(process.env.ACCESS_TOKEN_SECRET!);
}

const PUBLIC_PATHS = [
  '/api/v1/auth',
  '/_next',
  '/favicon.ico',
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return true;
  if (pathname.endsWith('/login')) return true;
  if (pathname.endsWith('/invite-activate')) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  // Only guard portal routes
  const isPortalRoute =
    pathname.startsWith('/ops') ||
    pathname.startsWith('/clinic') ||
    pathname.includes('/(ops)') ||
    pathname.includes('/(clinic)');

  if (!isPortalRoute) return NextResponse.next();

  const cookieToken = request.cookies.get('kriya_access_token')?.value;
  const headerToken = request.headers.get('Authorization')?.replace('Bearer ', '');
  const token = cookieToken ?? headerToken;

  if (!token) {
    return NextResponse.redirect(new URL(
      pathname.startsWith('/ops') ? '/ops/login' : '/clinic/login',
      request.url
    ));
  }

  try {
    await jwtVerify(token, accessKey());
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL(
      pathname.startsWith('/ops') ? '/ops/login' : '/clinic/login',
      request.url
    ));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
