'use client'
import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string
  loading?: boolean
  timeSlots?: { date: string; start: string; end: string; label: string }[]
}

interface Colors {
  bg: string; surface: string; border: string; text: string
  textSec: string; primary: string; input: string; inputBorder: string
  sidebar: string; sidebarText: string
}

interface Props {
  onAction: () => void
  onClose: () => void
  dark?: boolean
  C?: Colors
}

const QUICK_ACTIONS = [
  { label: '➕ Skapa ny kund', msg: 'Jag vill skapa en ny kund' },
  { label: '📅 Kommande jobb denna vecka', msg: 'Visa alla bokade jobb den här veckan' },
  { label: '📊 Omsättning & statistik', msg: 'Visa omsättning och statistik' },
  { label: '⏱️ Logga tid på ett jobb', msg: 'Hjälp mig logga tid på ett jobb' },
  { label: '🔍 Sök bland kunder', msg: 'Sök bland kunder' },
]

export default function AIPanel({ onAction, onClose, dark=false, C }:Props){
  const surface  = C?.surface  ?? (dark ? '#111111' : '#ffffff')
  const bg       = C?.bg       ?? (dark ? '#000000' : '#f8fafc')
  const border   = C?.border   ?? (dark ? '#222222' : '#e2e8f0')
  const textMain = C?.text     ?? (dark ? '#ededed' : '#1e293b')
  const textSec  = C?.textSec  ?? (dark ? '#888888' : '#64748b')
  const primary  = C?.primary  ?? '#3b82f6'
  const inputBg  = C?.input    ?? (dark ? '#111111' : '#ffffff')
  const inputBdr = C?.inputBorder ?? (dark ? '#333333' : '#e2e8f0')

  const [messages, setMessages] = useState<Message[]>([])
  const [input,            setInput]           = useState('')
  const [loading,          setLoading]         = useState(false)
  const [pendingImage,     setPendingImage]    = useState<string|null>(null)
  const [pendingImageName, setPendingImageName]= useState<string|null>(null)
  const [showQuick,        setShowQuick]       = useState(true)

  const fileRef     = useRef<HTMLInputElement>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) }, [messages])

  function autoResize(){
    const el=textareaRef.current; if(!el)return
    el.style.height='auto'
    el.style.height=Math.min(el.scrollHeight,160)+'px'
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result as string
      const img = new Image()
      img.onload = () => {
        const MAX = 1920
        if (img.width <= MAX && img.height <= MAX) {
          setPendingImage(src); setPendingImageName(file.name); return
        }
        const scale = MAX / Math.max(img.width, img.height)
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        const isPhoto = file.type === 'image/jpeg' || file.type === 'image/jpg'
        setPendingImage(isPhoto ? canvas.toDataURL('image/jpeg', 0.95) : canvas.toDataURL('image/png'))
        setPendingImageName(file.name)
      }
      img.src = src
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function selectTimeSlot(slot: { date: string; start: string; end: string; label: string }) {
    const prompt = `Jag valde ${slot.label}. Skriv ett proffsigt mailsvar som bekräftar bokningen för ${slot.date} kl ${slot.start}-${slot.end}. Inkludera vänlig hälsning och att vi ser fram emot jobbet.`
    await sendMessage(prompt)
  }

  async function sendMessage(overrideText?: string){
    const text = (overrideText ?? input).trim()
    if(!text && !pendingImage) return

    setShowQuick(false)
    const userMsg: Message = { role:'user', content: text || `[Bild: ${pendingImageName}]`, imageUrl: pendingImage ?? undefined }
    setMessages(prev=>[...prev, userMsg, {role:'assistant', content:'', loading:true}])
    setInput(''); setPendingImage(null); setPendingImageName(null); setLoading(true)

    try {
      // pendingImage is a data-URL like "data:image/jpeg;base64,/9j/..."
      // Split it so we can send raw base64 to the server (Claude can't fetch internal URLs)
      let imageBase64: string | undefined
      let imageMediaType: string | undefined
      const imgForThisCall = pendingImage  // capture before clearing
      if (imgForThisCall && imgForThisCall.startsWith('data:')) {
        const [meta, b64] = imgForThisCall.split(',')
        imageBase64 = b64
        imageMediaType = meta.replace('data:', '').replace(';base64', '')
      }

      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text || 'Läs av bilden.',
          sessionId: 'admin-session',
          hasImage: !!imgForThisCall,
          imageBase64: imageBase64 ?? undefined,
          imageMediaType: imageMediaType ?? undefined,
        }),
      })
      const data = await res.json()
      setMessages(prev => prev.slice(0,-1).concat({
        role: 'assistant',
        content: data.error ? `❌ Fel: ${data.error}` : (data.reply || '(Inget svar)'),
        timeSlots: data.timeSlots,
      }))
      if (data.actions?.length > 0) onAction()
    } catch(err:any){
      setMessages(prev => prev.slice(0,-1).concat({ role:'assistant', content:`❌ Fel: ${err.message}` }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',background:surface}}>
      <style>{`
        @keyframes aiDot{0%,80%,100%{transform:scale(0.7);opacity:0.3}40%{transform:scale(1.1);opacity:1}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .ai-msg{animation:fadeIn 0.2s ease}
        .ai-quick:hover{background:rgba(59,130,246,0.12)!important;border-color:#3b82f6!important}
      `}</style>

      {/* Header */}
      <div style={{padding:'14px 16px',borderBottom:`1px solid ${border}`,display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg,#3b82f6,#6366f1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>🤖</div>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:textMain,letterSpacing:'-0.2px'}}>AI-assistent</div>
            <div style={{fontSize:10,color:'#10b981',fontWeight:500}}>● Online</div>
          </div>
        </div>
        <button onClick={onClose} style={{width:28,height:28,background:'transparent',border:`1px solid ${border}`,borderRadius:6,color:textSec,cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}
          onMouseEnter={e=>((e.target as HTMLElement).style.borderColor='#ef4444')}
          onMouseLeave={e=>((e.target as HTMLElement).style.borderColor=border)}>✕</button>
      </div>

      {/* Messages */}
      <div style={{flex:1,overflowY:'auto',padding:'16px',display:'flex',flexDirection:'column',gap:10,background:bg}}>

        {/* Welcome + Quick actions */}
        {showQuick && messages.length === 0 && (
          <div style={{animation:'fadeIn 0.3s ease'}}>
            <div style={{padding:'16px',background:surface,borderRadius:12,border:`1px solid ${border}`,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:textMain,marginBottom:4}}>Hej! Vad kan jag hjälpa dig med?</div>
              <div style={{fontSize:12,color:textSec,lineHeight:1.6}}>
                Jag kan skapa kunder, logga tid, flytta processteg, visa statistik, läsa av bilder och offerter — fråga mig vad som helst om jobbet.
              </div>
            </div>
            <div style={{fontSize:11,fontWeight:700,color:textSec,letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:8}}>Snabbval</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {QUICK_ACTIONS.map(qa => (
                <button key={qa.msg} className="ai-quick" onClick={() => sendMessage(qa.msg)}
                  style={{textAlign:'left',padding:'9px 14px',background:'transparent',border:`1px solid ${border}`,borderRadius:8,color:textMain,fontSize:12,fontWeight:500,cursor:'pointer',fontFamily:'inherit',transition:'all 0.15s',width:'100%'}}>
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg,i)=>(
          <div key={i} className="ai-msg" style={{display:'flex',flexDirection:'column',alignItems:msg.role==='user'?'flex-end':'flex-start',gap:3}}>
            {msg.imageUrl && <img src={msg.imageUrl} alt="" style={{maxWidth:200,borderRadius:8,border:`1px solid ${border}`}}/>}
            <div style={{
              maxWidth:'92%',padding:'10px 14px',
              borderRadius: msg.role==='user' ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
              background: msg.role==='user' ? `${primary}18` : surface,
              border: msg.role==='user' ? `1px solid ${primary}33` : `1px solid ${border}`,
              fontSize:13,color:textMain,lineHeight:1.65,whiteSpace:'pre-wrap',wordBreak:'break-word',
            }}>
              {msg.loading
                ? <div style={{display:'flex',gap:5,padding:'2px 0',alignItems:'center'}}>
                    <span style={{fontSize:11,color:textSec,marginRight:4}}>Tänker</span>
                    {[0,1,2].map(j=><div key={j} style={{width:5,height:5,borderRadius:'50%',background:primary,animation:`aiDot 1s ease-in-out ${j*0.18}s infinite`}}/>)}
                  </div>
                : msg.content
              }
            </div>
            
            {/* Time slot buttons */}
            {msg.timeSlots && msg.timeSlots.length > 0 && (
              <div style={{marginTop:6,display:'flex',flexDirection:'column',gap:6,width:'92%',maxWidth:360}}>
                <div style={{fontSize:11,fontWeight:700,color:textSec,letterSpacing:'0.05em',textTransform:'uppercase'}}>📅 Föreslå tid:</div>
                {msg.timeSlots.map((slot, idx) => (
                  <button key={idx} onClick={() => selectTimeSlot(slot)}
                    style={{
                      textAlign:'left',padding:'10px 14px',background:surface,
                      border:`1.5px solid ${border}`,borderRadius:10,
                      color:textMain,fontSize:13,fontWeight:600,cursor:'pointer',
                      fontFamily:'inherit',transition:'all 0.15s',
                      display:'flex',alignItems:'center',gap:8,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = `${primary}12`
                      e.currentTarget.style.borderColor = primary
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = surface
                      e.currentTarget.style.borderColor = border
                    }}>
                    <span style={{fontSize:16}}>📆</span>
                    <span>{slot.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Quick actions again after conversation */}
        {!showQuick && !loading && messages.length > 0 && (
          <button onClick={() => setShowQuick(true)}
            style={{alignSelf:'center',marginTop:4,padding:'5px 14px',background:'transparent',border:`1px solid ${border}`,borderRadius:9999,fontSize:11,color:textSec,cursor:'pointer',fontFamily:'inherit'}}>
            + Snabbval
          </button>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* Pending image */}
      {pendingImage && (
        <div style={{padding:'8px 14px',borderTop:`1px solid ${border}`,display:'flex',alignItems:'center',gap:8,background:surface,flexShrink:0}}>
          <img src={pendingImage} alt="" style={{height:40,borderRadius:6,border:`1px solid ${border}`}}/>
          <span style={{fontSize:12,color:textSec,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pendingImageName}</span>
          <button onClick={()=>{setPendingImage(null);setPendingImageName(null)}} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:18,lineHeight:1}}>×</button>
        </div>
      )}

      {/* Input */}
      <div style={{padding:'12px 14px',borderTop:`1px solid ${border}`,background:surface,flexShrink:0}}>
        <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
          <button onClick={()=>fileRef.current?.click()} title="Bifoga bild"
            style={{width:36,height:36,flexShrink:0,borderRadius:8,background:inputBg,border:`1px solid ${inputBdr}`,color:textSec,cursor:'pointer',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',transition:'border-color 0.15s'}}
            onMouseEnter={e=>(e.currentTarget.style.borderColor=primary)}
            onMouseLeave={e=>(e.currentTarget.style.borderColor=inputBdr)}>
            📎
          </button>
          <textarea ref={textareaRef} value={input}
            onChange={e=>{setInput(e.target.value);autoResize()}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!loading){e.preventDefault();sendMessage()}}}
            placeholder="Fråga om kunder, logga tid, skapa ärenden… (Enter = skicka)"
            disabled={loading} rows={1}
            style={{flex:1,background:inputBg,border:`1px solid ${inputBdr}`,borderRadius:8,padding:'8px 12px',color:textMain,fontSize:13,outline:'none',resize:'none',overflow:'hidden',minHeight:36,maxHeight:160,lineHeight:'1.5',fontFamily:'inherit',transition:'border-color 0.15s'}}
            onFocus={e=>(e.target.style.borderColor=primary)}
            onBlur={e=>(e.target.style.borderColor=inputBdr)}
          />
          <button onClick={()=>sendMessage()} disabled={loading||(!input.trim()&&!pendingImage)}
            style={{width:36,height:36,flexShrink:0,borderRadius:8,background:(!loading&&(input.trim()||pendingImage))?`linear-gradient(135deg,${primary},#6366f1)`:`${primary}30`,border:'none',color:(!loading&&(input.trim()||pendingImage))?'white':textSec,cursor:loading?'not-allowed':'pointer',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,transition:'all 0.15s',boxShadow:(!loading&&(input.trim()||pendingImage))?`0 2px 8px ${primary}40`:'none'}}>
            ↑
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleImageUpload}/>
      </div>
    </div>
  )
}
