'use client'
import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  imageUrls?: string[]
  loading?: boolean
  timeSlots?: { date: string; start: string; end: string; label: string }[]
}

interface PendingImage {
  dataUrl: string
  name: string
  base64: string
  mediaType: string
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

  const [messages, setMessages]         = useState<Message[]>([])
  const [input,    setInput]            = useState('')
  const [loading,  setLoading]          = useState(false)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [showQuick, setShowQuick]       = useState(true)

  const fileRef     = useRef<HTMLInputElement>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) }, [messages])

  function autoResize(){
    const el=textareaRef.current; if(!el)return
    el.style.height='auto'
    el.style.height=Math.min(el.scrollHeight,160)+'px'
  }

  function resizeAndEncode(file: File): Promise<PendingImage> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = ev => {
        const src = ev.target?.result as string
        const img = new Image()
        img.onload = () => {
          const MAX = 1920
          let dataUrl = src
          if (img.width > MAX || img.height > MAX) {
            const scale = MAX / Math.max(img.width, img.height)
            const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
            const canvas = document.createElement('canvas')
            canvas.width = w; canvas.height = h
            canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
            const isPhoto = file.type === 'image/jpeg' || file.type === 'image/jpg'
            dataUrl = isPhoto ? canvas.toDataURL('image/jpeg', 0.95) : canvas.toDataURL('image/png')
          }
          const [meta, b64] = dataUrl.split(',')
          const mediaType = meta.replace('data:', '').replace(';base64', '')
          resolve({ dataUrl, name: file.name, base64: b64, mediaType })
        }
        img.src = src
      }
      reader.readAsDataURL(file)
    })
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    const processed = await Promise.all(files.map(resizeAndEncode))
    setPendingImages(prev => [...prev, ...processed])
    e.target.value = ''
  }

  function removeImage(idx: number) {
    setPendingImages(prev => prev.filter((_, i) => i !== idx))
  }

  async function selectTimeSlot(slot: { date: string; start: string; end: string; label: string }) {
    await sendMessage(`Jag valde ${slot.label}. Skriv ett proffsigt mailsvar som bekräftar bokningen för ${slot.date} kl ${slot.start}-${slot.end}. Inkludera vänlig hälsning och att vi ser fram emot jobbet.`)
  }

  async function sendMessage(overrideText?: string){
    const text = (overrideText ?? input).trim()
    if(!text && !pendingImages.length) return

    setShowQuick(false)
    const imgsForThisCall = pendingImages
    const userMsg: Message = {
      role: 'user',
      content: text || `[${imgsForThisCall.length} bild${imgsForThisCall.length > 1 ? 'er' : ''}: ${imgsForThisCall.map(i=>i.name).join(', ')}]`,
      imageUrls: imgsForThisCall.length ? imgsForThisCall.map(i => i.dataUrl) : undefined,
    }
    setMessages(prev=>[...prev, userMsg, {role:'assistant', content:'', loading:true}])
    setInput(''); setPendingImages([]); setLoading(true)

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text || `Läs av ${imgsForThisCall.length > 1 ? 'dessa bilder' : 'bilden'}.`,
          sessionId: 'admin-session',
          hasImage: imgsForThisCall.length > 0,
          images: imgsForThisCall.map(i => ({ base64: i.base64, mediaType: i.mediaType, name: i.name })),
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
          <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg,#3b82f6,#6366f1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
            </svg>
          </div>
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

        {showQuick && messages.length === 0 && (
          <div style={{animation:'fadeIn 0.3s ease'}}>
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
          <div key={i} className="ai-msg" style={{display:'flex',flexDirection:'column',alignItems:msg.role==='user'?'flex-end':'flex-start',gap:4}}>
            {/* Image previews in message */}
            {msg.imageUrls && msg.imageUrls.length > 0 && (
              <div style={{display:'flex',flexWrap:'wrap',gap:6,justifyContent:'flex-end',maxWidth:'92%'}}>
                {msg.imageUrls.map((url, idx) => (
                  <img key={idx} src={url} alt="" style={{height:80,maxWidth:160,borderRadius:8,border:`1px solid ${border}`,objectFit:'cover'}}/>
                ))}
              </div>
            )}
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

            {msg.timeSlots && msg.timeSlots.length > 0 && (
              <div style={{marginTop:6,display:'flex',flexDirection:'column',gap:6,width:'92%',maxWidth:360}}>
                <div style={{fontSize:11,fontWeight:700,color:textSec,letterSpacing:'0.05em',textTransform:'uppercase'}}>📅 Föreslå tid:</div>
                {msg.timeSlots.map((slot, idx) => (
                  <button key={idx} onClick={() => selectTimeSlot(slot)}
                    style={{textAlign:'left',padding:'10px 14px',background:surface,border:`1.5px solid ${border}`,borderRadius:10,color:textMain,fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',transition:'all 0.15s',display:'flex',alignItems:'center',gap:8}}
                    onMouseEnter={e=>{e.currentTarget.style.background=`${primary}12`;e.currentTarget.style.borderColor=primary}}
                    onMouseLeave={e=>{e.currentTarget.style.background=surface;e.currentTarget.style.borderColor=border}}>
                    <span style={{fontSize:16}}>📆</span>
                    <span>{slot.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {!showQuick && !loading && messages.length > 0 && (
          <button onClick={() => setShowQuick(true)}
            style={{alignSelf:'center',marginTop:4,padding:'5px 14px',background:'transparent',border:`1px solid ${border}`,borderRadius:9999,fontSize:11,color:textSec,cursor:'pointer',fontFamily:'inherit'}}>
            + Snabbval
          </button>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* Pending images preview */}
      {pendingImages.length > 0 && (
        <div style={{padding:'8px 14px',borderTop:`1px solid ${border}`,background:surface,flexShrink:0}}>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            {pendingImages.map((img, idx) => (
              <div key={idx} style={{position:'relative',flexShrink:0}}>
                <img src={img.dataUrl} alt="" style={{height:48,width:48,borderRadius:8,objectFit:'cover',border:`1px solid ${border}`}}/>
                <button onClick={() => removeImage(idx)}
                  style={{position:'absolute',top:-6,right:-6,width:18,height:18,borderRadius:'50%',background:'#ef4444',border:'none',color:'white',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1,padding:0}}>
                  ×
                </button>
              </div>
            ))}
            <span style={{fontSize:12,color:textSec}}>{pendingImages.length} bild{pendingImages.length>1?'er':''} klar{pendingImages.length>1?'a':''}</span>
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{padding:'12px 14px',borderTop:`1px solid ${border}`,background:surface,flexShrink:0}}>
        <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
          <button onClick={()=>fileRef.current?.click()} title="Bifoga bilder (flera tillåtet)"
            style={{width:36,height:36,flexShrink:0,borderRadius:8,background:pendingImages.length?`${primary}15`:inputBg,border:`1px solid ${pendingImages.length?primary:inputBdr}`,color:pendingImages.length?primary:textSec,cursor:'pointer',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.15s',position:'relative'}}
            onMouseEnter={e=>(e.currentTarget.style.borderColor=primary)}
            onMouseLeave={e=>(e.currentTarget.style.borderColor=pendingImages.length?primary:inputBdr)}>
            📎
            {pendingImages.length > 0 && (
              <span style={{position:'absolute',top:-6,right:-6,width:16,height:16,borderRadius:'50%',background:primary,color:'white',fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>
                {pendingImages.length}
              </span>
            )}
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
          <button onClick={()=>sendMessage()} disabled={loading||(!input.trim()&&!pendingImages.length)}
            style={{width:36,height:36,flexShrink:0,borderRadius:8,background:(!loading&&(input.trim()||pendingImages.length))?`linear-gradient(135deg,${primary},#6366f1)`:`${primary}30`,border:'none',color:(!loading&&(input.trim()||pendingImages.length))?'white':textSec,cursor:loading?'not-allowed':'pointer',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,transition:'all 0.15s',boxShadow:(!loading&&(input.trim()||pendingImages.length))?`0 2px 8px ${primary}40`:'none'}}>
            ↑
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={handleImageUpload}/>
      </div>
    </div>
  )
}


