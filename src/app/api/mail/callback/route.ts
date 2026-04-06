import { NextRequest, NextResponse } from 'next/server'

const CLIENT_ID = process.env.MS_CLIENT_ID || ''
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET || ''
const TENANT_ID = process.env.MS_TENANT_ID || 'common'
const REDIRECT_URI = process.env.MS_REDIRECT_URI || 'https://ht-admin-v2-1.vercel.app/api/mail/callback'

// Global token store (shared med main mail route via module cache)
export const TOKEN_STORE: Record<string, any> = {}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL('/dashboard?mail=error&reason=' + encodeURIComponent(error), req.url))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/dashboard?mail=error&reason=no_code', req.url))
  }

  try {
    const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        scope: 'offline_access Mail.ReadWrite Mail.Send',
      })
    })
    const d = await r.json()
    if (d.access_token) {
      TOKEN_STORE['token'] = { ...d, expires_at: Date.now() + d.expires_in * 1000 }
      // Store in cookie so it persists across serverless instances
      const response = NextResponse.redirect(new URL('/dashboard?page=mail&mail=connected', req.url))
      response.cookies.set('ms_refresh_token', d.refresh_token, { httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 30, path: '/' })
      response.cookies.set('ms_access_token', d.access_token, { httpOnly: true, secure: true, maxAge: d.expires_in, path: '/' })
      return response
    }
    return NextResponse.redirect(new URL('/dashboard?mail=error&reason=' + encodeURIComponent(d.error_description || 'token_failed'), req.url))
  } catch (e: any) {
    return NextResponse.redirect(new URL('/dashboard?mail=error&reason=' + encodeURIComponent(e.message), req.url))
  }
}
