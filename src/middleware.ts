import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

function isBasicAuthValid(encoded: string, username: string, password: string): boolean {
  try {
    const decoded = atob(encoded);
    const index = decoded.indexOf(':');
    if (index === -1) {
      return false;
    }
    const user = decoded.slice(0, index);
    const pass = decoded.slice(index + 1);
    return user === username && pass === password;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  // Allow health/scheduled checks without basic auth if needed
  if (request.nextUrl.pathname.startsWith('/cdn-cgi/')) {
    return NextResponse.next();
  }

  let authUsername = process.env.AUTH_USERNAME || '';
  let authPassword = process.env.AUTH_PASSWORD || '';

  try {
    const ctx = getCloudflareContext();
    if (ctx?.env) {
      authUsername = (ctx.env as any).AUTH_USERNAME || authUsername;
      authPassword = (ctx.env as any).AUTH_PASSWORD || authPassword;
    }
  } catch {
    // Fall back to process.env
  }

  if (!authUsername || !authPassword) {
    return new NextResponse('Unauthorized: Trading platform is locked. AUTH_USERNAME and AUTH_PASSWORD must be set.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="trading-bot"',
      },
    });
  }

  const authHeader = request.headers.get('authorization') || '';
  const [scheme, encoded] = authHeader.split(' ', 2);

  if (scheme === 'Basic' && encoded && isBasicAuthValid(encoded, authUsername, authPassword)) {
    return NextResponse.next();
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="trading-bot"',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
