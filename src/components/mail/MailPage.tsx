'use client'
import { useState, useEffect, useRef } from 'react'

const STYLE_GUIDE = `
Du är Ida Karlsson, kundansvarig på HT Ytrengöring AB. Du skriver mail på uppdrag av företaget.

SIGNATUR (använd ALLTID exakt denna):
Vänligen,

Ida Karlsson | Kundfrågor | HT Ytrengöring AB

Mejltråden är öppen mellan 07-22 på vardagar

Besöksadress: Storgatan 58, Linköping

SKRIVSÄTT — följ dessa regler exakt:
- Börja alltid med "Hej [namn]," (komma efter namnet, ny rad)
- Tom rad efter hälsningen
- Professionellt, varmt och personligt — som att prata med en vän men ändå seriöst
- Avsluta med en trevlig hälsning t.ex. "Önskar dig en fin dag/kväll/vecka!" innan signaturen
- Tom rad innan signaturen
- Aldrig för kort — ge kunden ordentlig information
- Erbjud alltid kostnadsfritt hembesök vid prisförfrågningar
- Hembesök tar "max en kvart", är "helt kostnadsfria", innefattar "vid önskan en liten provtvätt"
- Ge alltid 2 tidsalternativ för hembesök om relevant
- Bekräfta bokningar med exakt tid och datum

FÖRETAGET:
- HT Ytrengöring AB — fasad- och ytrengöring i Östergötland
- Tjänster: stentvätt (inkl. impregnering, biocid, fogsand), altantvätt, asfaltstvätt, betongtvatt
- Mejltråden öppen 07-22 vardagar
- Besöksadress: Storgatan 58, Linköping

EXEMPEL PÅ KORREKT SVAR (vid prisförfrågan/hembesök):
"Hej [namn],

Varmt välkommen till HT Ytrengöring och tack för din förfrågan till oss.

Vid större uppdrag är det väldigt viktigt för oss att komma ut till platsen för att få en rättvis bild av området och förutsättningarna för uppdraget som också blir underlaget till offerten som är skräddarsydd efter just din tomt.

Våra hembesök är helt kostnadsfria och innefattar vid önskan en liten provtvätt!

Vi har möjlighet att skicka ut en operatör till din adress redan på [dag] vid [tid1] samt även vid [tid2] om någon av dem tiderna skulle passa?
Det är inte ett krav att man är hemma vid besöket, men kan vara en fördel vid önskan om en provtvätt. Besöket tar max en kvart!

Önskar dig en fin [dag/kväll]!

Vänligen,

Ida Karlsson | Kundfrågor | HT Ytrengöring AB

Mejltråden är öppen mellan 07-22 på vardagar

Besöksadress: Storgatan 58, Linköping"

SVARA BARA med mailtexten — ingen förklaring, inga kommentarer.
`

type Folder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'compose'

const FOLDERS: { id: Folder; label: string; icon: string }[] = [
  { id: 'inbox',   label: 'Inkorg',    icon: 'fas fa-inbox' },
  { id: 'sent',    label: 'Skickat',   icon: 'fas fa-paper-plane' },
  { id: 'drafts',  label: 'Utkast',    icon: 'fas fa-file-alt' },
  { id: 'archive', label: 'Arkiverat', icon: 'fas fa-archive' },
  { id: 'compose', label: 'Skriv ny',  icon: 'fas fa-pen' },
]

export default function MailPage({ customers, C, isMobile }: any) {
  const [emails, setEmails] = useState<any[]>([])
  const [drafts, setDrafts] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [editedDraft, setEditedDraft] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [sendLoading, setSendLoading] = useState(false)
  const [sendStatus, setSendStatus] = useState('')
  const [linkedCustomer, setLinkedCustomer] = useState<any>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustSearch, setShowCustSearch] = useState(false)
  const [attachments, setAttachments] = useState<any[]>([])
  const [connected, setConnected] = useState(false)
  const [authUrl, setAuthUrl] = useState('')
  const [folder, setFolder] = useState<Folder>('inbox')
  const [userNote, setUserNote] = useState('')
  const [autoCreateStatus, setAutoCreateStatus] = useState('')
  const [parsedForm, setParsedForm] = useState<any>(null)
  const [archiveStatus, setArchiveStatus] = useState('')
  const [aiCreateLoading, setAiCreateLoading] = useState(false)
  const [threadEmails, setThreadEmails] = useState<any[]>([])
  // Compose / ny mail
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeStatus, setComposeStatus] = useState('')
  // Schemaläggning
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('08:00')
  const fileRef = useRef<HTMLInputElement>(null)
  const composeFileRef = useRef<HTMLInputElement>(null)
  const [composeAttachments, setComposeAttachments] = useState<any[]>([])

  const inp: any = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${C.border}`, background: C.input,
    color: C.text, fontSize: 13, fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box'
  }

  useEffect(() => { checkConnection() }, [])

  async function checkConnection() {
    try {
      const r = await fetch('/api/mail?action=status')
      const d = await r.json()
      setConnected(d.connected)
      if (!d.connected && d.authUrl) setAuthUrl(d.authUrl)
      if (d.connected) { loadEmails('inbox'); loadDrafts() }
    } catch { setConnected(false) }
  }

  const [nextLink, setNextLink] = useState<string|null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  async function loadEmails(f: string) {
    if (f === 'drafts' || f === 'compose') return
    const folderParam = f === 'archive' ? 'archive' : f
    setLoading(true)
    setNextLink(null)
    try {
      const r = await fetch(`/api/mail?action=list&folder=${folderParam}`)
      const d = await r.json()
      setEmails(d.emails || [])
      setNextLink(d.nextLink || null)
    } catch {}
    setLoading(false)
  }

  async function loadMoreEmails() {
    if (!nextLink) return
    setLoadingMore(true)
    try {
      const r = await fetch(`/api/mail?action=list_next&nextLink=${encodeURIComponent(nextLink)}`)
      const d = await r.json()
      setEmails(prev => [...prev, ...(d.emails || [])])
      setNextLink(d.nextLink || null)
    } catch {}
    setLoadingMore(false)
  }

  async function loadDrafts() {
    try {
      const r = await fetch('/api/mail?action=list&folder=drafts')
      const d = await r.json()
      setDrafts(d.emails || [])
    } catch {}
  }

  useEffect(() => {
    if (!connected) return
    if (folder === 'drafts') loadDrafts()
    else if (folder !== 'compose') loadEmails(folder)
  }, [folder])

  async function openEmail(email: any) {
    setSelected(email)
    setEditedDraft('')
    setUserNote('')
    setAttachments([])
    setSendStatus('')
    setAutoCreateStatus('')
    setThreadEmails([])
    
    // Load existing draft if available
    try {
      const draftRes = await fetch('/api/mail?' + new URLSearchParams({ action: 'listDrafts' }))
      const draftData = await draftRes.json()
      const existingDraft = (draftData.emails || []).find((d: any) => 
        d.threadId === email.threadId || 
        (d.to === (email.replyTo || email.from) && d.subject === (email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`))
      )
      if (existingDraft && existingDraft.body) {
        setEditedDraft(existingDraft.body)
      }
    } catch {}
    
    const match = customers.find((c: any) =>
      c.email && email.from && email.from.toLowerCase().includes(c.email.toLowerCase())
    )
    setLinkedCustomer(match || null)
    setCustomerSearch(match ? match.name : '')
    const parsed = parseFormEmail(email.body)
    setParsedForm(parsed)
    if (email.threadId) {
      try {
        const r = await fetch(`/api/mail?action=thread_id&threadId=${encodeURIComponent(email.threadId)}`)
        const d = await r.json()
        const others = (d.emails || []).filter((m: any) => m.id !== email.id)
        setThreadEmails(others)
      } catch {}
    }
  }


  async function archiveMail(emailId: string) {
    try {
      const r = await fetch('/api/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', emailId })
      })
      const d = await r.json()
      if (d.success) {
        setArchiveStatus('✓ Arkiverat')
        setSelected(null)
        loadEmails(folder)
        setTimeout(() => setArchiveStatus(''), 2000)
      }
    } catch {}
  }

  async function generateAiDraft() {
    if (!selected) return
    setAiLoading(true)
    setEditedDraft('')
    try {
      const custContext = linkedCustomer ? `\nKopplad kund: ${linkedCustomer.name}\nAdress: ${linkedCustomer.address || ''}\nPris: ${linkedCustomer.price_excl_vat || ''} kr\nAnteckning: ${linkedCustomer.note || ''}\n` : ''
      const prompt = `${STYLE_GUIDE}\n${custContext}\nINKOMMANDE MAIL:\nFrån: ${selected.from}\nÄmne: ${selected.subject}\nDatum: ${selected.date}\nInnehåll:\n${selected.body}\n${userNote ? `\nMINA INSTRUKTIONER:\n${userNote}` : ''}\n\nSkriv ett professionellt svar. Svara BARA med mailtexten.`
      const r = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, customers: [] })
      })
      const d = await r.json()
      const draft = d.reply || d.message || ''
      setEditedDraft(draft)
      
      // Auto-save as draft
      if (draft.trim()) {
        await fetch('/api/mail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'saveDraft',
            to: selected.replyTo || selected.from,
            subject: selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`,
            body: draft,
            threadId: selected.threadId
          })
        })
        loadDrafts()
      }
    } catch { setEditedDraft('Kunde inte generera svar. Försök igen.') }
    setAiLoading(false)
  }

  async function improveText() {
    if (!editedDraft.trim()) return
    setAiLoading(true)
    try {
      const r = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `${STYLE_GUIDE}\n\nFörbättra detta mailutkast. Behåll innehållet men gör det mer professionellt i Ida Karlssons stil. Svara BARA med mailtexten:\n\n${editedDraft}`, customers: [] })
      })
      const d = await r.json()
      setEditedDraft(d.reply || d.message || editedDraft)
    } catch {}
    setAiLoading(false)
  }

  async function sendMail(opts: { to: string; subject: string; body: string; threadId?: string; attachs?: any[]; scheduledAt?: string }) {
    const r = await fetch('/api/mail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', to: opts.to, subject: opts.subject, body: opts.body, threadId: opts.threadId, attachments: opts.attachs || [], scheduledAt: opts.scheduledAt })
    })
    return r.json()
  }

  async function sendReply() {
    if (!selected || !editedDraft.trim()) return
    setSendLoading(true)
    setSendStatus('')
    const scheduledAt = showSchedule && scheduleDate ? `${scheduleDate}T${scheduleTime}:00` : undefined
    try {
      const d = await sendMail({ to: selected.replyTo || selected.from, subject: selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`, body: editedDraft, threadId: selected.threadId, attachs: attachments, scheduledAt })
      if (d.success) {
        setSendStatus(scheduledAt ? `✓ Schemalagd — ${new Date(scheduledAt).toLocaleString('sv-SE')}` : '✓ Skickat!')
        if (!scheduledAt) setTimeout(() => { setSelected(null); loadEmails(folder) }, 1500)
      } else { setSendStatus('Fel: ' + (d.error || 'Kunde inte skicka')) }
    } catch (e: any) { setSendStatus('Fel: ' + e.message) }
    setSendLoading(false)
  }

  async function saveDraft() {
    if (!selected && !composeTo) return
    try {
      await fetch('/api/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveDraft', to: selected ? (selected.replyTo || selected.from) : composeTo, subject: selected ? (selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`) : composeSubject, body: selected ? editedDraft : composeBody })
      })
      setSendStatus('✓ Sparat som utkast')
      loadDrafts()
    } catch {}
  }

  async function sendNewMail() {
    if (!composeTo || !composeSubject || !composeBody.trim()) return
    setComposeStatus('Skickar...')
    const scheduledAt = showSchedule && scheduleDate ? `${scheduleDate}T${scheduleTime}:00` : undefined
    try {
      const d = await sendMail({ to: composeTo, subject: composeSubject, body: composeBody, attachs: composeAttachments, scheduledAt })
      if (d.success) {
        setComposeStatus(scheduledAt ? `✓ Schemalagd — ${new Date(scheduledAt).toLocaleString('sv-SE')}` : '✓ Skickat!')
        if (!scheduledAt) { setComposeTo(''); setComposeSubject(''); setComposeBody(''); setComposeAttachments([]) }
      } else { setComposeStatus('Fel: ' + (d.error || 'Kunde inte skicka')) }
    } catch (e: any) { setComposeStatus('Fel: ' + e.message) }
  }

  function handleFileAttach(e: any, forCompose = false) {
    Array.from(e.target.files || []).forEach((file: any) => {
      const reader = new FileReader()
      reader.onload = (ev: any) => {
        const att = { name: file.name, content: ev.target.result.split(',')[1], contentType: file.type }
        if (forCompose) setComposeAttachments(prev => [...prev, att])
        else setAttachments(prev => [...prev, att])
      }
      reader.readAsDataURL(file)
    })
  }

  async function disconnectMail() {
    if (!confirm('Logga ut från mail?')) return
    await fetch('/api/mail', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'disconnect' }) })
    setConnected(false)
    setEmails([])
    setSelected(null)
  }

  function fmtMailDate(d: string) {
    if (!d) return ''
    const dt = new Date(d)
    const now = new Date()
    const isToday = dt.toDateString() === now.toDateString()
    if (isToday) return dt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    return dt.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
  }


  // Parse formulärmail (Nytt lead / kontaktformulär)
  async function aiCreateCustomer() {
    if (!selected) return
    setAiCreateLoading(true)
    setAutoCreateStatus('')
    try {
      const r = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Extrahera kunduppgifter från detta mail. Avsändarens uppgifter är primär källa.\n\nAVSÄNDARE:\nNamn: ${selected.fromName || selected.from}\nE-post: ${selected.from}\n\nMAILINNEHÅLL:\nÄmne: ${selected.subject}\n${selected.body}\n\nReturnera ENBART JSON: {"name":"<avsändarens namn>","phone":"<telefon eller >","email":"<avsändarens mail>","address":"<adress eller >","note":"<vad kunden vill>"}`,
          customers: []
        })
      })
      const d = await r.json()
      const text = d.reply || d.message || ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0])
        if (!data.email || data.email === '') data.email = selected.from
        if (!data.name || data.name === '') data.name = selected.fromName || selected.from.split('@')[0]
        await autoCreateCustomer(data)
      } else {
        setAutoCreateStatus('AI kunde inte extrahera uppgifter')
      }
    } catch (e: any) {
      setAutoCreateStatus('Fel: ' + e.message)
    }
    setAiCreateLoading(false)
  }

  function parseFormEmail(body: string): any {
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
    const data: any = {}
    const fieldMap: Record<string,string> = {
      'namn': 'name', 'name': 'name',
      'e-post': 'email', 'email': 'email', 'e-postadress': 'email',
      'telefon': 'phone', 'phone': 'phone', 'tel': 'phone',
      'adress': 'address', 'address': 'address', 'gatuadress': 'address',
      'meddelande': 'message', 'message': 'message', 'kommentar': 'message',
      'postnummer': 'zip', 'ort': 'city', 'stad': 'city',
    }
    for (const line of lines) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().toLowerCase()
        const val = line.slice(colonIdx + 1).trim()
        if (val && fieldMap[key]) data[fieldMap[key]] = val
      }
    }
    return Object.keys(data).length >= 2 ? data : null
  }

  async function autoCreateCustomer(formData: any) {
    if (!formData?.name) return
    setAutoCreateStatus('Skapar kund...')
    try {
      const { db: fsDb } = await import('@/lib/firebase')
      const { collection, addDoc } = await import('firebase/firestore')
      const address = [formData.address, formData.zip, formData.city].filter(Boolean).join(', ')
      await addDoc(collection(fsDb, 'customers'), {
        name: formData.name,
        phone: formData.phone || '',
        email: formData.email || '',
        address: address || '',
        note: formData.message || '',
        services: '[]',
        service_kvm: '{}',
        service_progress: '{}',
        skipped_steps: '{}',
        include_fogsand: false,
        price_excl_vat: 0,
        status: 'new',
        rejected: false,
        created_at: new Date().toISOString(),
        source: 'mail',
      })
      setAutoCreateStatus('✓ Kund skapad!')
      setTimeout(() => setAutoCreateStatus(''), 3000)
    } catch (e: any) {
      setAutoCreateStatus('Fel: ' + e.message)
    }
  }

  // ── ThreadView helper component ─────────────────────────────
  function ThreadView({ emails, selected, C }: { emails: any[]; selected: any; C: any }) {
    const [open, setOpen] = useState(false)
    if (!emails.length) return null
    return (
      <div style={{ padding: '0 22px 20px' }}>
        <button onClick={() => setOpen(!open)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginBottom: open ? 12 : 0, fontWeight: 600, width: '100%', justifyContent: 'space-between' }}>
          <span><i className="fas fa-history" style={{ marginRight: 6 }} /> Tidigare i tråden ({emails.length} mail)</span>
          <i className={`fas fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 11 }} />
        </button>
        {open && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[...emails].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((email: any) => (
              <div key={email.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${C.primary}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.primary }}>{(email.fromName || email.from || '?')[0].toUpperCase()}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{email.fromName || email.from}</div>
                    <div style={{ fontSize: 11, color: C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email.subject}</div>
                  </div>
                  <div style={{ fontSize: 11, color: C.textSec, flexShrink: 0 }}>
                    {new Date(email.date).toLocaleString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {/* Body */}
                <div style={{ padding: '12px 14px', background: C.surface }}>
                  <pre style={{ fontSize: 12, color: C.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, maxHeight: 200, overflow: 'hidden' }}>{email.body}</pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!connected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 20, padding: 40 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: `${C.primary}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="fas fa-envelope" style={{ fontSize: 28, color: C.primary }} />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }}>Koppla din mail</h2>
        <p style={{ color: C.textSec, fontSize: 14, textAlign: 'center', maxWidth: 400, lineHeight: 1.6, margin: 0 }}>
          Koppla ditt Microsoft-konto (Outlook / GoDaddy) för att hantera mail direkt i admin med AI-assistans.
        </p>
        {authUrl
          ? <a href={authUrl} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 24px', background: '#0078d4', color: 'white', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
              <i className="fab fa-microsoft" /> Logga in med Microsoft
            </a>
          : <button onClick={checkConnection} style={{ padding: '12px 24px', background: C.primary, color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
              <i className="fas fa-plug" /> Anslut mail
            </button>
        }
      </div>
    )
  }

  const listEmails = folder === 'drafts' ? drafts : emails
  const unreadCount = emails.filter(e => e.unread).length

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', overflow: 'hidden' }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width: isMobile ? 52 : 180, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', paddingTop: 8 }}>
        {FOLDERS.map(f => (
          <div key={f.id} onClick={() => { setFolder(f.id); setSelected(null) }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 0' : '9px 14px', margin: '1px 6px', borderRadius: 7, cursor: 'pointer', background: folder === f.id ? `${C.primary}15` : 'transparent', color: folder === f.id ? C.primary : C.textSec, fontWeight: folder === f.id ? 600 : 400, fontSize: 13, transition: 'all 0.1s', justifyContent: isMobile ? 'center' : 'flex-start' }}>
            <i className={f.icon} style={{ fontSize: 14, width: 16, textAlign: 'center' }} />
            {!isMobile && <span>{f.label}</span>}
            {!isMobile && f.id === 'inbox' && unreadCount > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, background: C.primary, color: 'white', borderRadius: 9999, padding: '1px 7px' }}>{unreadCount}</span>
            )}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ padding: '8px 14px', paddingBottom: 12 }}>
          <button onClick={disconnectMail}
            style={{ width: '100%', padding: '6px 0', background: 'transparent', border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 6, color: '#ef4444', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 6 }}>
            <i className="fas fa-sign-out-alt" />{!isMobile && ' Logga ut'}
          </button>
          <button onClick={() => { loadEmails(folder === 'drafts' ? 'inbox' : folder); loadDrafts() }}
            style={{ width: '100%', padding: '6px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <i className="fas fa-sync-alt" />{!isMobile && ' Uppdatera'}
          </button>
        </div>
      </div>

      {/* ── MAIL-LISTA ── */}
      {folder !== 'compose' && (
        <div style={{ width: isMobile ? 'calc(100% - 52px)' : 280, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', ...(isMobile && selected ? { display: 'none' } : {}) }}>
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{FOLDERS.find(f => f.id === folder)?.label}
            {folder === 'inbox' && unreadCount > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: C.textSec, fontWeight: 400 }}>{unreadCount} olästa</span>}</span>
            {archiveStatus && <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>{archiveStatus}</span>}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.textSec, fontSize: 13 }}><i className="fas fa-spinner fa-spin" /> Laddar...</div>
            ) : listEmails.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.textSec, fontSize: 13 }}>Inga mail</div>
            ) : listEmails.map(email => {
              const cust = customers.find((c: any) => c.email && email.from?.toLowerCase().includes(c.email.toLowerCase()))
              const isSel = selected?.id === email.id
              return (
                <div key={email.id} onClick={() => openEmail(email)}
                  style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', background: isSel ? `${C.primary}12` : 'transparent', borderLeft: isSel ? `3px solid ${C.primary}` : '3px solid transparent', transition: 'background 0.1s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: email.unread ? 700 : 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 155 }}>
                      {email.fromName || email.from}
                    </span>
                    <span style={{ fontSize: 10, color: C.textSec, flexShrink: 0 }}>{fmtMailDate(email.date)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: email.unread ? C.text : C.textSec, fontWeight: email.unread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                    {email.subject}
                  </div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    {cust && <span style={{ fontSize: 10, padding: '1px 6px', background: `${C.primary}15`, color: C.primary, borderRadius: 9999, fontWeight: 600, flexShrink: 0 }}>{cust.name}</span>}
                    <span style={{ fontSize: 11, color: C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{email.preview}</span>
                    <button onClick={e=>{e.stopPropagation();archiveMail(email.id)}} title="Arkivera"
                      style={{ flexShrink: 0, width: 20, height: 20, background: 'transparent', border: 'none', color: C.textSec, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, opacity: 0.6 }}
                      onMouseEnter={e=>(e.currentTarget.style.opacity='1')} onMouseLeave={e=>(e.currentTarget.style.opacity='0.6')}>
                      <i className="fas fa-archive"/>
                    </button>
                  </div>
                </div>
              )
            })}
          {nextLink && (
            <div style={{ padding: '12px', textAlign: 'center', borderTop: `1px solid ${C.border}` }}>
              <button onClick={loadMoreEmails} disabled={loadingMore}
                style={{ padding: '7px 20px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                {loadingMore ? <><i className="fas fa-spinner fa-spin"/> Laddar...</> : <><i className="fas fa-chevron-down"/> Ladda fler mail</>}
              </button>
            </div>
          )}
          </div>
        </div>
      )}

      {/* ── COMPOSE ── */}
      {folder === 'compose' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 700, color: C.text }}>
            <i className="fas fa-pen" style={{ color: C.primary, marginRight: 8 }} /> Nytt mail
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'grid', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec, display: 'block', marginBottom: 4 }}>Till</label>
                <input value={composeTo} onChange={e => setComposeTo(e.target.value)} placeholder="mottagare@email.se" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec, display: 'block', marginBottom: 4 }}>Ämne</label>
                <input value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Ämnesrad" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec, display: 'block', marginBottom: 4 }}>Meddelande</label>
                <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} rows={14} placeholder="Skriv ditt meddelande..." style={{ ...inp, resize: 'vertical' as const, lineHeight: 1.7 }} />
              </div>
            </div>

            {/* Bilagor */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 16, alignItems: 'center' }}>
              <button onClick={() => composeFileRef.current?.click()} style={{ padding: '5px 12px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                <i className="fas fa-paperclip" /> Bifoga
              </button>
              <input ref={composeFileRef} type="file" multiple style={{ display: 'none' }} onChange={e => handleFileAttach(e, true)} />
              {composeAttachments.map((a, i) => (
                <span key={i} style={{ padding: '3px 10px', background: `${C.primary}12`, border: `1px solid ${C.primary}25`, borderRadius: 9999, fontSize: 11, color: C.primary, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <i className="fas fa-file" /> {a.name}
                  <span onClick={() => setComposeAttachments(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#ef4444' }}>✕</span>
                </span>
              ))}
            </div>

            {/* Schemaläggning */}
            <div style={{ marginBottom: 16 }}>
              <button onClick={() => setShowSchedule(!showSchedule)} style={{ padding: '5px 12px', background: showSchedule ? `${C.primary}15` : 'transparent', border: `1px solid ${showSchedule ? C.primary : C.border}`, borderRadius: 6, color: showSchedule ? C.primary : C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: showSchedule ? 600 : 400 }}>
                <i className="fas fa-clock" /> Schemalägg sändning
              </button>
              {showSchedule && (
                <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' as const }}>
                  <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} style={{ ...inp, width: 'auto', colorScheme: 'dark' }} />
                  <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={{ ...inp, width: 'auto', colorScheme: 'dark' }} />
                  {scheduleDate && <span style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>Skickas {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
              <button onClick={sendNewMail} disabled={!composeTo || !composeSubject || !composeBody.trim()}
                style={{ padding: '10px 28px', background: C.primary, color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: (!composeTo || !composeSubject || !composeBody.trim()) ? 0.5 : 1 }}>
                <i className="fas fa-paper-plane" /> {showSchedule && scheduleDate ? 'Schemalägg' : 'Skicka'}
              </button>
              <button onClick={() => { saveDraft(); setFolder('drafts') }} style={{ padding: '10px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                <i className="fas fa-save" /> Spara utkast
              </button>
              {composeStatus && <span style={{ fontSize: 13, fontWeight: 600, color: composeStatus.startsWith('✓') ? '#10b981' : '#ef4444' }}>{composeStatus}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── MAIL DETALJ ── */}
      {folder !== 'compose' && (
        selected ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              {isMobile && <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: C.textSec, cursor: 'pointer', fontSize: 18, padding: 0 }}><i className="fas fa-arrow-left" /></button>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2 }}>{selected.subject}</div>
                <div style={{ fontSize: 12, color: C.textSec }}><strong style={{ color: C.text }}>{selected.fromName || selected.from}</strong> · {new Date(selected.date).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              {/* Arkivera */}
              <button onClick={() => archiveMail(selected.id)} title="Arkivera"
                style={{ padding: '5px 10px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                <i className="fas fa-archive" /> Arkivera
              </button>
              {/* Koppla kund */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button onClick={() => setShowCustSearch(!showCustSearch)}
                  style={{ padding: '5px 10px', background: linkedCustomer ? `${C.primary}15` : 'transparent', border: `1px solid ${linkedCustomer ? C.primary : C.border}`, borderRadius: 6, color: linkedCustomer ? C.primary : C.textSec, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  <i className="fas fa-user-tag" /> {linkedCustomer ? linkedCustomer.name : 'Koppla kund'}
                </button>
                {showCustSearch && (
                  <div style={{ position: 'absolute', top: '110%', right: 0, width: 240, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 100, boxShadow: '0 8px 30px rgba(0,0,0,0.3)', padding: 8 }}>
                    <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="Sök kund..." style={{ ...inp, marginBottom: 6 }} autoFocus />
                    <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                      {customers.filter((c: any) => c.name.toLowerCase().includes(customerSearch.toLowerCase())).slice(0, 8).map((c: any) => (
                        <div key={c.id} onClick={() => { setLinkedCustomer(c); setCustomerSearch(c.name); setShowCustSearch(false) }}
                          style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: C.text }}
                          onMouseEnter={e => (e.currentTarget.style.background = `${C.primary}15`)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <div style={{ fontWeight: 600 }}>{c.name}</div>
                          <div style={{ color: C.textSec, fontSize: 11 }}>{c.address}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 40px' }}>

              {/* ── AI-SVAR ÖVERST (som Outlook) ── */}
              <div style={{ padding: '16px 22px', borderBottom: `1px solid ${C.border}`, background: `${C.primary}04` }}>
                {/* Kundinfo kompakt */}
                {linkedCustomer && (
                  <div style={{ marginBottom: 10, padding: '8px 12px', background: `${C.primary}08`, border: `1px solid ${C.primary}20`, borderRadius: 8, display: 'flex', gap: 14, flexWrap: 'wrap' as const, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.primary }}><i className="fas fa-user" /> {linkedCustomer.name}</span>
                    {linkedCustomer.address && <span style={{ fontSize: 11, color: C.textSec }}><i className="fas fa-map-marker-alt" /> {linkedCustomer.address}</span>}
                    {linkedCustomer.price_excl_vat && <span style={{ fontSize: 11, color: C.textSec }}><i className="fas fa-coins" /> {parseFloat(linkedCustomer.price_excl_vat).toLocaleString('sv')} kr</span>}
                    {linkedCustomer.note && <span style={{ fontSize: 11, color: C.textSec, fontStyle: 'italic' }}>{linkedCustomer.note}</span>}
                  </div>
                )}

                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSec, marginBottom: 5 }}>Instruktioner till AI <span style={{ fontWeight: 400 }}>(valfritt)</span></label>
                  <textarea value={userNote} onChange={e => setUserNote(e.target.value)} rows={2}
                    placeholder="T.ex. 'Erbjud tisdag 8 april kl 10 och 14', 'Vi är fullt bokade i april'..."
                    style={{ ...inp, resize: 'vertical' as const }} />
                </div>

                <button onClick={generateAiDraft} disabled={aiLoading}
                  style={{ padding: '8px 18px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: aiLoading ? 'default' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: editedDraft ? 14 : 0, opacity: aiLoading ? 0.7 : 1 }}>
                  {aiLoading ? <><i className="fas fa-spinner fa-spin" /> Genererar...</> : <><i className="fas fa-magic" /> Generera AI-svar</>}
                </button>

                {editedDraft && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec }}>Svar — redigera fritt</label>
                      <button onClick={improveText} disabled={aiLoading}
                        style={{ padding: '4px 12px', background: 'transparent', border: `1px solid #8b5cf6`, borderRadius: 6, color: '#8b5cf6', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                        <i className="fas fa-wand-magic-sparkles" /> Finskriv
                      </button>
                    </div>
                    <textarea value={editedDraft} onChange={e => setEditedDraft(e.target.value)} rows={13}
                      style={{ ...inp, resize: 'vertical' as const, lineHeight: 1.7 }} />

                    {/* Bilagor */}
                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' }}>
                      <button onClick={() => fileRef.current?.click()} style={{ padding: '5px 12px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                        <i className="fas fa-paperclip" /> Bifoga fil
                      </button>
                      <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => handleFileAttach(e, false)} />
                      {attachments.map((a, i) => (
                        <span key={i} style={{ padding: '3px 10px', background: `${C.primary}12`, border: `1px solid ${C.primary}25`, borderRadius: 9999, fontSize: 11, color: C.primary, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <i className="fas fa-file" /> {a.name}
                          <span onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#ef4444' }}>✕</span>
                        </span>
                      ))}
                    </div>

                    {/* Schemaläggning */}
                    <div style={{ marginTop: 12 }}>
                      <button onClick={() => setShowSchedule(!showSchedule)}
                        style={{ padding: '5px 12px', background: showSchedule ? `${C.primary}15` : 'transparent', border: `1px solid ${showSchedule ? C.primary : C.border}`, borderRadius: 6, color: showSchedule ? C.primary : C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: showSchedule ? 600 : 400 }}>
                        <i className="fas fa-clock" /> Schemalägg sändning
                      </button>
                      {showSchedule && (
                        <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' as const }}>
                          <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} style={{ ...inp, width: 'auto', colorScheme: 'dark' }} />
                          <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={{ ...inp, width: 'auto', colorScheme: 'dark' }} />
                          {scheduleDate && <span style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>Skickas {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                        </div>
                      )}
                    </div>

                    {/* Skicka / spara utkast */}
                    <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', paddingTop: 14, borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' as const }}>
                      <button onClick={sendReply} disabled={sendLoading || !editedDraft.trim()}
                        style={{ padding: '10px 26px', background: C.primary, color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: sendLoading ? 0.7 : 1 }}>
                        {sendLoading ? <><i className="fas fa-spinner fa-spin" /> Skickar...</> : <><i className="fas fa-paper-plane" /> {showSchedule && scheduleDate ? 'Schemalägg' : 'Skicka svar'}</>}
                      </button>
                      <button onClick={saveDraft} style={{ padding: '10px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                        <i className="fas fa-save" /> Spara utkast
                      </button>
                      {sendStatus && <span style={{ fontSize: 13, fontWeight: 600, color: sendStatus.startsWith('✓') ? '#10b981' : '#ef4444' }}>{sendStatus}</span>}
                    </div>
                  </div>
                )}
              </div>

              {/* ── SENASTE MAILET (under AI-svar) ── */}
              <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.border}` }}>
                {/* Mail-header Outlook-stil */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: '8px 8px 0 0', marginBottom: 0 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${C.primary}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.primary }}>{(selected.fromName || selected.from || '?')[0].toUpperCase()}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{selected.fromName || selected.from}</div>
                    <div style={{ fontSize: 11, color: C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.from}</div>
                  </div>
                  <div style={{ fontSize: 11, color: C.textSec, flexShrink: 0 }}>
                    {new Date(selected.date).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {parsedForm ? (
                  <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 14px', background: '#22c55e08', borderBottom: '1px solid #22c55e25' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', marginBottom: 8 }}><i className="fas fa-wpforms" /> Formulärmail — kontaktuppgifter</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                        {Object.entries(parsedForm).map(([k,v]:any) => (
                          <div key={k} style={{ fontSize: 12, color: C.text }}><span style={{ color: C.textSec, fontWeight: 600 }}>{k === 'name' ? 'Namn' : k === 'email' ? 'E-post' : k === 'phone' ? 'Telefon' : k === 'address' ? 'Adress' : k === 'message' ? 'Meddelande' : k}:</span> {v}</div>
                        ))}
                      </div>
                      {!linkedCustomer && (
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                          <button onClick={() => autoCreateCustomer(parsedForm)}
                            style={{ padding: '6px 14px', background: '#22c55e', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                            <i className="fas fa-user-plus" /> Skapa kund (formulär)
                          </button>
                          <button onClick={aiCreateCustomer} disabled={aiCreateLoading}
                            style={{ padding: '6px 14px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: aiCreateLoading ? 0.7 : 1 }}>
                            {aiCreateLoading ? <><i className="fas fa-spinner fa-spin" /> Analyserar...</> : <><i className="fas fa-magic" /> AI skapar kund</>}
                          </button>
                          {autoCreateStatus && <span style={{ fontSize: 12, fontWeight: 600, color: autoCreateStatus.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{autoCreateStatus}</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '14px 16px', background: C.surface }}>
                      <pre style={{ fontSize: 13, color: C.textSec, lineHeight: 1.75, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{selected.body}</pre>
                    </div>
                  </div>
                ) : (
                  <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', background: C.surface }}>
                    <div style={{ padding: '14px 16px' }}>
                      <pre style={{ fontSize: 13, color: C.text, lineHeight: 1.75, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{selected.body}</pre>
                    </div>
                    {!linkedCustomer && (
                      <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
                        <button onClick={aiCreateCustomer} disabled={aiCreateLoading}
                          style={{ padding: '6px 14px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: aiCreateLoading ? 0.7 : 1 }}>
                          {aiCreateLoading ? <><i className="fas fa-spinner fa-spin" /> Analyserar...</> : <><i className="fas fa-magic" /> AI skapar kund</>}
                        </button>
                        {autoCreateStatus && <span style={{ fontSize: 12, fontWeight: 600, color: autoCreateStatus.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{autoCreateStatus}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── TIDIGARE TRÅD LÄNGST NED (kollapsbar) ── */}
              {threadEmails.length > 0 && (
                <ThreadView emails={threadEmails} selected={selected} C={C} />
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: C.textSec }}>
              <i className="fas fa-envelope-open" style={{ fontSize: 48, display: 'block', marginBottom: 12, opacity: 0.2 }} />
              <div style={{ fontSize: 14 }}>Välj ett mail från listan</div>
            </div>
          </div>
        )
      )}
    </div>
  )
}
