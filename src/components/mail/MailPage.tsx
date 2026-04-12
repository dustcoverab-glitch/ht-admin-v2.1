'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

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

// ══════════════════════════════════════════════════════
//  RichTextEditor — Outlook-liknande formateringsverktygsfält
// ══════════════════════════════════════════════════════
function RichTextEditor({
  value, onChange, placeholder = 'Skriv ditt meddelande...', C, rows = 14
}: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; C: any; rows?: number
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isInternalChange = useRef(false)
  const savedRange = useRef<Range | null>(null)

  // Sync plain-text value → HTML (only when external change)
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (isInternalChange.current) { isInternalChange.current = false; return }
    // Convert plain text to HTML (preserve line breaks)
    const html = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
    if (el.innerHTML !== html) el.innerHTML = html
  }, [value])

  function saveSelection() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange()
  }

  function restoreSelection() {
    if (!savedRange.current) return
    const sel = window.getSelection()
    if (sel) { sel.removeAllRanges(); sel.addRange(savedRange.current) }
  }

  function exec(cmd: string, value?: string) {
    restoreSelection()
    editorRef.current?.focus()
    document.execCommand(cmd, false, value)
    notifyChange()
  }

  function notifyChange() {
    if (!editorRef.current) return
    isInternalChange.current = true
    // Extract text with newlines
    const text = editorRef.current.innerHTML
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
    onChange(text)
  }

  function insertLink() {
    const url = prompt('URL:')
    if (url) exec('createLink', url)
  }

  function setFontSize(size: string) {
    // execCommand fontSize uses 1-7 scale — we use inline style instead
    restoreSelection()
    editorRef.current?.focus()
    document.execCommand('fontSize', false, '7')
    // Replace all <font size="7"> with proper inline style
    if (editorRef.current) {
      editorRef.current.querySelectorAll('font[size="7"]').forEach(el => {
        const span = document.createElement('span')
        span.style.fontSize = size
        span.innerHTML = (el as HTMLElement).innerHTML
        el.parentNode?.replaceChild(span, el)
      })
    }
    notifyChange()
  }

  const toolBtn = (active = false) => ({
    padding: '4px 7px', minWidth: 28, background: active ? `${C.primary}20` : 'transparent',
    border: `1px solid ${active ? C.primary : 'transparent'}`, borderRadius: 4,
    color: active ? C.primary : C.textSec, fontSize: 13, cursor: 'pointer',
    fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.1s', height: 28,
  })

  const divider = { width: 1, height: 20, background: C.border, margin: '0 4px', flexShrink: 0 as const }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.input }}>
      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '5px 8px', borderBottom: `1px solid ${C.border}`, background: C.surface, flexWrap: 'wrap' as const }}>

        {/* Font family */}
        <select onChange={e => exec('fontName', e.target.value)} defaultValue=""
          style={{ ...toolBtn(), padding: '0 6px', fontSize: 12, height: 28, border: `1px solid ${C.border}`, background: C.input, color: C.text, borderRadius: 4, cursor: 'pointer', minWidth: 90 }}>
          <option value="" disabled>Font</option>
          <option value="inherit">Standard</option>
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Courier New">Courier New</option>
          <option value="Trebuchet MS">Trebuchet</option>
          <option value="Verdana">Verdana</option>
        </select>

        {/* Font size */}
        <select onChange={e => setFontSize(e.target.value)} defaultValue=""
          style={{ ...toolBtn(), padding: '0 6px', fontSize: 12, height: 28, border: `1px solid ${C.border}`, background: C.input, color: C.text, borderRadius: 4, cursor: 'pointer', minWidth: 60 }}>
          <option value="" disabled>Storlek</option>
          {['10px','12px','14px','16px','18px','20px','24px','28px','32px'].map(s => (
            <option key={s} value={s}>{s.replace('px','')}</option>
          ))}
        </select>

        <div style={divider} />

        {/* Bold / Italic / Underline / Strikethrough */}
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('bold') }} style={toolBtn()} title="Fet (Ctrl+B)">
          <strong style={{ fontSize: 13 }}>B</strong>
        </button>
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('italic') }} style={toolBtn()} title="Kursiv (Ctrl+I)">
          <em style={{ fontSize: 13, fontStyle: 'italic' }}>I</em>
        </button>
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('underline') }} style={toolBtn()} title="Understrykning (Ctrl+U)">
          <span style={{ textDecoration: 'underline', fontSize: 13 }}>U</span>
        </button>
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('strikeThrough') }} style={toolBtn()} title="Genomstrykning">
          <span style={{ textDecoration: 'line-through', fontSize: 13 }}>S</span>
        </button>

        <div style={divider} />

        {/* Text color */}
        <label title="Textfärg" style={{ ...toolBtn(), position: 'relative' as const, overflow: 'visible' }}>
          <i className="fas fa-font" style={{ fontSize: 12 }} />
          <input type="color" defaultValue="#0078d4"
            onChange={e => { restoreSelection(); exec('foreColor', e.target.value) }}
            onMouseDown={() => saveSelection()}
            style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', top: 0, left: 0, cursor: 'pointer' }} />
        </label>

        {/* Highlight color */}
        <label title="Markeringsfärg" style={{ ...toolBtn(), position: 'relative' as const, overflow: 'visible' }}>
          <i className="fas fa-highlighter" style={{ fontSize: 12 }} />
          <input type="color" defaultValue="#ffff00"
            onChange={e => { restoreSelection(); exec('hiliteColor', e.target.value) }}
            onMouseDown={() => saveSelection()}
            style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', top: 0, left: 0, cursor: 'pointer' }} />
        </label>

        <div style={divider} />

        {/* Alignment */}
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('justifyLeft') }} style={toolBtn()} title="Vänsterjustera">
          <i className="fas fa-align-left" style={{ fontSize: 11 }} />
        </button>
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('justifyCenter') }} style={toolBtn()} title="Centrera">
          <i className="fas fa-align-center" style={{ fontSize: 11 }} />
        </button>
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('justifyRight') }} style={toolBtn()} title="Högerjustera">
          <i className="fas fa-align-right" style={{ fontSize: 11 }} />
        </button>

        <div style={divider} />

        {/* Lists */}
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('insertUnorderedList') }} style={toolBtn()} title="Punktlista">
          <i className="fas fa-list-ul" style={{ fontSize: 11 }} />
        </button>
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('insertOrderedList') }} style={toolBtn()} title="Numrerad lista">
          <i className="fas fa-list-ol" style={{ fontSize: 11 }} />
        </button>

        {/* Indent */}
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('indent') }} style={toolBtn()} title="Indrag">
          <i className="fas fa-indent" style={{ fontSize: 11 }} />
        </button>
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('outdent') }} style={toolBtn()} title="Minska indrag">
          <i className="fas fa-outdent" style={{ fontSize: 11 }} />
        </button>

        <div style={divider} />

        {/* Link */}
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); insertLink() }} style={toolBtn()} title="Infoga länk">
          <i className="fas fa-link" style={{ fontSize: 11 }} />
        </button>

        {/* Clear formatting */}
        <button onMouseDown={e => { e.preventDefault(); saveSelection(); exec('removeFormat') }} style={toolBtn()} title="Rensa formatering">
          <i className="fas fa-remove-format" style={{ fontSize: 11 }} />
        </button>
      </div>

      {/* ── Editor area ── */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={notifyChange}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onFocus={saveSelection}
        data-placeholder={placeholder}
        style={{
          minHeight: `${rows * 1.8}em`, maxHeight: '60vh', overflowY: 'auto',
          padding: '12px 14px', outline: 'none', fontSize: 14, lineHeight: 1.8,
          color: C.text, fontFamily: 'inherit', wordBreak: 'break-word',
        }}
      />
      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: ${C.textSec};
          opacity: 0.6;
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}

export default function MailPage({ customers, C, isMobile }: any) {
  const [emails, setEmails] = useState<any[]>([])
  const [drafts, setDrafts] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(false)
  const [authUrl, setAuthUrl] = useState('')
  const [folder, setFolder] = useState<Folder>('inbox')
  const [nextLink, setNextLink] = useState<string|null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [archiveStatus, setArchiveStatus] = useState('')
  const [linkedCustomer, setLinkedCustomer] = useState<any>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustSearch, setShowCustSearch] = useState(false)
  const [parsedForm, setParsedForm] = useState<any>(null)
  const [threadEmails, setThreadEmails] = useState<any[]>([])
  const [showThread, setShowThread] = useState(false)

  // Svar-panel (Outlook inline reply)
  const [replyOpen, setReplyOpen] = useState(false)
  const [editedDraft, setEditedDraft] = useState('')
  const [currentDraftId, setCurrentDraftId] = useState<string|null>(null)
  const [userNote, setUserNote] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [sendLoading, setSendLoading] = useState(false)
  const [sendStatus, setSendStatus] = useState('')
  const [attachments, setAttachments] = useState<any[]>([])
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('08:00')
  const [showAiPanel, setShowAiPanel] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Compose
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeStatus, setComposeStatus] = useState('')
  const [composeAttachments, setComposeAttachments] = useState<any[]>([])
  const composeFileRef = useRef<HTMLInputElement>(null)

  // Compose — autocomplete på Till-fältet
  const [composeToSuggestions, setComposeToSuggestions] = useState<any[]>([])
  const [composeToShowSugg, setComposeToShowSugg] = useState(false)
  const [composeToActiveSugg, setComposeToActiveSugg] = useState(-1)
  const composeToRef = useRef<HTMLDivElement>(null)

  // Compose — AI-generering
  const [composeAiLoading, setComposeAiLoading] = useState(false)

  // AI kund
  const [aiCreateLoading, setAiCreateLoading] = useState(false)
  const [autoCreateStatus, setAutoCreateStatus] = useState('')

  const inp: any = {
    width: '100%', padding: '8px 12px', borderRadius: 6,
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

  async function loadEmails(f: string) {
    if (f === 'drafts' || f === 'compose') return
    setLoading(true)
    setNextLink(null)
    try {
      const r = await fetch(`/api/mail?action=list&folder=${f === 'archive' ? 'archive' : f}`)
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
    setUserNote('')
    setAttachments([])
    setSendStatus('')
    setAutoCreateStatus('')
    setThreadEmails([])
    setShowThread(false)

    // Om det är ett utkast — öppna direkt i redigeringsläge
    if (email.isDraft || folder === 'drafts') {
      setReplyOpen(true)
      setShowAiPanel(false)
      setCurrentDraftId(email.id)
      setEditedDraft(email.body || '')
      // Matcha kund mot mottagaren (email.to för drafts)
      const match = customers.find((c: any) =>
        c.email && email.to && email.to.toLowerCase().includes(c.email.toLowerCase())
      )
      setLinkedCustomer(match || null)
      setCustomerSearch(match ? match.name : '')
      setParsedForm(null)
      return
    }

    setReplyOpen(false)
    setEditedDraft('')
    setCurrentDraftId(null)
    setShowAiPanel(false)
    const match = customers.find((c: any) =>
      c.email && email.from && email.from.toLowerCase().includes(c.email.toLowerCase())
    )
    setLinkedCustomer(match || null)
    setCustomerSearch(match ? match.name : '')
    setParsedForm(parseFormEmail(email.body))
    if (email.threadId) {
      try {
        const r = await fetch(`/api/mail?action=thread_id&threadId=${encodeURIComponent(email.threadId)}`)
        const d = await r.json()
        setThreadEmails((d.emails || []).filter((m: any) => m.id !== email.id))
      } catch {}
    }
  }

  function openReply() {
    setReplyOpen(true)
    setShowAiPanel(true)
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
      const custContext = linkedCustomer
        ? `\nKopplad kund: ${linkedCustomer.name}\nAdress: ${linkedCustomer.address || ''}\nPris: ${linkedCustomer.price_excl_vat || ''} kr\nAnteckning: ${linkedCustomer.note || ''}\n`
        : ''
      const prompt = `${STYLE_GUIDE}\n${custContext}\nINKOMMANDE MAIL:\nFrån: ${selected.from}\nÄmne: ${selected.subject}\nDatum: ${selected.date}\nInnehåll:\n${selected.body}\n${userNote ? `\nMINA INSTRUKTIONER:\n${userNote}` : ''}\n\nSkriv ett professionellt svar. Svara BARA med mailtexten.`
      const r = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, customers: [] })
      })
      const d = await r.json()
      const draft = d.reply || d.message || ''
      setEditedDraft(draft)
      if (draft.trim()) {
        const saveRes = await fetch('/api/mail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'saveDraft',
            to: selected.replyTo || selected.from,
            subject: selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`,
            body: draft,
            threadId: selected.threadId,
            draftId: currentDraftId || undefined,
          })
        })
        const saveData = await saveRes.json()
        if (saveData.draftId) setCurrentDraftId(saveData.draftId)
        loadDrafts()
      }
    } catch {
      setEditedDraft('Kunde inte generera svar. Försök igen.')
    }
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

  async function sendReply() {
    if (!selected || !editedDraft.trim()) return
    setSendLoading(true)
    setSendStatus('')
    const scheduledAt = showSchedule && scheduleDate ? `${scheduleDate}T${scheduleTime}:00` : undefined
    const isDraftMode = selected.isDraft || folder === 'drafts'
    // For drafts: send directly to the recipient (selected.to); for replies: reply to sender
    const toAddr = isDraftMode ? selected.to : (selected.replyTo || selected.from)
    const subject = isDraftMode
      ? selected.subject
      : (selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`)
    try {
      const r = await fetch('/api/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', to: toAddr, subject, body: editedDraft, threadId: selected.threadId, attachments, scheduledAt })
      })
      const d = await r.json()
      if (d.success) {
        // Delete the draft from Drafts folder after sending
        if (isDraftMode && currentDraftId) {
          await fetch('/api/mail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', emailId: currentDraftId })
          }).catch(() => {})
        }
        setSendStatus(scheduledAt ? `✓ Schemalagd — ${new Date(scheduledAt).toLocaleString('sv-SE')}` : '✓ Skickat!')
        if (!scheduledAt) setTimeout(() => { setSelected(null); setReplyOpen(false); loadEmails(folder); loadDrafts() }, 1500)
      } else { setSendStatus('Fel: ' + (d.error || 'Kunde inte skicka')) }
    } catch (e: any) { setSendStatus('Fel: ' + e.message) }
    setSendLoading(false)
  }

  async function saveDraft() {
    if (!selected) return
    try {
      const res = await fetch('/api/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveDraft',
          to: selected.replyTo || selected.from,
          subject: selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`,
          body: editedDraft,
          threadId: selected.threadId,
          draftId: currentDraftId || undefined,
        })
      })
      const data = await res.json()
      if (data.draftId) setCurrentDraftId(data.draftId)
      setSendStatus('✓ Sparat som utkast')
      loadDrafts()
    } catch {}
  }

  async function sendNewMail() {
    if (!composeTo || !composeSubject || !composeBody.trim()) return
    setComposeStatus('Skickar...')
    const scheduledAt = showSchedule && scheduleDate ? `${scheduleDate}T${scheduleTime}:00` : undefined
    try {
      const r = await fetch('/api/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', to: composeTo, subject: composeSubject, body: composeBody, attachments: composeAttachments, scheduledAt })
      })
      const d = await r.json()
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
    if (dt.toDateString() === now.toDateString())
      return dt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    return dt.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
  }

  function parseFormEmail(body: string): any {
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
    const data: any = {}
    const fieldMap: Record<string,string> = {
      'namn': 'name', 'name': 'name', 'e-post': 'email', 'email': 'email',
      'e-postadress': 'email', 'telefon': 'phone', 'phone': 'phone', 'tel': 'phone',
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

  async function aiCreateCustomer() {
    if (!selected) return
    setAiCreateLoading(true)
    setAutoCreateStatus('')
    try {
      const r = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Extrahera kunduppgifter från detta mail.\n\nAVSÄNDARE:\nNamn: ${selected.fromName || selected.from}\nE-post: ${selected.from}\n\nMAILINNEHÅLL:\nÄmne: ${selected.subject}\n${selected.body}\n\nReturnera ENBART JSON: {"name":"","phone":"","email":"","address":"","note":""}`,
          customers: []
        })
      })
      const d = await r.json()
      const text = d.reply || d.message || ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0])
        if (!data.email) data.email = selected.from
        if (!data.name) data.name = selected.fromName || selected.from.split('@')[0]
        await autoCreateCustomer(data)
      } else { setAutoCreateStatus('AI kunde inte extrahera uppgifter') }
    } catch (e: any) { setAutoCreateStatus('Fel: ' + e.message) }
    setAiCreateLoading(false)
  }

  async function autoCreateCustomer(formData: any) {
    if (!formData?.name) return
    setAutoCreateStatus('Skapar kund...')
    try {
      const { db: fsDb } = await import('@/lib/firebase')
      const { collection, addDoc } = await import('firebase/firestore')
      const address = [formData.address, formData.zip, formData.city].filter(Boolean).join(', ')
      await addDoc(collection(fsDb, 'customers'), {
        name: formData.name, phone: formData.phone || '', email: formData.email || '',
        address: address || '', note: formData.message || '', services: '[]',
        service_kvm: '{}', service_progress: '{}', skipped_steps: '{}',
        include_fogsand: false, price_excl_vat: 0, status: 'new',
        rejected: false, created_at: new Date().toISOString(), source: 'mail',
      })
      setAutoCreateStatus('✓ Kund skapad!')
      setTimeout(() => setAutoCreateStatus(''), 3000)
    } catch (e: any) { setAutoCreateStatus('Fel: ' + e.message) }
  }

  // ── Avatar initials helper
  function Avatar({ name, size = 36, color }: { name: string; size?: number; color: string }) {
    const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    const hue = Math.abs(name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: `hsl(${hue},55%,42%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white', fontSize: size * 0.38, fontWeight: 700, letterSpacing: '0.02em' }}>
        {initials}
      </div>
    )
  }

  // ── Not connected
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

  // ── Shared icon button style
  const iconBtn = (active = false) => ({
    padding: '6px 10px', background: active ? `${C.primary}18` : 'transparent',
    border: `1px solid ${active ? C.primary : C.border}`, borderRadius: 6,
    color: active ? C.primary : C.textSec, fontSize: 12, cursor: 'pointer',
    fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
    fontWeight: active ? 600 : 400, transition: 'all 0.1s',
  })

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', overflow: 'hidden', fontFamily: 'inherit' }}>

      {/* ═══════════════════════════════════════════
          SIDEBAR — folder navigation
      ═══════════════════════════════════════════ */}
      <div style={{ width: isMobile ? 52 : 200, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', background: C.surface }}>
        {/* New mail button */}
        <div style={{ padding: isMobile ? '10px 4px' : '12px 10px', borderBottom: `1px solid ${C.border}` }}>
          <button onClick={() => { setFolder('compose'); setSelected(null) }}
            style={{ width: '100%', padding: isMobile ? '9px 0' : '9px 12px', background: folder === 'compose' ? C.primary : `${C.primary}15`, color: folder === 'compose' ? 'white' : C.primary, border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, justifyContent: isMobile ? 'center' : 'flex-start' }}>
            <i className="fas fa-pen" style={{ fontSize: 14 }} />
            {!isMobile && 'Nytt mail'}
          </button>
        </div>

        {/* Folders */}
        <div style={{ flex: 1, padding: '6px 0', overflowY: 'auto' }}>
          {FOLDERS.filter(f => f.id !== 'compose').map(f => (
            <div key={f.id} onClick={() => { setFolder(f.id); setSelected(null) }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 0' : '8px 14px', margin: '1px 5px', borderRadius: 7, cursor: 'pointer', background: folder === f.id ? `${C.primary}15` : 'transparent', color: folder === f.id ? C.primary : C.textSec, fontWeight: folder === f.id ? 600 : 400, fontSize: 13, transition: 'all 0.1s', justifyContent: isMobile ? 'center' : 'flex-start' }}>
              <i className={f.icon} style={{ fontSize: 14, width: 16, textAlign: 'center' }} />
              {!isMobile && <span style={{ flex: 1 }}>{f.label}</span>}
              {!isMobile && f.id === 'inbox' && unreadCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, background: C.primary, color: 'white', borderRadius: 9999, padding: '1px 7px', minWidth: 20, textAlign: 'center' }}>{unreadCount}</span>
              )}
            </div>
          ))}
        </div>

        {/* Bottom actions */}
        <div style={{ padding: '8px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={() => { loadEmails(folder === 'drafts' ? 'inbox' : folder); loadDrafts() }}
            style={{ ...iconBtn(), width: '100%', justifyContent: 'center' }}>
            <i className="fas fa-sync-alt" />{!isMobile && ' Uppdatera'}
          </button>
          <button onClick={disconnectMail}
            style={{ width: '100%', padding: '6px 0', background: 'transparent', border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 6, color: '#ef4444', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <i className="fas fa-sign-out-alt" />{!isMobile && ' Logga ut'}
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          MAIL LIST — middle column
      ═══════════════════════════════════════════ */}
      {folder !== 'compose' && (
        <div style={{ width: isMobile ? 'calc(100% - 52px)' : 300, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', ...(isMobile && selected ? { display: 'none' } : {}) }}>
          {/* List header */}
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 46 }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{FOLDERS.find(f => f.id === folder)?.label}</span>
              {folder === 'inbox' && unreadCount > 0 && <span style={{ marginLeft: 7, fontSize: 11, color: C.textSec }}>{unreadCount} olästa</span>}
            </div>
            {archiveStatus && <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>{archiveStatus}</span>}
          </div>

          {/* List body */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: C.textSec, fontSize: 13 }}>
                <i className="fas fa-spinner fa-spin" style={{ display: 'block', fontSize: 20, marginBottom: 8, color: C.primary }} /> Laddar...
              </div>
            ) : listEmails.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: C.textSec, fontSize: 13 }}>
                <i className="fas fa-inbox" style={{ display: 'block', fontSize: 28, opacity: 0.2, marginBottom: 8 }} /> Inga mail
              </div>
            ) : listEmails.map(email => {
              const isDraftItem = email.isDraft || folder === 'drafts'
              // For drafts, match customer by "to" address; for inbox by "from"
              const matchAddr = isDraftItem ? email.to : email.from
              const cust = customers.find((c: any) => c.email && matchAddr?.toLowerCase().includes(c.email.toLowerCase()))
              const isSel = selected?.id === email.id
              // Display name: for drafts show "Till: [name]", for inbox show sender name
              const displayName = isDraftItem
                ? (email.fromName || email.to || 'Okänd mottagare')
                : (email.fromName || email.from)
              return (
                <div key={email.id} onClick={() => openEmail(email)}
                  style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', background: isSel ? `${C.primary}10` : 'transparent', borderLeft: isSel ? `3px solid ${isDraftItem ? '#f59e0b' : C.primary}` : '3px solid transparent', transition: 'background 0.1s', position: 'relative' as const }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    {/* Indicator dot — orange for draft, blue for unread */}
                    <div style={{ paddingTop: 5, flexShrink: 0 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: isDraftItem ? '#f59e0b' : (email.unread ? C.primary : 'transparent'), flexShrink: 0 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: email.unread || isDraftItem ? 700 : 500, color: isDraftItem ? '#f59e0b' : C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                          {isDraftItem ? `Till: ${displayName}` : displayName}
                        </span>
                        <span style={{ fontSize: 11, color: C.textSec, flexShrink: 0, marginLeft: 4 }}>{fmtMailDate(email.date)}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: email.unread ? 600 : 400, color: email.unread ? C.text : C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                        {isDraftItem && <span style={{ color: '#f59e0b', fontWeight: 700, marginRight: 4 }}>[Utkast]</span>}
                        {email.subject}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {cust && <span style={{ fontSize: 10, padding: '1px 7px', background: `${C.primary}15`, color: C.primary, borderRadius: 9999, fontWeight: 600, flexShrink: 0 }}>{cust.name}</span>}
                        <span style={{ fontSize: 11, color: C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{email.preview}</span>
                      </div>
                    </div>
                    {/* Archive on hover */}
                    <button onClick={e => { e.stopPropagation(); archiveMail(email.id) }} title="Arkivera"
                      style={{ flexShrink: 0, width: 22, height: 22, background: 'transparent', border: 'none', color: C.textSec, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, opacity: 0.4, marginTop: 2 }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}>
                      <i className="fas fa-archive" />
                    </button>
                  </div>
                </div>
              )
            })}
            {nextLink && (
              <div style={{ padding: 12, textAlign: 'center', borderTop: `1px solid ${C.border}` }}>
                <button onClick={loadMoreEmails} disabled={loadingMore}
                  style={{ padding: '7px 20px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {loadingMore ? <><i className="fas fa-spinner fa-spin" /> Laddar...</> : <><i className="fas fa-chevron-down" /> Ladda fler</>}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          READING PANE — right column
      ═══════════════════════════════════════════ */}
      {folder === 'compose' ? (

        /* ── Compose view ── */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="fas fa-pen" style={{ color: C.primary }} /> Nytt mail
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 28, maxWidth: 760 }}>
            <div style={{ display: 'grid', gap: 14, marginBottom: 16 }}>

              {/* ── Till-fältet med autocomplete ── */}
              <div ref={composeToRef} style={{ position: 'relative' as const }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec, display: 'block', marginBottom: 4 }}>Till</label>
                <input
                  value={composeTo}
                  onChange={e => {
                    const val = e.target.value
                    setComposeTo(val)
                    setComposeToActiveSugg(-1)
                    if (val.trim().length >= 1) {
                      const q = val.toLowerCase()
                      const hits = customers.filter((c: any) =>
                        (c.name && c.name.toLowerCase().includes(q)) ||
                        (c.email && c.email.toLowerCase().includes(q))
                      ).slice(0, 8)
                      setComposeToSuggestions(hits)
                      setComposeToShowSugg(hits.length > 0)
                    } else {
                      setComposeToShowSugg(false)
                    }
                  }}
                  onKeyDown={e => {
                    if (!composeToShowSugg) return
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setComposeToActiveSugg(prev => Math.min(prev + 1, composeToSuggestions.length - 1))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setComposeToActiveSugg(prev => Math.max(prev - 1, 0))
                    } else if (e.key === 'Enter' && composeToActiveSugg >= 0) {
                      e.preventDefault()
                      const chosen = composeToSuggestions[composeToActiveSugg]
                      setComposeTo(chosen.email || '')
                      setComposeToShowSugg(false)
                      setComposeToActiveSugg(-1)
                    } else if (e.key === 'Escape') {
                      setComposeToShowSugg(false)
                    }
                  }}
                  onBlur={() => setTimeout(() => setComposeToShowSugg(false), 150)}
                  placeholder="mottagare@email.se"
                  style={inp}
                  autoComplete="off"
                />
                {/* Autocomplete-dropdown */}
                {composeToShowSugg && (
                  <div style={{
                    position: 'absolute' as const, top: '100%', left: 0, right: 0,
                    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                    zIndex: 200, boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                    maxHeight: 220, overflowY: 'auto' as const, marginTop: 2,
                  }}>
                    {composeToSuggestions.map((c: any, i: number) => (
                      <div key={c.id || i}
                        onMouseDown={() => {
                          setComposeTo(c.email || '')
                          setComposeToShowSugg(false)
                          setComposeToActiveSugg(-1)
                        }}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                          background: i === composeToActiveSugg ? `${C.primary}18` : 'transparent',
                          color: C.text, borderBottom: i < composeToSuggestions.length - 1 ? `1px solid ${C.border}` : 'none',
                        }}
                        onMouseEnter={e => { if (i !== composeToActiveSugg) (e.currentTarget as HTMLElement).style.background = `${C.primary}10` }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i === composeToActiveSugg ? `${C.primary}18` : 'transparent' }}
                      >
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ color: C.textSec, fontSize: 11 }}>{c.email}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec, display: 'block', marginBottom: 4 }}>Ämne</label>
                <input value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Ämnesrad" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec, display: 'block', marginBottom: 4 }}>Meddelande</label>
                <RichTextEditor value={composeBody} onChange={setComposeBody} placeholder="Skriv ditt meddelande..." C={C} rows={16} />
              </div>
            </div>

            {/* ── AI-genereringspanel ── */}
            <div style={{ marginBottom: 14, padding: '10px 14px', background: `${C.primary}08`, border: `1px solid ${C.primary}25`, borderRadius: 8 }}>
              {/* ── AI-knappar: Generera (tom ruta) + Finputsa (redigera det skrivna) ── */}
              <button
                onClick={async () => {
                  if (!composeSubject.trim()) return
                  setComposeAiLoading(true)
                  try {
                    const linkedCust = customers.find((c: any) =>
                      c.email && composeTo && composeTo.toLowerCase().includes(c.email.toLowerCase())
                    )
                    const linkedInfo = linkedCust
                      ? `${linkedCust.name}${linkedCust.address ? ', ' + linkedCust.address : ''}${linkedCust.note ? ' — ' + linkedCust.note : ''}`
                      : ''
                    const prompt = `${STYLE_GUIDE}\n\nSkriv ett nytt utgående mail baserat på:\nÄmne: ${composeSubject}\n${linkedInfo ? `Kund: ${linkedInfo}` : ''}\n\nSvara BARA med mailtexten.`
                    const r = await fetch('/api/ai', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ message: prompt, customers: [] })
                    })
                    const d = await r.json()
                    const generated = d.reply || d.message || ''
                    if (generated.trim()) setComposeBody(generated)
                  } catch {}
                  setComposeAiLoading(false)
                }}
                disabled={!composeSubject.trim() || composeAiLoading}
                style={{
                  padding: '7px 16px', background: 'transparent',
                  border: `1px solid ${C.primary}50`, borderRadius: 6,
                  color: C.primary, fontSize: 12, cursor: !composeSubject.trim() || composeAiLoading ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
                  opacity: !composeSubject.trim() ? 0.5 : 1, fontWeight: 600,
                }}
              >
                {composeAiLoading
                  ? <><i className="fas fa-spinner fa-spin" /> Genererar...</>
                  : <><span>✨</span> Generera med AI</>
                }
              </button>

              {/* Finputsa-knapp — aktiv när det finns text i rutan */}
              <button
                onClick={async () => {
                  if (!composeBody.trim()) return
                  setComposeAiLoading(true)
                  try {
                    const linkedCust = customers.find((c: any) =>
                      c.email && composeTo && composeTo.toLowerCase().includes(c.email.toLowerCase())
                    )
                    const linkedInfo = linkedCust
                      ? `${linkedCust.name}${linkedCust.address ? ', ' + linkedCust.address : ''}${linkedCust.note ? ' — ' + linkedCust.note : ''}`
                      : ''
                    const prompt = `${STYLE_GUIDE}\n\nNedan är ett slarvigt skrivet mailutkast från mig. Gör det till ett professionellt, välformulerat mail i Ida Karlssons stil. Behåll all information och alla instruktioner, men förbättra språk, ton och struktur. ${linkedInfo ? `Kund: ${linkedInfo}.` : ''}\n\nMITT UTKAST:\n${composeBody}\n\nSvara BARA med den förbättrade mailtexten.`
                    const r = await fetch('/api/ai', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ message: prompt, customers: [] })
                    })
                    const d = await r.json()
                    const improved = d.reply || d.message || ''
                    if (improved.trim()) setComposeBody(improved)
                  } catch {}
                  setComposeAiLoading(false)
                }}
                disabled={!composeBody.trim() || composeAiLoading}
                style={{
                  padding: '7px 16px', background: 'transparent',
                  border: `1px solid #8b5cf660`, borderRadius: 6,
                  color: '#8b5cf6', fontSize: 12, cursor: !composeBody.trim() || composeAiLoading ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
                  opacity: !composeBody.trim() ? 0.4 : 1, fontWeight: 600,
                }}
              >
                {composeAiLoading
                  ? <><i className="fas fa-spinner fa-spin" /> Jobbar...</>
                  : <><i className="fas fa-wand-magic-sparkles" /> Finputsa</>
                }
              </button>

              {!composeSubject.trim() && !composeBody.trim() && (
                <span style={{ marginLeft: 6, fontSize: 11, color: C.textSec }}>Fyll i ämne för att generera, eller skriv något och finputsa</span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center', marginBottom: 14 }}>
              <button onClick={() => composeFileRef.current?.click()} style={iconBtn()}>
                <i className="fas fa-paperclip" /> Bifoga
              </button>
              <input ref={composeFileRef} type="file" multiple style={{ display: 'none' }} onChange={e => handleFileAttach(e, true)} />
              {composeAttachments.map((a, i) => (
                <span key={i} style={{ padding: '3px 10px', background: `${C.primary}12`, border: `1px solid ${C.primary}25`, borderRadius: 9999, fontSize: 11, color: C.primary, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <i className="fas fa-file" /> {a.name}
                  <span onClick={() => setComposeAttachments(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#ef4444', marginLeft: 2 }}>✕</span>
                </span>
              ))}
              <button onClick={() => setShowSchedule(!showSchedule)} style={iconBtn(showSchedule)}>
                <i className="fas fa-clock" /> Schemalägg
              </button>
            </div>
            {showSchedule && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 14 }}>
                <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} style={{ ...inp, width: 'auto', colorScheme: 'dark' }} />
                <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={{ ...inp, width: 'auto', colorScheme: 'dark' }} />
                {scheduleDate && <span style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>Skickas {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={sendNewMail} disabled={!composeTo || !composeSubject || !composeBody.trim()}
                style={{ padding: '10px 28px', background: C.primary, color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: (!composeTo || !composeSubject || !composeBody.trim()) ? 0.5 : 1 }}>
                <i className="fas fa-paper-plane" /> {showSchedule && scheduleDate ? 'Schemalägg' : 'Skicka'}
              </button>
              {composeStatus && <span style={{ fontSize: 13, fontWeight: 600, color: composeStatus.startsWith('✓') ? '#10b981' : '#ef4444' }}>{composeStatus}</span>}
            </div>
          </div>
        </div>

      ) : selected ? (

        /* ── Reading pane ── */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* ── Toolbar ── */}
          <div style={{ padding: '8px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, background: C.surface, minHeight: 46 }}>
            {isMobile && (
              <button onClick={() => setSelected(null)} style={{ ...iconBtn(), marginRight: 4 }}>
                <i className="fas fa-arrow-left" />
              </button>
            )}
            {/* Draft badge in toolbar */}
            {(selected.isDraft || folder === 'drafts') ? (
              <span style={{ padding: '4px 12px', background: '#f59e0b20', border: '1px solid #f59e0b50', borderRadius: 6, color: '#f59e0b', fontSize: 12, fontWeight: 700 }}>
                <i className="fas fa-pencil-alt" style={{ marginRight: 5 }} /> Utkast
              </span>
            ) : (
              <button onClick={openReply} style={{ ...iconBtn(replyOpen), fontWeight: 600 }}>
                <i className="fas fa-reply" /> Svara
              </button>
            )}
            {/* Archive — hide for drafts */}
            {!(selected.isDraft || folder === 'drafts') && (
              <button onClick={() => archiveMail(selected.id)} style={iconBtn()}>
                <i className="fas fa-archive" /> Arkivera
              </button>
            )}
            {/* Delete */}
            <button onClick={async () => {
              if (!confirm('Ta bort detta mail?')) return
              try {
                await fetch('/api/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', emailId: selected.id }) })
                setSelected(null); loadEmails(folder); loadDrafts()
              } catch {}
            }} style={{ ...iconBtn(), color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
              <i className="fas fa-trash" /> Ta bort
            </button>

            <div style={{ flex: 1 }} />

            {/* Link customer */}
            <div style={{ position: 'relative' as const }}>
              <button onClick={() => setShowCustSearch(!showCustSearch)}
                style={{ ...iconBtn(!!linkedCustomer) }}>
                <i className="fas fa-user-tag" /> {linkedCustomer ? linkedCustomer.name : 'Koppla kund'}
              </button>
              {showCustSearch && (
                <div style={{ position: 'absolute' as const, top: '110%', right: 0, width: 240, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 100, boxShadow: '0 8px 30px rgba(0,0,0,0.3)', padding: 8 }}>
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

          {/* ── Reading body ── */}
          <div style={{ flex: 1, overflowY: 'auto' }}>

          {!(selected.isDraft || folder === 'drafts') && (<>
            {/* Subject */}
            <div style={{ padding: '18px 24px 12px', borderBottom: `1px solid ${C.border}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.3 }}>{selected.subject}</h2>
            </div>

            {/* Sender info — Outlook style */}
            <div style={{ padding: '14px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={selected.fromName || selected.from} size={42} color={C.primary} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                  {selected.fromName || selected.from}
                </div>
                <div style={{ fontSize: 12, color: C.textSec }}>
                  <span>{selected.from}</span>
                  <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>
                  <span>{new Date(selected.date).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {linkedCustomer && (
                  <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 11, padding: '1px 8px', background: `${C.primary}15`, color: C.primary, borderRadius: 9999, fontWeight: 600 }}>
                      <i className="fas fa-user" style={{ marginRight: 4 }} />{linkedCustomer.name}
                    </span>
                    {linkedCustomer.address && <span style={{ fontSize: 11, color: C.textSec }}>{linkedCustomer.address}</span>}
                    {linkedCustomer.price_excl_vat > 0 && <span style={{ fontSize: 11, color: C.textSec }}>{parseFloat(linkedCustomer.price_excl_vat).toLocaleString('sv')} kr</span>}
                  </div>
                )}
              </div>
            </div>

            {/* Formulärmail parsed view */}
            {parsedForm && (
              <div style={{ margin: '16px 24px', padding: '12px 16px', background: '#22c55e08', border: `1px solid #22c55e25`, borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', marginBottom: 8 }}>
                  <i className="fas fa-wpforms" style={{ marginRight: 6 }} /> Formulärmail — kontaktuppgifter
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '4px 20px', marginBottom: 10 }}>
                  {Object.entries(parsedForm).map(([k, v]: any) => (
                    <div key={k} style={{ fontSize: 12, color: C.text }}>
                      <span style={{ color: C.textSec, fontWeight: 600 }}>
                        {k === 'name' ? 'Namn' : k === 'email' ? 'E-post' : k === 'phone' ? 'Telefon' : k === 'address' ? 'Adress' : k === 'message' ? 'Meddelande' : k}:
                      </span>{' '}{v}
                    </div>
                  ))}
                </div>
                {!linkedCustomer && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
                    <button onClick={() => autoCreateCustomer(parsedForm)}
                      style={{ padding: '6px 14px', background: '#22c55e', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      <i className="fas fa-user-plus" /> Skapa kund (formulär)
                    </button>
                    <button onClick={aiCreateCustomer} disabled={aiCreateLoading}
                      style={{ padding: '6px 14px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: aiCreateLoading ? 0.7 : 1 }}>
                      {aiCreateLoading ? <><i className="fas fa-spinner fa-spin" /> AI analyserar...</> : <><i className="fas fa-magic" /> AI skapar kund</>}
                    </button>
                    {autoCreateStatus && <span style={{ fontSize: 12, fontWeight: 600, color: autoCreateStatus.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{autoCreateStatus}</span>}
                  </div>
                )}
              </div>
            )}

            {/* Mail body */}
            <div style={{ padding: '20px 24px' }}>
              <pre style={{ fontSize: 14, color: C.text, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>
                {selected.body}
              </pre>
              {!parsedForm && !linkedCustomer && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={aiCreateCustomer} disabled={aiCreateLoading}
                    style={{ padding: '6px 14px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: aiCreateLoading ? 0.7 : 1 }}>
                    {aiCreateLoading ? <><i className="fas fa-spinner fa-spin" /> Analyserar...</> : <><i className="fas fa-magic" /> AI skapar kund</>}
                  </button>
                  {autoCreateStatus && <span style={{ fontSize: 12, fontWeight: 600, color: autoCreateStatus.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{autoCreateStatus}</span>}
                </div>
              )}
            </div>

            {/* Thread history */}
            {threadEmails.length > 0 && (
              <div style={{ padding: '0 24px 16px' }}>
                <button onClick={() => setShowThread(!showThread)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 7, color: C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, width: '100%', justifyContent: 'space-between' }}>
                  <span><i className="fas fa-history" style={{ marginRight: 6 }} /> Tidigare i tråden ({threadEmails.length} mail)</span>
                  <i className={`fas fa-chevron-${showThread ? 'up' : 'down'}`} style={{ fontSize: 11 }} />
                </button>
                {showThread && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[...threadEmails].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((email: any) => (
                      <div key={email.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ padding: '8px 14px', background: C.bg, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar name={email.fromName || email.from} size={28} color={C.primary} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{email.fromName || email.from}</div>
                            <div style={{ fontSize: 11, color: C.textSec }}>{new Date(email.date).toLocaleString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        </div>
                        <div style={{ padding: '10px 14px', background: C.surface }}>
                          <pre style={{ fontSize: 12, color: C.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, maxHeight: 180, overflow: 'hidden' }}>{email.body}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </>)} {/* end !(isDraft) */}

            {/* ── REPLY / DRAFT EDIT PANEL (Outlook inline style) ── */}
            {replyOpen && (
              <div style={{ margin: '0 0 0 0', borderTop: `2px solid ${(selected.isDraft || folder === 'drafts') ? '#f59e0b' : C.border}`, background: C.surface }}>

                {/* Reply / Draft header */}
                <div style={{ padding: '12px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name="Ida Karlsson" size={32} color={C.primary} />
                  <div>
                    {(selected.isDraft || folder === 'drafts') ? (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                          <span style={{ color: '#f59e0b', marginRight: 6 }}><i className="fas fa-pencil-alt" /></span>
                          Redigera utkast → <span style={{ color: C.primary }}>{selected.to || selected.fromName}</span>
                        </div>
                        <div style={{ fontSize: 11, color: C.textSec }}>{selected.subject}</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Svara till: <span style={{ color: C.primary }}>{selected.fromName || selected.from}</span></div>
                        <div style={{ fontSize: 11, color: C.textSec }}>Re: {selected.subject}</div>
                      </>
                    )}
                  </div>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setReplyOpen(false)} style={{ background: 'none', border: 'none', color: C.textSec, cursor: 'pointer', fontSize: 16 }}>
                    <i className="fas fa-times" />
                  </button>
                </div>

                {/* AI panel toggle */}
                <div style={{ padding: '10px 24px', borderBottom: `1px solid ${C.border}`, background: `${C.primary}05` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
                    <button onClick={() => setShowAiPanel(!showAiPanel)}
                      style={{ ...iconBtn(showAiPanel), background: showAiPanel ? '#8b5cf615' : 'transparent', borderColor: showAiPanel ? '#8b5cf6' : C.border, color: showAiPanel ? '#8b5cf6' : C.textSec }}>
                      <i className="fas fa-robot" /> AI-assistent {showAiPanel ? '▲' : '▼'}
                    </button>
                    {!showAiPanel && editedDraft && (
                      <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>
                        <i className="fas fa-check-circle" style={{ marginRight: 4 }} /> AI-utkast genererat
                      </span>
                    )}
                  </div>

                  {showAiPanel && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Customer context */}
                      {linkedCustomer && (
                        <div style={{ padding: '8px 12px', background: `${C.primary}08`, border: `1px solid ${C.primary}20`, borderRadius: 7, display: 'flex', gap: 14, flexWrap: 'wrap' as const, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: C.primary }}><i className="fas fa-user" style={{ marginRight: 4 }} />{linkedCustomer.name}</span>
                          {linkedCustomer.address && <span style={{ fontSize: 11, color: C.textSec }}><i className="fas fa-map-marker-alt" style={{ marginRight: 3 }} />{linkedCustomer.address}</span>}
                          {linkedCustomer.price_excl_vat > 0 && <span style={{ fontSize: 11, color: C.textSec }}><i className="fas fa-coins" style={{ marginRight: 3 }} />{parseFloat(linkedCustomer.price_excl_vat).toLocaleString('sv')} kr</span>}
                        </div>
                      )}
                      {/* Instructions */}
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec, display: 'block', marginBottom: 5 }}>
                          <i className="fas fa-info-circle" style={{ marginRight: 4, color: C.primary }} /> Instruktioner till AI <span style={{ fontWeight: 400 }}>(valfritt)</span>
                        </label>
                        <textarea value={userNote} onChange={e => setUserNote(e.target.value)} rows={2}
                          placeholder="T.ex. 'Erbjud tisdag 8 april kl 10 och 14', 'Vi är fullt bokade i april'..."
                          style={{ ...inp, resize: 'vertical' as const }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
                        <button onClick={generateAiDraft} disabled={aiLoading}
                          style={{ padding: '9px 20px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: aiLoading ? 'default' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: aiLoading ? 0.7 : 1 }}>
                          {aiLoading ? <><i className="fas fa-spinner fa-spin" /> Genererar...</> : <><i className="fas fa-magic" /> Generera AI-svar</>}
                        </button>
                        {editedDraft && (
                          <button onClick={improveText} disabled={aiLoading}
                            style={{ padding: '9px 16px', background: 'transparent', border: `1px solid #8b5cf6`, borderRadius: 8, color: '#8b5cf6', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                            <i className="fas fa-wand-magic-sparkles" /> Finskriv
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Text area */}
                <div style={{ padding: '16px 24px' }}>
                  <RichTextEditor value={editedDraft} onChange={setEditedDraft} placeholder="Skriv ditt svar här, eller generera med AI ovan..." C={C} rows={14} />
                </div>

                {/* Attachments + schedule + send toolbar */}
                <div style={{ padding: '0 24px 20px' }}>
                  {/* Attachments */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 12, alignItems: 'center' }}>
                    <button onClick={() => fileRef.current?.click()} style={iconBtn()}>
                      <i className="fas fa-paperclip" /> Bifoga
                    </button>
                    <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => handleFileAttach(e, false)} />
                    {attachments.map((a, i) => (
                      <span key={i} style={{ padding: '3px 10px', background: `${C.primary}12`, border: `1px solid ${C.primary}25`, borderRadius: 9999, fontSize: 11, color: C.primary, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <i className="fas fa-file" /> {a.name}
                        <span onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#ef4444' }}>✕</span>
                      </span>
                    ))}
                    <button onClick={() => setShowSchedule(!showSchedule)} style={iconBtn(showSchedule)}>
                      <i className="fas fa-clock" /> Schemalägg
                    </button>
                  </div>

                  {showSchedule && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 12 }}>
                      <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} style={{ ...inp, width: 'auto', colorScheme: 'dark' }} />
                      <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={{ ...inp, width: 'auto', colorScheme: 'dark' }} />
                      {scheduleDate && <span style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>Skickas {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                  )}

                  {/* Send row */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', paddingTop: 12, borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' as const }}>
                    <button onClick={sendReply} disabled={sendLoading || !editedDraft.trim()}
                      style={{ padding: '10px 28px', background: C.primary, color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: sendLoading || !editedDraft.trim() ? 'default' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: (sendLoading || !editedDraft.trim()) ? 0.6 : 1 }}>
                      {sendLoading ? <><i className="fas fa-spinner fa-spin" /> Skickar...</> : <><i className="fas fa-paper-plane" /> {showSchedule && scheduleDate ? 'Schemalägg' : 'Skicka svar'}</>}
                    </button>
                    <button onClick={saveDraft}
                      style={{ padding: '10px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <i className="fas fa-save" /> Spara utkast
                    </button>
                    {sendStatus && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: sendStatus.startsWith('✓') ? '#10b981' : '#ef4444' }}>
                        {sendStatus}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* If no reply panel: show "Svara" call-to-action at bottom (not for drafts) */}
            {!replyOpen && !(selected.isDraft || folder === 'drafts') && (
              <div style={{ padding: '12px 24px 28px', borderTop: `1px solid ${C.border}` }}>
                <button onClick={openReply}
                  style={{ padding: '9px 22px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.primary; (e.currentTarget as HTMLElement).style.color = C.primary }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.color = C.textSec }}>
                  <i className="fas fa-reply" /> Svara
                </button>
              </div>
            )}
          </div>
        </div>

      ) : (
        /* ── Empty reading pane ── */
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
          <div style={{ width: 70, height: 70, borderRadius: '50%', background: `${C.primary}10`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className="fas fa-envelope-open" style={{ fontSize: 30, color: C.primary, opacity: 0.3 }} />
          </div>
          <div style={{ fontSize: 14, color: C.textSec }}>Välj ett mail för att läsa det</div>
          {unreadCount > 0 && <div style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>{unreadCount} olästa meddelanden</div>}
        </div>
      )}
    </div>
  )
}
