'use client'
import { useState, useEffect, useRef } from 'react'

const STYLE_GUIDE = `
Du är AI-assistent för HT Ytrengöring AB. Du hjälper med att skriva och svara på mail åt Herman och Ture.

SKRIVSÄTT:
- Professionellt men personligt och varmt
- Kortfattat och tydligt — inga långa utsvävningar
- Svenska alltid
- Hälsning: "Hej [namn]!" eller bara "Hej!"
- Avslutning: "Med vänliga hälsningar, Herman / HT Ytrengöring AB" eller "Mvh Herman"
- Var direkt och konkret
- Om kunden frågar om pris — erbjud hembesök/besiktning, ge inte exakt pris
- Bekräfta alltid bokningar med datum och tid

FÖRETAGET:
- HT Ytrengöring AB — fasad- och ytrengöring i Östergötland
- Tjänster: stentvätt, altantvätt, asfaltstvätt, betongtvatt, impregnering
- Kontakt: kontakt@htytrengoring.se
`

export default function MailPage({ customers, C, isMobile }: any) {
  const [emails, setEmails] = useState<any[]>([])
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
  const [folder, setFolder] = useState<'inbox'|'sent'>('inbox')
  const [userNote, setUserNote] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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
      if (d.connected) loadEmails()
    } catch { setConnected(false) }
  }

  async function loadEmails() {
    setLoading(true)
    try {
      const r = await fetch(`/api/mail?action=list&folder=${folder}`)
      const d = await r.json()
      setEmails(d.emails || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { if (connected) loadEmails() }, [folder])

  async function openEmail(email: any) {
    setSelected(email)
    setEditedDraft('')
    setUserNote('')
    setAttachments([])
    setSendStatus('')
    const match = customers.find((c: any) =>
      c.email && email.from && email.from.toLowerCase().includes(c.email.toLowerCase())
    )
    setLinkedCustomer(match || null)
    setCustomerSearch(match ? match.name : '')
  }

  async function generateAiDraft() {
    if (!selected) return
    setAiLoading(true)
    setEditedDraft('')
    try {
      const custContext = linkedCustomer ? `
Kopplad kund: ${linkedCustomer.name}
Adress: ${linkedCustomer.address || ''}
Tjänster: ${linkedCustomer.services || ''}
Pris: ${linkedCustomer.price_excl_vat || ''} kr
Status: ${linkedCustomer.status || ''}
Anteckning: ${linkedCustomer.note || ''}
` : ''

      const prompt = `${STYLE_GUIDE}
${custContext}
INKOMMANDE MAIL:
Från: ${selected.from}
Ämne: ${selected.subject}
Datum: ${selected.date}
Innehåll:
${selected.body}
${userNote ? `\nMINA INSTRUKTIONER:\n${userNote}` : ''}

Skriv ett professionellt svar. Svara BARA med mailtexten, ingen förklaring.`

      const r = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, customers: [] })
      })
      const d = await r.json()
      setEditedDraft(d.reply || d.message || '')
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
        body: JSON.stringify({
          message: `${STYLE_GUIDE}\n\nFörbättra och finskriv detta mailutkast. Behåll innehållet men gör det mer professionellt i HT Ytrengörings stil. Svara BARA med mailtexten:\n\n${editedDraft}`,
          customers: []
        })
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
    try {
      const r = await fetch('/api/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          to: selected.replyTo || selected.from,
          subject: selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`,
          body: editedDraft,
          threadId: selected.threadId,
          attachments
        })
      })
      const d = await r.json()
      if (d.success) {
        setSendStatus('✓ Skickat!')
        setTimeout(() => { setSelected(null); loadEmails() }, 1500)
      } else {
        setSendStatus('Fel: ' + (d.error || 'Kunde inte skicka'))
      }
    } catch (e: any) {
      setSendStatus('Fel: ' + e.message)
    }
    setSendLoading(false)
  }

  function handleFileAttach(e: any) {
    Array.from(e.target.files || []).forEach((file: any) => {
      const reader = new FileReader()
      reader.onload = (ev: any) => {
        setAttachments(prev => [...prev, {
          name: file.name,
          content: ev.target.result.split(',')[1],
          contentType: file.type
        }])
      }
      reader.readAsDataURL(file)
    })
  }

  function fmtMailDate(d: string) {
    if (!d) return ''
    return new Date(d).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360 }}>
          {authUrl ? (
            <a href={authUrl} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 24px', background: '#0078d4', color: 'white', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
              <i className="fab fa-microsoft" /> Logga in med Microsoft
            </a>
          ) : (
            <button onClick={checkConnection} style={{ padding: '12px 24px', background: C.primary, color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
              <i className="fas fa-plug" /> Anslut mail
            </button>
          )}
          <div style={{ padding: 16, background: `${C.primary}08`, border: `1px solid ${C.primary}20`, borderRadius: 8, fontSize: 12, color: C.textSec, lineHeight: 1.7 }}>
            <strong style={{ color: C.text }}>Hur det fungerar:</strong><br />
            1. Klicka "Logga in med Microsoft"<br />
            2. Godkänn åtkomst i din webbläsare<br />
            3. Kom tillbaka hit — mailen är redo
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', overflow: 'hidden' }}>

      {/* MAIL-LISTA */}
      <div style={{ width: isMobile ? '100%' : 300, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', ...(isMobile && selected ? { display: 'none' } : {}) }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ display: 'flex', flex: 1, background: C.bg, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            {(['inbox', 'sent'] as const).map(f => (
              <button key={f} onClick={() => setFolder(f)}
                style={{ flex: 1, padding: '6px 0', border: 'none', background: folder === f ? C.primary : 'transparent', color: folder === f ? 'white' : C.textSec, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {f === 'inbox' ? '📥 Inkorg' : '📤 Skickat'}
              </button>
            ))}
          </div>
          <button onClick={loadEmails} title="Uppdatera"
            style={{ width: 30, height: 30, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className="fas fa-sync-alt" />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: C.textSec, fontSize: 13 }}><i className="fas fa-spinner fa-spin" /> Laddar...</div>
          ) : emails.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: C.textSec, fontSize: 13 }}>Inga mail</div>
          ) : emails.map(email => {
            const cust = customers.find((c: any) => c.email && email.from?.toLowerCase().includes(c.email.toLowerCase()))
            const isSel = selected?.id === email.id
            return (
              <div key={email.id} onClick={() => openEmail(email)}
                style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', background: isSel ? `${C.primary}12` : 'transparent', borderLeft: isSel ? `3px solid ${C.primary}` : '3px solid transparent', transition: 'all 0.1s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: email.unread ? 700 : 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                    {email.fromName || email.from}
                  </span>
                  <span style={{ fontSize: 10, color: C.textSec, flexShrink: 0 }}>{fmtMailDate(email.date)}</span>
                </div>
                <div style={{ fontSize: 12, color: email.unread ? C.text : C.textSec, fontWeight: email.unread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                  {email.subject}
                </div>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  {cust && <span style={{ fontSize: 10, padding: '1px 6px', background: `${C.primary}15`, color: C.primary, borderRadius: 9999, fontWeight: 600, flexShrink: 0 }}>{cust.name}</span>}
                  <span style={{ fontSize: 11, color: C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email.preview}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* MAIL-DETALJ */}
      {selected ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            {isMobile && (
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: C.textSec, cursor: 'pointer', fontSize: 18, padding: 0, paddingTop: 2 }}>
                <i className="fas fa-arrow-left" />
              </button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 3 }}>{selected.subject}</div>
              <div style={{ fontSize: 12, color: C.textSec }}><strong style={{ color: C.text }}>{selected.fromName || selected.from}</strong> · {fmtMailDate(selected.date)}</div>
            </div>
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
            {/* Mailinnehåll */}
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}` }}>
              <pre style={{ fontSize: 13, color: C.text, lineHeight: 1.75, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{selected.body}</pre>
            </div>

            {/* Kundinfo */}
            {linkedCustomer && (
              <div style={{ margin: '16px 24px 0', padding: '12px 16px', background: `${C.primary}08`, border: `1px solid ${C.primary}20`, borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.primary, marginBottom: 6 }}><i className="fas fa-user" /> {linkedCustomer.name}</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const }}>
                  {linkedCustomer.address && <span style={{ fontSize: 11, color: C.textSec }}><i className="fas fa-map-marker-alt" /> {linkedCustomer.address}</span>}
                  {linkedCustomer.price_excl_vat && <span style={{ fontSize: 11, color: C.textSec }}><i className="fas fa-coins" /> {parseFloat(linkedCustomer.price_excl_vat).toLocaleString('sv')} kr</span>}
                  {linkedCustomer.note && <span style={{ fontSize: 11, color: C.textSec, fontStyle: 'italic' }}>{linkedCustomer.note}</span>}
                </div>
              </div>
            )}

            {/* AI-sektion */}
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSec, marginBottom: 5 }}>
                  Instruktioner till AI <span style={{ fontWeight: 400 }}>(valfritt)</span>
                </label>
                <textarea value={userNote} onChange={e => setUserNote(e.target.value)} rows={2}
                  placeholder="T.ex. 'Erbjud hembesök tisdag 8 april', 'Vi är fullt bokade i april'..."
                  style={{ ...inp, resize: 'vertical' as const }} />
              </div>

              <button onClick={generateAiDraft} disabled={aiLoading}
                style={{ padding: '9px 20px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: aiLoading ? 'default' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 16, opacity: aiLoading ? 0.7 : 1 }}>
                {aiLoading ? <><i className="fas fa-spinner fa-spin" /> Genererar...</> : <><i className="fas fa-magic" /> Generera AI-svar</>}
              </button>

              {editedDraft && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec }}>Svaret — redigera fritt</label>
                    <button onClick={improveText} disabled={aiLoading}
                      style={{ padding: '4px 12px', background: 'transparent', border: `1px solid #8b5cf6`, borderRadius: 6, color: '#8b5cf6', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                      <i className="fas fa-sparkles" /> Finskriv
                    </button>
                  </div>
                  <textarea value={editedDraft} onChange={e => setEditedDraft(e.target.value)} rows={12}
                    style={{ ...inp, resize: 'vertical' as const, lineHeight: 1.7 }} />

                  {/* Bilagor */}
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' }}>
                    <button onClick={() => fileRef.current?.click()}
                      style={{ padding: '5px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                      <i className="fas fa-paperclip" /> Bifoga fil
                    </button>
                    <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileAttach} />
                    {attachments.map((a, i) => (
                      <span key={i} style={{ padding: '3px 10px', background: `${C.primary}12`, border: `1px solid ${C.primary}25`, borderRadius: 9999, fontSize: 11, color: C.primary, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <i className="fas fa-file" /> {a.name}
                        <span onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#ef4444' }}>✕</span>
                      </span>
                    ))}
                  </div>

                  {/* Skicka */}
                  <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                    <button onClick={sendReply} disabled={sendLoading || !editedDraft.trim()}
                      style={{ padding: '10px 28px', background: C.primary, color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: sendLoading ? 0.7 : 1 }}>
                      {sendLoading ? <><i className="fas fa-spinner fa-spin" /> Skickar...</> : <><i className="fas fa-paper-plane" /> Skicka svar</>}
                    </button>
                    {sendStatus && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: sendStatus.startsWith('✓') ? '#10b981' : '#ef4444' }}>
                        {sendStatus}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: C.textSec }}>
            <i className="fas fa-envelope-open" style={{ fontSize: 48, display: 'block', marginBottom: 12, opacity: 0.2 }} />
            <div style={{ fontSize: 14 }}>Välj ett mail från listan</div>
          </div>
        </div>
      )}
    </div>
  )
}
