import { NextRequest, NextResponse } from 'next/server'

const CLIENT_ID = process.env.MS_CLIENT_ID || ''
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET || ''
const TENANT_ID = process.env.MS_TENANT_ID || 'common'
const REDIRECT_URI = process.env.MS_REDIRECT_URI || 'https://ht-admin-v2-1.vercel.app/api/mail/callback'

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

async function doRefresh(rt: string) {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token', refresh_token: rt,
      scope: 'offline_access Mail.ReadWrite Mail.Send',
    })
  })
  return r.json()
}

function cleanHtml(html: string): string {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function mapEmail(m: any, isDraft = false) {
  // Drafts have no "from" — use toRecipients as the display name
  const toAddr = m.toRecipients?.[0]?.emailAddress?.address || ''
  const toName = m.toRecipients?.[0]?.emailAddress?.name || toAddr
  return {
    id: m.id,
    subject: m.subject || '(inget ämne)',
    from: isDraft ? toAddr : (m.from?.emailAddress?.address || ''),
    fromName: isDraft ? toName : (m.from?.emailAddress?.name || ''),
    to: toAddr,
    date: m.receivedDateTime || m.lastModifiedDateTime || '',
    unread: !m.isRead,
    preview: m.bodyPreview?.slice(0, 90) || '',
    body: cleanHtml(m.body?.content || ''),
    replyTo: m.replyTo?.[0]?.emailAddress?.address || m.from?.emailAddress?.address || toAddr,
    threadId: m.conversationId,
    isDraft: isDraft,
  }
}

async function getToken(req: NextRequest): Promise<{ token: string | null; newAccess?: string; newRefresh?: string; newExpiry?: number }> {
  const at = req.cookies.get('ms_access_token')?.value
  const rt = req.cookies.get('ms_refresh_token')?.value
  if (at) return { token: at }
  if (rt) {
    const d = await doRefresh(rt)
    if (d.access_token) return { token: d.access_token, newAccess: d.access_token, newRefresh: d.refresh_token, newExpiry: d.expires_in }
  }
  return { token: null }
}

function withTokenCookies(res: NextResponse, newAccess?: string, newRefresh?: string, newExpiry?: number) {
  if (newAccess) res.cookies.set('ms_access_token', newAccess, { httpOnly: true, secure: true, maxAge: newExpiry, path: '/' })
  if (newRefresh) res.cookies.set('ms_refresh_token', newRefresh, { httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 30, path: '/' })
  return res
}

async function getArchiveFolderId(token: string): Promise<string | null> {
  const r = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders?$top=50', { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json()
  return (d.value || []).find((f: any) => f.displayName === 'Arkiverat')?.id || null
}

// ── GET ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const { token, newAccess, newRefresh, newExpiry } = await getToken(req)

  if (action === 'status') {
    if (!CLIENT_ID) return NextResponse.json({ connected: false, error: 'MS_CLIENT_ID not configured' })
    if (token) return NextResponse.json({ connected: true })
    return NextResponse.json({ connected: false, authUrl: getAuthUrl() })
  }

  if (action === 'list') {
    if (!token) return NextResponse.json({ emails: [], error: 'Not authenticated', authUrl: getAuthUrl() })
    const folderParam = searchParams.get('folder') || 'inbox'
    let folderId = folderParam === 'sent' ? 'sentItems' : folderParam === 'drafts' ? 'drafts' : 'inbox'
    if (folderParam === 'archive') {
      const archiveId = await getArchiveFolderId(token)
      folderId = archiveId || 'inbox'
    }
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,receivedDateTime,lastModifiedDateTime,isRead,bodyPreview,body,replyTo,conversationId`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [], error: d.error?.message })
    const isDraft = folderParam === 'drafts'
    const res = NextResponse.json({ emails: d.value.map((m: any) => mapEmail(m, isDraft)), nextLink: d['@odata.nextLink'] || null })
    return withTokenCookies(res, newAccess, newRefresh, newExpiry)
  }

  if (action === 'list_next') {
    if (!token) return NextResponse.json({ emails: [] })
    const nextLink = searchParams.get('nextLink') || ''
    if (!nextLink) return NextResponse.json({ emails: [] })
    const r = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [] })
    return NextResponse.json({ emails: d.value.map(mapEmail), nextLink: d['@odata.nextLink'] || null })
  }

  if (action === 'thread_id') {
    if (!token) return NextResponse.json({ emails: [] })
    const threadId = searchParams.get('threadId') || ''
    const filter = encodeURIComponent(`conversationId eq '${threadId}'`)
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$top=20&$orderby=receivedDateTime asc&$filter=${filter}&$select=id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,body,replyTo,conversationId`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [] })
    return NextResponse.json({ emails: d.value.map(mapEmail) })
  }

  if (action === 'thread') {
    if (!token) return NextResponse.json({ emails: [] })
    const email = searchParams.get('email') || ''
    const searchQ = encodeURIComponent(`"${email}"`)
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$top=50&$search=${searchQ}&$select=id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,body,replyTo,conversationId`,
      { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } }
    )
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [] })
    return NextResponse.json({ emails: d.value.map(mapEmail) })
  }

  return NextResponse.json({ error: 'Unknown action' })
}

// ── POST ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body
  const { token } = await getToken(req)

  if (action === 'disconnect') {
    const res = NextResponse.json({ success: true })
    res.cookies.delete('ms_access_token')
    res.cookies.delete('ms_refresh_token')
    return res
  }

  if (action === 'archive') {
    if (!token) return NextResponse.json({ success: false })
    let folderId = await getArchiveFolderId(token)
    if (!folderId) {
      const cr = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Arkiverat' })
      })
      const cd = await cr.json()
      folderId = cd.id
    }
    if (!folderId) return NextResponse.json({ success: false, error: 'Could not get folder' })
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${body.emailId}/move`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationId: folderId })
    })
    return NextResponse.json({ success: r.ok })
  }

  if (action === 'delete') {
    if (!token) return NextResponse.json({ success: false })
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${body.emailId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    return NextResponse.json({ success: r.ok || r.status === 204 })
  }

  if (action === 'saveDraft') {
    if (!token) return NextResponse.json({ success: false })

    const htmlContent = body.body || ''
    // If updating an existing draft
    if (body.draftId) {
      const updateRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${body.draftId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: { contentType: 'HTML', content: htmlContent.includes('<') ? htmlContent : htmlContent.replace(/\n/g, '<br>') },
          subject: body.subject,
          toRecipients: [{ emailAddress: { address: body.to } }],
        })
      })
      return NextResponse.json({ success: updateRes.ok, draftId: body.draftId })
    }

    // If threadId provided, use createReply to keep thread context
    if (body.threadId) {
      try {
        // Find the inbox message to reply to (not drafts — only look in inbox/sent)
        const threadRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages?$filter=conversationId eq '${body.threadId}' and isDraft eq false&$top=1&$orderby=receivedDateTime desc&$select=id,subject,conversationId`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const threadData = await threadRes.json()
        const originalMsg = threadData.value?.[0]

        if (originalMsg?.id) {
          // createReply returns the new draft in Drafts folder
          const replyRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${originalMsg.id}/createReply`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          })
          const draftMsg = await replyRes.json()
          if (draftMsg.id) {
            // Patch the body
            await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draftMsg.id}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                body: { contentType: 'HTML', content: htmlContent.includes('<') ? htmlContent : htmlContent.replace(/\n/g, '<br>') }
              })
            })
            return NextResponse.json({ success: true, draftId: draftMsg.id })
          }
        }
      } catch (err) {
        console.error('[saveDraft] createReply failed:', err)
      }
    }

    // Fallback: standalone draft
    const message = {
      subject: body.subject,
      body: { contentType: 'HTML', content: htmlContent.includes('<') ? htmlContent : htmlContent.replace(/\n/g, '<br>') },
      toRecipients: [{ emailAddress: { address: body.to } }],
    }
    const r = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    })
    const result = await r.json()
    return NextResponse.json({ success: r.ok, draftId: result.id })
  }

  if (action === 'listDrafts') {
    if (!token) return NextResponse.json({ emails: [] })
    const r = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/drafts/messages?$top=50&$select=id,subject,from,toRecipients,body,receivedDateTime,hasAttachments,internetMessageId,conversationId', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!r.ok) return NextResponse.json({ emails: [] })
    const data = await r.json()
    const emails = (data.value || []).map((m: any) => ({
      id: m.id,
      subject: m.subject || '(inget ämne)',
      from: m.from?.emailAddress?.address || '',
      to: m.toRecipients?.[0]?.emailAddress?.address || '',
      body: m.body?.content?.replace(/<[^>]+>/g, '').trim() || '',
      date: m.receivedDateTime,
      hasAttachments: m.hasAttachments,
      threadId: m.conversationId,
    }))
    return NextResponse.json({ emails })
  }

  if (action === 'send') {
    if (!token) return NextResponse.json({ success: false, error: 'Not authenticated' })
    const logoUrl = 'https://ht-admin-v2-1.vercel.app/ht-logo.png'
    const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px">${
      (body.body || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
    }<br><br><img src="${logoUrl}" alt="HT Ytrengöring" style="width:140px;height:auto;margin-top:8px" /></div>`
    const message: any = {
      subject: body.subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients: [{ emailAddress: { address: body.to } }],
    }
    if (body.attachments?.length) {
      message.attachments = body.attachments.map((a: any) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.name, contentBytes: a.content, contentType: a.contentType,
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
