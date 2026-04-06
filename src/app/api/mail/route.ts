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

async function refreshToken(refreshToken: string): Promise<any> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'offline_access Mail.ReadWrite Mail.Send',
    })
  })
  return r.json()
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  const accessToken = req.cookies.get('ms_access_token')?.value
  const storedRefresh = req.cookies.get('ms_refresh_token')?.value

  if (action === 'status') {
    if (!CLIENT_ID) return NextResponse.json({ connected: false, error: 'MS_CLIENT_ID not configured' })
    if (accessToken || storedRefresh) return NextResponse.json({ connected: true })
    return NextResponse.json({ connected: false, authUrl: getAuthUrl() })
  }

  // Get valid token
  async function getToken(): Promise<{ token: string | null, newAccess?: string, newRefresh?: string, newExpiry?: number }> {
    if (accessToken) return { token: accessToken }
    if (storedRefresh) {
      const d = await refreshToken(storedRefresh)
      if (d.access_token) return { token: d.access_token, newAccess: d.access_token, newRefresh: d.refresh_token, newExpiry: d.expires_in }
    }
    return { token: null }
  }

  if (action === 'list') {
    const { token, newAccess, newRefresh, newExpiry } = await getToken()
    if (!token) return NextResponse.json({ emails: [], error: 'Not authenticated', authUrl: getAuthUrl() })

    const folderParam = searchParams.get('folder')
    let folder = folderParam === 'sent' ? 'sentItems' : folderParam === 'drafts' ? 'drafts' : 'inbox'
    // For archive, look up the Arkiverat folder id
    if (folderParam === 'archive') {
      const { token: tok2 } = await getTokenObj()
      if (tok2) {
        const fr = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders?$top=50', { headers: { Authorization: `Bearer ${tok2}` } })
        const fd = await fr.json()
        const archiveFolder = (fd.value || []).find((f: any) => f.displayName === 'Arkiverat')
        folder = archiveFolder?.id || 'inbox'
      }
    }
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$top=100&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,body,replyTo,conversationId`,
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
      body: m.body?.content
        ?.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        ?.replace(/<[^>]+>/g, '')
        ?.replace(/&nbsp;/g, ' ')
        ?.replace(/&amp;/g, '&')
        ?.replace(/&lt;/g, '<')
        ?.replace(/&gt;/g, '>')
        ?.replace(/\s{3,}/g, '\n\n')
        ?.trim() || '',
      replyTo: m.replyTo?.[0]?.emailAddress?.address || m.from?.emailAddress?.address || '',
      threadId: m.conversationId,
    }))

    const nextLink = d['@odata.nextLink'] || null
    const res2 = NextResponse.json({ emails, nextLink })
    if (newAccess) res2.cookies.set('ms_access_token', newAccess, { httpOnly: true, secure: true, maxAge: newExpiry, path: '/' })
    if (newRefresh) res2.cookies.set('ms_refresh_token', newRefresh, { httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 30, path: '/' })
    return res2
  }

  if (action === 'archive') {
    const token = await getToken()
    if (!token) return NextResponse.json({ success: false })
    const { emailId } = body
    // Move to a folder called "Oviktigt" (create if needed)
    // First find or create the folder
    let folderId: string | null = null
    const foldersR = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders?$top=50', { headers: { Authorization: `Bearer ${token}` } })
    const foldersD = await foldersR.json()
    const existing = (foldersD.value || []).find((f: any) => f.displayName === 'Arkiverat')
    if (existing) {
      folderId = existing.id
    } else {
      const createR = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Arkiverat' })
      })
      const createD = await createR.json()
      folderId = createD.id
    }
    if (!folderId) return NextResponse.json({ success: false, error: 'Could not get folder' })
    const moveR = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${emailId}/move`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationId: folderId })
    })
    return NextResponse.json({ success: moveR.ok })
  }

  if (action === 'disconnect') {
    const res = NextResponse.json({ success: true })
    res.cookies.delete('ms_access_token')
    res.cookies.delete('ms_refresh_token')
    return res
  }

  if (action === 'saveDraft') {
    const token = await getToken()
    if (!token) return NextResponse.json({ success: false, error: 'Not authenticated' })
    const message = {
      subject: body.subject,
      body: { contentType: 'HTML', content: body.body.replace(/\\n/g,'<br>') },
      toRecipients: [{ emailAddress: { address: body.to } }],
    }
    const r = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    })
    if (r.ok) return NextResponse.json({ success: true })
    return NextResponse.json({ success: false })
  }

  if (action === 'list_next') {
    const { token } = await getTokenObj()
    if (!token) return NextResponse.json({ emails: [] })
    const nextLink = searchParams.get('nextLink') || ''
    if (!nextLink) return NextResponse.json({ emails: [] })
    const r = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [] })
    const emails = d.value.map((m: any) => ({
      id: m.id, subject: m.subject || '(inget ämne)',
      from: m.from?.emailAddress?.address || '',
      fromName: m.from?.emailAddress?.name || '',
      date: m.receivedDateTime, unread: !m.isRead,
      preview: m.bodyPreview?.slice(0, 80) || '',
      body: m.body?.content?.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')?.replace(/<[^>]+>/g,'')?.replace(/&nbsp;/g,' ')?.replace(/&amp;/g,'&').replace(/\s{3,}/g,'\n\n')?.trim() || '',
      replyTo: m.replyTo?.[0]?.emailAddress?.address || m.from?.emailAddress?.address || '',
      threadId: m.conversationId,
    }))
    return NextResponse.json({ emails, nextLink: d['@odata.nextLink'] || null })
  }

  if (action === 'thread_id') {
    const { token } = await getTokenObj()
    if (!token) return NextResponse.json({ emails: [] })
    const threadId = searchParams.get('threadId') || ''
    const filter = encodeURIComponent(`conversationId eq '${threadId}'`)
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$top=20&$orderby=receivedDateTime asc&$filter=${filter}&$select=id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,body,replyTo,conversationId`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [] })
    const emails = d.value.map((m: any) => ({
      id: m.id,
      subject: m.subject || '',
      from: m.from?.emailAddress?.address || '',
      fromName: m.from?.emailAddress?.name || '',
      date: m.receivedDateTime,
      body: m.body?.content?.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')?.replace(/<[^>]+>/g,'')?.replace(/&nbsp;/g,' ')?.replace(/&amp;/g,'&').replace(/\s{3,}/g,'\n\n')?.trim() || '',
    }))
    return NextResponse.json({ emails })
  }

  if (action === 'thread') {
    const { token } = await getTokenObj()
    if (!token) return NextResponse.json({ emails: [], error: 'Not authenticated' })
    const email = searchParams.get('email') || ''
    // Use search for flexible matching (from OR to)
    const searchQ = encodeURIComponent(`"${email}"`)
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$top=50&$search=${searchQ}&$select=id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,body,replyTo,conversationId`,
      { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } }
    )
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [], error: d.error?.message })
    const emails = d.value.map((m: any) => ({
      id: m.id,
      subject: m.subject || '(inget ämne)',
      from: m.from?.emailAddress?.address || '',
      fromName: m.from?.emailAddress?.name || '',
      to: m.toRecipients?.[0]?.emailAddress?.address || '',
      date: m.receivedDateTime,
      unread: !m.isRead,
      preview: m.bodyPreview?.slice(0, 80) || '',
      body: m.body?.content?.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')?.replace(/<[^>]+>/g,'')?.replace(/&nbsp;/g,' ')?.replace(/&amp;/g,'&')?.replace(/&lt;/g,'<')?.replace(/&gt;/g,'>')?.replace(/\s{3,}/g,'\n\n')?.trim() || '',
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

  const accessToken = req.cookies.get('ms_access_token')?.value
  const storedRefresh = req.cookies.get('ms_refresh_token')?.value

  async function getTokenObj(): Promise<{token:string|null,newAccess?:string,newRefresh?:string,newExpiry?:number}> {
    if (accessToken) return { token: accessToken }
    if (storedRefresh) {
      const d = await refreshToken(storedRefresh)
      if (d.access_token) return { token: d.access_token, newAccess: d.access_token, newRefresh: d.refresh_token, newExpiry: d.expires_in }
    }
    return { token: null }
  }

  async function getToken(): Promise<string | null> {
    if (accessToken) return accessToken
    if (storedRefresh) {
      const d = await refreshToken(storedRefresh)
      if (d.access_token) return d.access_token
    }
    return null
  }

  if (action === 'send') {
    const token = await getToken()
    if (!token) return NextResponse.json({ success: false, error: 'Not authenticated' })

    // Bygg HTML-mail med signatur och logga
    const logoUrl = 'https://ht-admin-v2-1.vercel.app/ht-logo.png'
    const bodyLines = body.body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br>')
    const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px">
${bodyLines}
<br><br>
<img src="${logoUrl}" alt="HT Ytrengöring" style="width:140px;height:auto;margin-top:8px;opacity:0.9" />
</div>`

    const message: any = {
      subject: body.subject,
      body: { contentType: 'HTML', content: htmlBody },
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

  if (action === 'archive') {
    const token = await getToken()
    if (!token) return NextResponse.json({ success: false })
    const { emailId } = body
    // Move to a folder called "Oviktigt" (create if needed)
    // First find or create the folder
    let folderId: string | null = null
    const foldersR = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders?$top=50', { headers: { Authorization: `Bearer ${token}` } })
    const foldersD = await foldersR.json()
    const existing = (foldersD.value || []).find((f: any) => f.displayName === 'Arkiverat')
    if (existing) {
      folderId = existing.id
    } else {
      const createR = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Arkiverat' })
      })
      const createD = await createR.json()
      folderId = createD.id
    }
    if (!folderId) return NextResponse.json({ success: false, error: 'Could not get folder' })
    const moveR = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${emailId}/move`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationId: folderId })
    })
    return NextResponse.json({ success: moveR.ok })
  }

  if (action === 'disconnect') {
    const res = NextResponse.json({ success: true })
    res.cookies.delete('ms_access_token')
    res.cookies.delete('ms_refresh_token')
    return res
  }

  if (action === 'saveDraft') {
    const token = await getToken()
    if (!token) return NextResponse.json({ success: false, error: 'Not authenticated' })
    const message = {
      subject: body.subject,
      body: { contentType: 'HTML', content: body.body.replace(/\\n/g,'<br>') },
      toRecipients: [{ emailAddress: { address: body.to } }],
    }
    const r = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    })
    if (r.ok) return NextResponse.json({ success: true })
    return NextResponse.json({ success: false })
  }

  if (action === 'list_next') {
    const { token } = await getTokenObj()
    if (!token) return NextResponse.json({ emails: [] })
    const nextLink = searchParams.get('nextLink') || ''
    if (!nextLink) return NextResponse.json({ emails: [] })
    const r = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [] })
    const emails = d.value.map((m: any) => ({
      id: m.id, subject: m.subject || '(inget ämne)',
      from: m.from?.emailAddress?.address || '',
      fromName: m.from?.emailAddress?.name || '',
      date: m.receivedDateTime, unread: !m.isRead,
      preview: m.bodyPreview?.slice(0, 80) || '',
      body: m.body?.content?.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')?.replace(/<[^>]+>/g,'')?.replace(/&nbsp;/g,' ')?.replace(/&amp;/g,'&').replace(/\s{3,}/g,'\n\n')?.trim() || '',
      replyTo: m.replyTo?.[0]?.emailAddress?.address || m.from?.emailAddress?.address || '',
      threadId: m.conversationId,
    }))
    return NextResponse.json({ emails, nextLink: d['@odata.nextLink'] || null })
  }

  if (action === 'thread_id') {
    const { token } = await getTokenObj()
    if (!token) return NextResponse.json({ emails: [] })
    const threadId = searchParams.get('threadId') || ''
    const filter = encodeURIComponent(`conversationId eq '${threadId}'`)
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$top=20&$orderby=receivedDateTime asc&$filter=${filter}&$select=id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,body,replyTo,conversationId`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [] })
    const emails = d.value.map((m: any) => ({
      id: m.id,
      subject: m.subject || '',
      from: m.from?.emailAddress?.address || '',
      fromName: m.from?.emailAddress?.name || '',
      date: m.receivedDateTime,
      body: m.body?.content?.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')?.replace(/<[^>]+>/g,'')?.replace(/&nbsp;/g,' ')?.replace(/&amp;/g,'&').replace(/\s{3,}/g,'\n\n')?.trim() || '',
    }))
    return NextResponse.json({ emails })
  }

  if (action === 'thread') {
    const { token } = await getTokenObj()
    if (!token) return NextResponse.json({ emails: [], error: 'Not authenticated' })
    const email = searchParams.get('email') || ''
    // Use search for flexible matching (from OR to)
    const searchQ = encodeURIComponent(`"${email}"`)
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$top=50&$search=${searchQ}&$select=id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,body,replyTo,conversationId`,
      { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } }
    )
    const d = await r.json()
    if (!d.value) return NextResponse.json({ emails: [], error: d.error?.message })
    const emails = d.value.map((m: any) => ({
      id: m.id,
      subject: m.subject || '(inget ämne)',
      from: m.from?.emailAddress?.address || '',
      fromName: m.from?.emailAddress?.name || '',
      to: m.toRecipients?.[0]?.emailAddress?.address || '',
      date: m.receivedDateTime,
      unread: !m.isRead,
      preview: m.bodyPreview?.slice(0, 80) || '',
      body: m.body?.content?.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')?.replace(/<[^>]+>/g,'')?.replace(/&nbsp;/g,' ')?.replace(/&amp;/g,'&')?.replace(/&lt;/g,'<')?.replace(/&gt;/g,'>')?.replace(/\s{3,}/g,'\n\n')?.trim() || '',
      replyTo: m.replyTo?.[0]?.emailAddress?.address || m.from?.emailAddress?.address || '',
      threadId: m.conversationId,
    }))
    return NextResponse.json({ emails })
  }

  return NextResponse.json({ error: 'Unknown action' })
}
