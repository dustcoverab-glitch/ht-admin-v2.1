import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Skydda alla API-routes utom auth och mail/callback
  if (pathname.startsWith('/api/')) {
    if (
      pathname.startsWith('/api/auth') ||
      pathname.startsWith('/api/mail/callback')
    ) {
      return NextResponse.next()
    }

    const session = req.cookies.get('session')?.value
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
