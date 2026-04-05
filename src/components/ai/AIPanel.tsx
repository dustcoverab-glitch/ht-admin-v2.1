'use client'
import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string
  cost?: number
  model?: string
  loading?: boolean
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


export default function AIPanel({ onAction, onClose, dark=false, C }:Props){
  const surface  = C?.surface  ?? (dark ? '#1e293b' : '#ffffff')
  const bg       = C?.bg       ?? (dark ? '#0f172a' : '#f8fafc')
  const border   = C?.border   ?? (dark ? '#334155' : '#e2e8f0')
  const textMain = C?.text     ?? (dark ? '#e2e8f0' : '#1e293b')
  const textSec  = C?.textSec  ?? (dark ? '#94a3b8' : '#64748b')
  const primary  = C?.primary  ?? '#2563eb'
  const inputBg  = C?.input    ?? (dark ? '#1e293b' : '#ffffff')
  const inputBdr = C?.inputBorder ?? (dark ? '#334155' : '#e2e8f0')

  const [messages, setMessages] = useState<Message[]>([
    { role:'assistant', content:'Hej! Jag är din AI-assistent.\n\nJag kan:\n• Skapa och uppdatera kunder\n• Svara på frågor om kunder\n• Läsa av bilder/skärmbilder\n\nVad kan jag hjälpa dig med?' }
  ])
  const [input,            setInput]           = useState('')
  const [loading,          setLoading]         = useState(false)
  const [pendingImage,     setPendingImage]    = useState<string|null>(null)
  const [pendingImageName, setPendingImageName]= useState<string|null>(null)

  const fileRef     = useRef<HTMLInputElement>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) }, [messages])
  useEffect(()=>{ if(!input && textareaRef.current) textareaRef.current.style.height='38px' }, [input])

  function autoResize(){
    const el=textareaRef.current; if(!el)return
    el.style.height='auto'
    el.style.height=Math.min(el.scrollHeight,160)+'px'
  }

  // ✅ FIXAD: ingen aggressiv komprimering – bevarar kvalitet för AI-läsning
  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result as string
      const img = new Image()
      img.onload = () => {
        const MAX = 1920 // max bredd/höjd i px – tillräckligt för AI att läsa text

        // Om bilden redan är liten nog → skicka direkt utan canvas (bäst kvalitet)
        if (img.width <= MAX && img.height <= MAX) {
          setPendingImage(src)
          setPendingImageName(file.name)
          return
        }

        // Annars → skala ner proportionerligt
        const scale  = MAX / Math.max(img.width, img.height)
        const w      = Math.round(img.width  * scale)
        const h      = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width  = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)

        // PNG för skärmdumpar/text (förlustfritt), JPEG 0.95 för foton
        const isPhoto = file.type === 'image/jpeg' || file.type === 'image/jpg'
        const result  = isPhoto
          ? canvas.toDataURL('image/jpeg', 0.95) // hög kvalitet för foton
          : canvas.toDataURL('image/png')         // förlustfritt för skärmdumpar

        setPendingImage(result)
        setPendingImageName(file.name)
      }
      img.src = src
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function sendMessage(){
    const text=input.trim()
    if(!text && !pendingImage)return

    const userMsg:Message={ role:'user', content:text||`[Bild: ${pendingImageName}]`, imageUrl:pendingImage??undefined }
    setMessages(prev=>[...prev, userMsg, {role:'assistant',content:'',loading:true}])
    setInput(''); setPendingImage(null); setPendingImageName(null); setLoading(true)

    try {
      const messageText = pendingImage
        ? (text || 'Läs av bilden.')
        : text

      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText,
          messages: [{ role: 'user', content: messageText }],
          sessionId: 'admin-session',
          imageUrl: pendingImage ?? undefined,
          hasImage: !!pendingImage,
        }),
      })

      const data = await res.json()

      if(data.error){
        setMessages(prev=>prev.slice(0,-1).concat({role:'assistant',content:`Fel: ${data.error}`}))
        return
      }

      let msgCost=0 // Claude kostar men vi visar inte öre

      setMessages(prev=>prev.slice(0,-1).concat({
        role:'assistant',
        content:data.reply||'(Inget svar)',
        cost:msgCost,
        model:data.model,
      }))

      if(data.actions?.length>0) onAction()

    } catch(err:any){
      setMessages(prev=>prev.slice(0,-1).concat({role:'assistant',content:`Fel: ${err.message}`}))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',background:surface,borderLeft:`1px solid ${border}`}}>

      {/* Header */}
      <div style={{padding:'14px 16px',borderBottom:`1px solid ${border}`,display:'flex',alignItems:'center',justifyContent:'space-between',background:surface,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:'#C9A84C',boxShadow:'0 0 6px rgba(201,168,76,0.7)'}}/>
          <span style={{fontSize:14,fontWeight:600,color:textMain}}>AI-assistent</span>
        </div>
        <button onClick={onClose} style={{background:'none',border:'none',color:textSec,cursor:'pointer',fontSize:22,lineHeight:1,padding:'0 2px'}}
          onMouseEnter={e=>((e.target as HTMLElement).style.color='#ef4444')}
          onMouseLeave={e=>((e.target as HTMLElement).style.color=textSec)}>×</button>
      </div>

      {/* Messages */}
      <div style={{flex:1,overflowY:'auto',padding:'14px',display:'flex',flexDirection:'column',gap:12,background:bg}}>
        {messages.map((msg,i)=>(
          <div key={i} style={{display:'flex',flexDirection:'column',alignItems:msg.role==='user'?'flex-end':'flex-start',gap:3}}>
            {msg.imageUrl&&<img src={msg.imageUrl} alt="" style={{maxWidth:200,borderRadius:8,border:`1px solid ${border}`}}/>}
            <div style={{
              maxWidth:'92%',padding:'9px 13px',
              borderRadius:msg.role==='user'?'14px 14px 4px 14px':'14px 14px 14px 4px',
              background:msg.role==='user'?'rgba(201,168,76,0.15)':surface,
              border:msg.role==='user'?'1px solid rgba(201,168,76,0.25)':`1px solid ${border}`,
              fontSize:13,color:textMain,lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-word'
            }}>
              {msg.loading
                ?<div style={{display:'flex',gap:4,padding:'2px 0'}}>
                  {[0,1,2].map(j=><div key={j} style={{width:6,height:6,borderRadius:'50%',background:'#C9A84C',opacity:0.6,animation:`aiDot 1s ease-in-out ${j*0.18}s infinite`}}/>)}
                </div>
                :msg.content}
            </div>
            {msg.cost!==undefined&&msg.cost>0&&<span style={{fontSize:10,color:textSec}}>{(msg.cost*100).toFixed(4)} öre · {msg.model}</span>}
          </div>
        ))}
        <div ref={bottomRef}/>
      </div>

      {/* Pending image */}
      {pendingImage&&(
        <div style={{padding:'8px 14px',borderTop:`1px solid ${border}`,display:'flex',alignItems:'center',gap:8,background:surface,flexShrink:0}}>
          <img src={pendingImage} alt="" style={{height:40,borderRadius:6,border:`1px solid ${border}`}}/>
          <span style={{fontSize:12,color:textSec,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pendingImageName}</span>
          <button onClick={()=>{setPendingImage(null);setPendingImageName(null)}} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:18}}>×</button>
        </div>
      )}

      {/* Input */}
      <div style={{padding:'10px 14px',borderTop:`1px solid ${border}`,background:surface,flexShrink:0}}>
        <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
          <button onClick={()=>fileRef.current?.click()} style={{width:36,height:36,flexShrink:0,borderRadius:8,background:inputBg,border:`1px solid ${inputBdr}`,color:textSec,cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center'}}>📎</button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e=>{setInput(e.target.value);autoResize()}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!loading){e.preventDefault();sendMessage()}}}
            placeholder="Skriv ett meddelande… (Shift+Enter = ny rad)"
            disabled={loading}
            rows={1}
            style={{flex:1,background:inputBg,border:`1px solid ${inputBdr}`,borderRadius:8,padding:'8px 12px',color:textMain,fontSize:13,outline:'none',resize:'none',overflow:'hidden',minHeight:36,maxHeight:160,lineHeight:'1.5',fontFamily:'inherit'}}
            onFocus={e=>(e.target.style.borderColor='#C9A84C')}
            onBlur={e=>(e.target.style.borderColor=inputBdr)}
          />
          <button onClick={sendMessage} disabled={loading||(!input.trim()&&!pendingImage)} style={{width:36,height:36,flexShrink:0,borderRadius:8,background:loading||(!input.trim()&&!pendingImage)?'rgba(201,168,76,0.3)':'linear-gradient(135deg,#C9A84C,#E8C94A)',border:'none',color:loading||(!input.trim()&&!pendingImage)?textSec:'#0B1120',cursor:loading?'not-allowed':'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,boxShadow:(!loading&&(input.trim()||pendingImage))?'0 2px 8px rgba(201,168,76,0.4)':'none'}}>↑</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleImageUpload}/>
      </div>

      <style>{`@keyframes aiDot{0%,80%,100%{transform:scale(0.7);opacity:0.4}40%{transform:scale(1.2);opacity:1}}`}</style>
    </div>
  )
}
