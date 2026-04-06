import { NextRequest, NextResponse } from 'next/server'

const CLIENT_ID = process.env.MS_CLIENT_ID || ''
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET || ''
const TENANT_ID = process.env.MS_TENANT_ID || 'common'
const REDIRECT_URI = process.env.MS_REDIRECT_URI || 'https://ht-admin-v2-1.vercel.app/api/mail/callback'

const TOKEN_STORE: Record<string, any> = {}

function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'offline_access Mail.ReadWrite Mail.Send',
    response_mode: 'query',
  })
  return `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params}`
}

async function getAccessToken(): Promise<string | null> {
  const stored = TOKEN_STORE['token']
  if (!stored) return null
  if (stored.expires_at > Date.now() + 60000) return stored.access_token
  // Refresh
  try {
    const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: stored.refresh_token,
        scope: 'offline_access Mail.ReadWrite Mail.Send',
      })
    })
    const d = await r.json()
    if (d.access_token) {
      TOKEN_STORE['token'] = { ...d, expires_at: Date.now() + d.expires_in * 1000 }
      return d.access_token
    }
  } catch {}
  return null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  // OAuth callback
  if (searchParams.get('code')) {
    const code = searchParams.get('code')!
    const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      })
    })
    const d = await r.json()
    if (d.access_token) {
      TOKEN_STORE['token'] = { ...d, expires_at: Date.now() + d.expires_in * 1000 }
      return NextResponse.redirect(new URL('/dashboard?mail=connected', req.url))
    }
    return NextResponse.redirect(new URL('/dashboard?mail=error', req.url))
  }

  if (action === 'status') {
    const token = await getAccessToken()
    if (token) return NextResponse.json({ connected: true })
    if (!CLIENT_ID) return NextResponse.json({ connected: false, error: 'MS_CLIENT_ID not configured' })
    return NextResponse.json({ connected: false, authUrl: getAuthUrl() })
  }

  if (action === 'list') {
    const token = await getAccessToken()
    if (!token) return NextResponse.json({ emails: [], error: 'Not authenticated' })
    const folder = searchParams.get('folder') === 'sent' ? 'sentItems' : 'inbox'
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$top=30&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,body,replyTo,conversationId`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [], error: d.error?.message })
    const emails = d.value.map((m: any) => ({
      id: m.id,
      subject: m.subject || '(inget ämne)',
      from: m.from?.emailAddress?.address || '',
      fromName: m.from?.emailAddress?.name || '',
      date: m.receivedDateTime,
      unread: !m.isRead,
      preview: m.bodyPreview?.slice(0, 80) || '',
      body: m.body?.content?.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s{3,}/g, '\n\n').trim() || '',
      replyTo: m.replyTo?.[0]?.emailAddress?.address || m.from?.emailAddress?.address || '',
      threadId: m.conversationId,
    }))
    return NextResponse.json({ emails })
  }

  return NextResponse.json({ error: 'Unknown action' })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'send') {
    const token = await getAccessToken()
    if (!token) return NextResponse.json({ success: false, error: 'Not authenticated' })

    const message: any = {
      subject: body.subject,
      body: { contentType: 'Text', content: body.body },
      toRecipients: [{ emailAddress: { address: body.to } }],
    }
    if (body.attachments?.length) {
      message.attachments = body.attachments.map((a: any) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.name,
        contentBytes: a.content,
        contentType: a.contentType,
      }))
    }

    const r = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: true })
    })

    if (r.status === 202) return NextResponse.json({ success: true })
    const err = await r.json().catch(() => ({}))
    return NextResponse.json({ success: false, error: err.error?.message || r.statusText })
  }

  return NextResponse.json({ error: 'Unknown action' })
}
