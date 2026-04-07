'use client'
import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import AIPanel from '@/components/ai/AIPanel'
import MailPage from '@/components/mail/MailPage'
import { BarChart2, Users, CalendarDays, Plus, RefreshCw, BarChart, ClipboardList, Bot, Sun, Moon, LogOut, Phone as PhoneIcon, MapPin as MapPinIcon } from 'lucide-react'

/* ─── SERVICE STEPS ─────────────────────────────────────────── */
const SERVICE_STEPS: Record<string,{id:number,label:string}[]> = {
  stentvatt: [
    {id:0,label:'Ej påbörjad'},
    {id:1,label:'Inbokat hembesök'},
    {id:2,label:'Hembesök'},
    {id:3,label:'Offert'},
    {id:4,label:'Bokat'},
    {id:5,label:'Stentvätt'},
    {id:6,label:'Impregnering'},
    {id:7,label:'Fogsand'},
    {id:8,label:'Fakturering'},
    {id:9,label:'Fakturerad'},
  ],
  stentvatt_no_fogsand: [
    {id:0,label:'Ej påbörjad'},
    {id:1,label:'Inbokat hembesök'},
    {id:2,label:'Hembesök'},
    {id:3,label:'Offert'},
    {id:4,label:'Bokat'},
    {id:5,label:'Stentvätt'},
    {id:6,label:'Impregnering'},
    {id:7,label:'Fakturering'},
    {id:8,label:'Fakturerad'},
  ],
  betongtvatt: [
    {id:0,label:'Ej påbörjad'},
    {id:1,label:'Inbokat hembesök'},
    {id:2,label:'Hembesök'},
    {id:3,label:'Offert'},
    {id:4,label:'Bokat'},
    {id:5,label:'Betongtvätt'},
    {id:6,label:'Fakturering'},
    {id:7,label:'Fakturerad'},
  ],
  altantvatt: [
    {id:0,label:'Ej påbörjad'},
    {id:1,label:'Inbokat hembesök'},
    {id:2,label:'Hembesök'},
    {id:3,label:'Offert'},
    {id:4,label:'Bokat'},
    {id:5,label:'Altantvätt'},
    {id:6,label:'Efterbehandling'},
    {id:7,label:'Fakturering'},
    {id:8,label:'Fakturerad'},
  ],
  asfaltstvatt: [
    {id:0,label:'Ej påbörjad'},
    {id:1,label:'Inbokat hembesök'},
    {id:2,label:'Hembesök'},
    {id:3,label:'Offert'},
    {id:4,label:'Bokat'},
    {id:5,label:'Asfaltstvätt'},
    {id:6,label:'Fakturering'},
    {id:7,label:'Fakturerad'},
  ],
}

function getSteps(s:string,fog=false){
  if(s==='stentvatt')return fog?SERVICE_STEPS.stentvatt:SERVICE_STEPS.stentvatt_no_fogsand
  if(s==='betongtvatt')return SERVICE_STEPS.betongtvatt
  return SERVICE_STEPS[s]||[]
}
function getServices(c:any):string[]{return Array.isArray(c.services)?c.services:JSON.parse(c.services||'[]')}
function getProgress(c:any):Record<string,number>{try{return typeof c.service_progress==='object'?c.service_progress:JSON.parse(c.service_progress||'{}')}catch{return{}}}
function getKvm(c:any):Record<string,string>{try{return typeof c.service_kvm==='object'?c.service_kvm:JSON.parse(c.service_kvm||'{}')}catch{return{}}}
function svcLabel(s:string){return({stentvatt:'Stentvätt',stentvatt_no_fogsand:'Stentvätt (utan fogsand)',betongtvatt:'Betongtvätt',altantvatt:'Altantvätt',asfaltstvatt:'Asfaltstvätt'} as any)[s]||s}
function statusLabel(s:string){return({new:'Ny',in_progress:'Pågående',completed:'Slutförd',rejected:'Ej Accepterad'} as any)[s]||s}
function fmtDate(d:string){if(!d)return '';return new Date(d).toLocaleDateString('sv-SE',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function normalizeBookedDate(d:string){if(!d)return '';if(!d.includes('T'))return d;const dt=new Date(d);const local=new Date(dt.getTime()+dt.getTimezoneOffset()*-60000);return `${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,'0')}-${String(local.getDate()).padStart(2,'0')}`}
function fmtCur(n:number){return Math.round(n).toLocaleString('sv-SE')+' kr'}
function fmtMins(m:number){const h=Math.floor(m/60),min=m%60;return `${h}h ${min}m`}
function fmtTimer(secs:number){const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60),s=secs%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
function calcProgress(c:any){const p=getProgress(c),svcs=getServices(c);if(!svcs.length)return 0;let t=0;for(const s of svcs){const st=getSteps(s,c.include_fogsand);t+=(p[s]||0)/(st.length-1)*100}return t/svcs.length}
function getStatus(c:any){
  if(c.rejected)return 'rejected'
  const p=getProgress(c),svcs=getServices(c)
  if(!svcs.length||!Object.keys(p).length)return 'new'
  let allDone=true,started=false
  for(const s of svcs){const st=getSteps(s,c.include_fogsand),cur=p[s]||0;if(cur>0)started=true;if(cur<st.length-1)allDone=false}
  if(allDone&&started)return 'completed'
  if(started)return 'in_progress'
  return 'new'
}
function buildMoments(c:any):string[]{
  const moments=['Admin','Körtid']
  getServices(c).forEach(s=>{
    const steps=getSteps(s,c.include_fogsand)
    steps.forEach(step=>{if(step.id>0)moments.push(`${svcLabel(s)} - ${step.label}`)})
  })
  return moments
}

/* ─── PROCESS FILTER (KUNDER) ───────────────────────────────── */
const PROCESS_FILTERS:{id:string,label:string}[]=[
  {id:'all',          label:'Alla steg'},
  {id:'not_started',  label:'Ej påbörjad'},
  {id:'book_visit',   label:'Inbokat hembesök'},
  {id:'visit',        label:'Hembesök'},
  {id:'offer',        label:'Offert'},
  {id:'booked',       label:'Bokat'},
  {id:'main_service', label:'Huvudtjänst'},
  {id:'aftercare',    label:'Efterbehandling'},
  {id:'invoicing',    label:'Fakturering'},
]

function stepLabelToProcessStage(stepLabel:string){
  if(!stepLabel) return 'not_started'
  switch(stepLabel){
    case 'Ej påbörjad':       return 'not_started'
    case 'Inbokat hembesök':  return 'book_visit'
    case 'Hembesök':          return 'visit'
    case 'Offert':            return 'offer'
    case 'Bokat':             return 'booked'
    case 'Stentvätt':
    case 'Altantvätt':
    case 'Asfaltstvätt':
    case 'Betongtvätt':
      return 'main_service'
    case 'Impregnering':
    case 'Fogsand':
    case 'Efterbehandling':
      return 'aftercare'
    case 'Fakturerad':
    case 'Fakturering':
      return 'invoicing'
  }
  if(stepLabel.toLowerCase().includes('tvätt')) return 'main_service'
  return 'aftercare'
}

function getCustomerProcessStages(c:any):Set<string>{
  const p=getProgress(c)
  const svcs=getServices(c)
  if(!svcs.length) return new Set(['not_started'])
  if(!Object.keys(p||{}).length) return new Set(['not_started'])
  const stages=new Set<string>()
  for(const s of svcs){
    const steps=getSteps(s,c.include_fogsand)
    const idx=p[s]||0
    const label=steps?.[idx]?.label || ''
    stages.add(stepLabelToProcessStage(label))
  }
  return stages.size?stages:new Set(['not_started'])
}

/* ─── COLOURS ────────────────────────────────────────────────── */
const LIGHT={bg:'#f4f6f9',surface:'#ffffff',border:'#eaeaea',text:'#000000',textSec:'#666666',primary:'#3b82f6',sidebar:'#1e293b',sidebarText:'#94a3b8',input:'#ffffff',inputBorder:'#eaeaea'}
const DARK={bg:'#000000',surface:'#111111',border:'#333333',text:'#ededed',textSec:'#888888',primary:'#3b82f6',success:'#10b981',warning:'#f59e0b',danger:'#ef4444',sidebar:'#000000',sidebarText:'#888888',input:'#111111',inputBorder:'#333333'}

/* ─── STATUS BADGE ───────────────────────────────────────────── */
function StatusBadge({status}:{status:string}){
  const colors:Record<string,{bg:string,text:string}>={
    new:      {bg:'rgba(34,197,94,0.15)',   text:'#22c55e'},
    in_progress:{bg:'rgba(59,130,246,0.15)',text:'#3b82f6'},
    completed:{bg:'rgba(16,185,129,0.15)', text:'#10b981'},
    rejected: {bg:'rgba(239,68,68,0.15)',  text:'#ef4444'},
  }
  const c=colors[status]||{bg:'rgba(136,136,136,0.15)',text:'#888'}
  return(
    <span style={{display:'inline-flex',alignItems:'center',padding:'3px 10px',borderRadius:9999,fontSize:12,fontWeight:600,background:c.bg,color:c.text,whiteSpace:'nowrap' as const,letterSpacing:'-0.1px'}}>
      {statusLabel(status)}
    </span>
  )
}
const EMPTY_UH={name:'',phone:'',email:'',address:'',amount:'',note:''}
const TODAY=((d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)()

/* ─── ARBETEN 2025 ───────────────────────────────────────────── */
const SERVICES_2025=[
  {key:'stentvatt',    label:'Stentvätt'},
  {key:'altantvatt',   label:'Altantvätt'},
  {key:'asfaltstvatt', label:'Asfaltstvätt'},
  {key:'fasadtvatt',   label:'Fasadtvätt'},
  {key:'taktvatt',     label:'Taktvätt'},
  {key:'ovrigt',       label:'Övrigt'},
]
function getJob2025Items(j:any):{service:string,kvm:number,tid:number,pris:number}[]{
  if(Array.isArray(j.service_items)&&j.service_items.length>0)return j.service_items
  return [{service:j.service||'ovrigt',kvm:j.kvm||0,tid:j.tid||0,pris:j.pris||0}]
}
function normaliseSvcKey(s:string):string{
  const map:Record<string,string>={'stentvätt':'stentvatt','stentvatt':'stentvatt','betongtvatt':'betongtvatt','betongtvätt':'betongtvatt','altantvatt':'altantvatt','altantvätt':'altantvatt','asfaltstvatt':'asfaltstvatt','asfaltstvätt':'asfaltstvatt','stentvatt_no_fogsand':'stentvatt_no_fogsand'}
  return map[s.toLowerCase().trim()]||s
}
type SvcData={kvm:string,hours:string,mins:string,pris:string}
type JobForm={name:string,selectedServices:string[],serviceData:Record<string,SvcData>}
const EMPTY_JOB_FORM:JobForm={name:'',selectedServices:[],serviceData:{}}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function AdminShell({onLogout}:{onLogout:()=>void}){
  const [dark,setDark]=useState(true)
  const [page,setPage]=useState('dashboard')
  const [customers,setCustomers]=useState<any[]>([])
  const [logs,setLogs]=useState<any[]>([])
  const [allLogs,setAllLogs]=useState<any[]>([])
  const [recentActivityLogs,setRecentActivityLogs]=useState<any[]>([])
  const [filter,setFilter]=useState('active')
  const [processFilter,setProcessFilter]=useState('all')
  const [search,setSearch]=useState('')
  const [current,setCurrent]=useState<any>(null)
  const [showModal,setShowModal]=useState(false)
  const [customerMailOpen,setCustomerMailOpen]=useState(false)
  const [customerMailTarget,setCustomerMailTarget]=useState<any>(null)
  const [customerMailThread,setCustomerMailThread]=useState<any[]>([])
  const [customerMailLoading,setCustomerMailLoading]=useState(false)
  const [customerMailCompose,setCustomerMailCompose]=useState('')
  const [customerMailSending,setCustomerMailSending]=useState(false)
  const [customerMailStatus,setCustomerMailStatus]=useState('')
  const [customerMailAiLoading,setCustomerMailAiLoading]=useState(false)
  const [customerMailShowSchedule,setCustomerMailShowSchedule]=useState(false)
  const [customerMailScheduleDate,setCustomerMailScheduleDate]=useState("")
  const [customerMailScheduleTime,setCustomerMailScheduleTime]=useState("08:00")
  const [customersWithNewMail,setCustomersWithNewMail]=useState<Set<string>>(new Set())
  const [showAI,setShowAI]=useState(false)
  const [editMode,setEditMode]=useState(false)
  const [comment,setComment]=useState('')
  const [newForm,setNewForm]=useState({name:'',phone:'',email:'',address:'',services:[] as string[],kvm:{} as Record<string,string>,service_addons:{} as Record<string,string[]>,note:'',price:''})
  const [timeForm,setTimeForm]=useState({moment:'',hours:'',mins:'',date:TODAY})
  const [uhContracts,setUhContracts]=useState<any[]>([])
  const [uhModal,setUhModal]=useState(false)
  const [uhDetailModal,setUhDetailModal]=useState(false)
  const [uhImportModal,setUhImportModal]=useState(false)
  const [uhCurrentId,setUhCurrentId]=useState<string|null>(null)
  const [uhIsEdit,setUhIsEdit]=useState(false)
  const [uhForm,setUhForm]=useState(EMPTY_UH)
  const [uhImportQ,setUhImportQ]=useState('')
  const [jobs2025,setJobs2025]=useState<any[]>([])
  const [jobs2025Form,setJobs2025Form]=useState<JobForm>(EMPTY_JOB_FORM)
  const [jobs2025EditId,setJobs2025EditId]=useState<string|null>(null)
  const [jobs2025Saving,setJobs2025Saving]=useState(false)
  const [jobs2025Msg,setJobs2025Msg]=useState('')
  const [isMobile,setIsMobile]=useState(false)
  const [sidebarOpen,setSidebarOpen]=useState(false)
  const [editLogId,setEditLogId]=useState<string|null>(null)
  const [editLogForm,setEditLogForm]=useState<any>({})
  /* Feature 1: Calendar */
  const [calYear,setCalYear]=useState(new Date().getFullYear())
  const [calMonth,setCalMonth]=useState(new Date().getMonth())
  const [showBookedDateModal,setShowBookedDateModal]=useState(false)
  const [bookedDateCustomer,setBookedDateCustomer]=useState<any>(null)
  const [bookedDateService,setBookedDateService]=useState('')
  const [bookedDateValue,setBookedDateValue]=useState(TODAY)
  /* Feature: Calendar add job */
  const [calAddModal,setCalAddModal]=useState(false)
  const [calAddDate,setCalAddDate]=useState('')
  const [calAddTime,setCalAddTime]=useState('08:00')
  const [calAddEndTime,setCalAddEndTime]=useState('10:00')
  const [calAddCustomerId,setCalAddCustomerId]=useState('')
  const [calAddService,setCalAddService]=useState('')
  const [calAddStep,setCalAddStep]=useState<number>(0)
  const [calAddSearch,setCalAddSearch]=useState('')
  const [calAddOperator,setCalAddOperator]=useState<string[]>(['Herman'])
  const [calInternalModal,setCalInternalModal]=useState(false)
  const [calInternalDate,setCalInternalDate]=useState('')
  const [calInternalTime,setCalInternalTime]=useState('08:00')
  const [calInternalEndTime,setCalInternalEndTime]=useState('09:00')
  const [calInternalTitle,setCalInternalTitle]=useState('')
  const [calInternalNote,setCalInternalNote]=useState('')
  const [internalEvents,setInternalEvents]=useState<any[]>([])
  /* Feature 2: Timer */
  const [timerSecs,setTimerSecs]=useState(0)
  const [timerRunning,setTimerRunning]=useState(false)
  const [timerCustomerId,setTimerCustomerId]=useState<string|null>(null)
  const [timerCustomerName,setTimerCustomerName]=useState('')
  const [timerStartTime,setTimerStartTime]=useState<string|null>(null)
  const [timerMoment,setTimerMoment]=useState('')
  const [timerSelectMoment,setTimerSelectMoment]=useState('')
  /* Feature 3: Quote/Material */
  const [materialItems,setMaterialItems]=useState<{name:string,qty:string,unit_price:string}[]>([])
  const [materialSaving,setMaterialSaving]=useState(false)
  const [materialMsg,setMaterialMsg]=useState('')
  /* Feature 4: Customer list view */
  const [custView,setCustView]=useState<'card'|'table'>('card')
  const [sortCol,setSortCol]=useState('')
  const [sortAsc,setSortAsc]=useState(true)
  /* DEL 1 additions */
  const [listView, setListView] = useState<'cards'|'table'>('cards')
  const [activeTimer, setActiveTimer] = useState<{customerId:string,moment:string,startMs:number}|null>(null)
  const [timerDisplay, setTimerDisplay] = useState('00:00:00')
  const [bookingDateForm, setBookingDateForm] = useState<Record<string,string>>({})
  const [weekOffset,setWeekOffset]=useState(0)
  const C=dark?DARK:LIGHT
  const inp:React.CSSProperties={background:C.input,border:`1px solid ${C.inputBorder}`,borderRadius:6,padding:'7px 11px',color:C.text,fontFamily:'inherit',fontSize:13,width:'100%',boxSizing:'border-box',outline:'none',transition:'border-color 0.15s'}
  const btn=(bg:string,color='white'):React.CSSProperties=>({display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',background:bg,color,border:bg==='transparent'?'1px solid #333':'none',borderRadius:6,fontSize:12,fontWeight:500,cursor:'pointer',fontFamily:'inherit',minHeight:34,transition:'opacity 0.15s',letterSpacing:'-0.1px'})

  useEffect(()=>{loadCustomers();loadAllLogs();loadRecentActivity();loadContracts();loadJobs2025();loadInternalEvents()},[])
  useEffect(()=>{if(customers.length>0)checkNewMails()},[customers.length])
  useEffect(()=>{
    const check=()=>{setIsMobile(window.innerWidth<768);if(window.innerWidth>=768)setSidebarOpen(false)}
    check();window.addEventListener('resize',check);return()=>window.removeEventListener('resize',check)
  },[])

  /* ── Timer: load from localStorage on mount ── */
  useEffect(()=>{
    const stored=localStorage.getItem('ht_active_timer')
    if(stored){
      try{
        const d=JSON.parse(stored)
        if(d.startTime){
          const elapsed=Math.floor((Date.now()-new Date(d.startTime).getTime())/1000)
          setTimerCustomerId(d.customerId||null)
          setTimerCustomerName(d.customerName||'')
          setTimerStartTime(d.startTime)
          setTimerMoment(d.moment||'')
          setTimerSelectMoment(d.moment||'')
          setTimerSecs(elapsed>0?elapsed:0)
          setTimerRunning(true)
        }
      }catch{}
    }
  },[])

  /* ── Timer: tick ── */
  useEffect(()=>{
    if(!timerRunning)return
    const id=setInterval(()=>{
      if(timerStartTime){
        const elapsed=Math.floor((Date.now()-new Date(timerStartTime).getTime())/1000)
        setTimerSecs(elapsed>0?elapsed:0)
      }
    },1000)
    return()=>clearInterval(id)
  },[timerRunning,timerStartTime])

  /* ── When modal opens check localStorage timer for this customer ── */
  useEffect(()=>{
    if(current&&showModal){
      const stored=localStorage.getItem('ht_active_timer')
      if(stored){
        try{
          const d=JSON.parse(stored)
          if(d.customerId===current.id){
            setTimerSelectMoment(d.moment||'')
          }
        }catch{}
      }
      /* Load material items */
      const mi=current.material_items
      if(Array.isArray(mi)&&mi.length>0){
        setMaterialItems(mi.map((x:any)=>({name:x.name||'',qty:String(x.qty||''),unit_price:String(x.unit_price||'')})))
      } else {
        setMaterialItems([{name:'',qty:'',unit_price:''}])
      }
      setMaterialMsg('')
    }
  },[current,showModal])

  /* DEL 2: activeTimer tick */
  useEffect(()=>{
    if(!activeTimer)return
    const iv=setInterval(()=>{
      const e=Date.now()-activeTimer.startMs
      const h=Math.floor(e/3600000),m=Math.floor((e%3600000)/60000),s=Math.floor((e%60000)/1000)
      setTimerDisplay(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`)
    },1000)
    return()=>clearInterval(iv)
  },[activeTimer])

  /* DEL 2: material-loader by current?.id */
  useEffect(()=>{
    if(current?.material_items){
      setMaterialItems(current.material_items.map((i:any)=>({name:i.name,qty:String(i.qty),unit_price:String(i.unit_price)})))
    } else {
      setMaterialItems([])
    }
  },[current?.id])

  async function loadCustomers(){const snap=await getDocs(query(collection(db,'customers'),orderBy('created_at','desc')));setCustomers(snap.docs.map(d=>({id:d.id,...d.data()})))}
  async function loadAllLogs(){const snap=await getDocs(query(collection(db,'activity_logs'),where('log_type','==','time_log')));setAllLogs(snap.docs.map(d=>({id:d.id,...d.data()})))}
  async function loadRecentActivity(){try{const snap=await getDocs(query(collection(db,'activity_logs'),orderBy('timestamp','desc')));const all=snap.docs.map(d=>({id:d.id,...d.data()}));setRecentActivityLogs(all.slice(0,5))}catch{setRecentActivityLogs([])}}
  async function loadLogs(cid:string){const snap=await getDocs(query(collection(db,'activity_logs'),where('customer_id','==',cid)));const l=snap.docs.map(d=>({id:d.id,...d.data()})) as any[];l.sort((a,b)=>new Date(b.timestamp).getTime()-new Date(a.timestamp).getTime());setLogs(l);return l}
  async function loadContracts(){try{const snap=await getDocs(query(collection(db,'maintenance_contracts'),orderBy('created_at','desc')));setUhContracts(snap.docs.map(d=>({id:d.id,...d.data()})))}catch{setUhContracts([])}}
  async function loadJobs2025(){try{const snap=await getDocs(query(collection(db,'customers_2025'),orderBy('created_at','desc')));setJobs2025(snap.docs.map(d=>({id:d.id,...d.data()})))}catch{setJobs2025([])}}

  async function checkNewMails(){
    try{
      const r=await fetch('/api/mail?action=list&folder=inbox')
      const d=await r.json()
      const unread=(d.emails||[]).filter((e:any)=>e.unread===true)
      const newSet=new Set<string>()
      for(const email of unread){
        const match=customers.find((c:any)=>c.email&&email.from?.toLowerCase().includes(c.email.toLowerCase()))
        if(match)newSet.add(match.id)
      }
      setCustomersWithNewMail(newSet)
    }catch{}
  }

  /* ── Timer functions ── */
  function startTimer(cust:any,moment:string){
    const now=new Date().toISOString()
    const data={customerId:cust.id,customerName:cust.name,startTime:now,moment}
    localStorage.setItem('ht_active_timer',JSON.stringify(data))
    setTimerCustomerId(cust.id)
    setTimerCustomerName(cust.name)
    setTimerStartTime(now)
    setTimerMoment(moment)
    setTimerSecs(0)
    setTimerRunning(true)
  }
  async function stopTimer(){
    if(!timerCustomerId||!timerStartTime)return
    const totalMins=Math.max(1,Math.round(timerSecs/60))
    const momentToLog=timerMoment||'Admin'
    await addDoc(collection(db,'activity_logs'),{
      customer_id:timerCustomerId,
      log_type:'time_log',
      moment:momentToLog,
      time_spent:totalMins,
      date:((d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)(),
      content:`${momentToLog}: ${fmtMins(totalMins)} (timer)`,
      timestamp:new Date().toISOString()
    })
    localStorage.removeItem('ht_active_timer')
    setTimerRunning(false)
    setTimerCustomerId(null)
    setTimerCustomerName('')
    setTimerStartTime(null)
    setTimerMoment('')
    setTimerSelectMoment('')
    setTimerSecs(0)
    if(current)await loadLogs(current.id)
    await loadAllLogs()
    await loadRecentActivity()
  }

  /* ── Booked date ── */
  async function saveBookedDate(){
    if(!bookedDateCustomer)return
    await updateDoc(doc(db,'customers',bookedDateCustomer.id),{booked_date:bookedDateValue})
    await loadCustomers()
    if(current&&current.id===bookedDateCustomer.id){setCurrent((p:any)=>({...p,booked_date:bookedDateValue}))}
    setShowBookedDateModal(false)
    setBookedDateCustomer(null)
    setBookedDateService('')
    setBookedDateValue(TODAY)
  }

  /* ── Calendar add job ── */
  async function saveCalAdd(){
    const cust=customers.find(c=>c.id===calAddCustomerId)
    if(!cust)return
    const updateData:any={booked_date:calAddDate,booked_time:calAddTime,booked_end_time:calAddEndTime,booked_operator:calAddOperator}
    if(calAddStep>0){
      const svcs=Array.isArray(calAddService)?calAddService:[calAddService].filter(Boolean)
      if(svcs.length){
        const p={...getProgress(cust)}
        svcs.forEach((s:string)=>{p[s]=calAddStep})
        updateData.service_progress=p
      }
    }
    await updateDoc(doc(db,'customers',calAddCustomerId),updateData)
    await loadCustomers()
    setCalAddModal(false)
    setCalAddCustomerId('');setCalAddSearch('')
    setCalAddService('');setCalAddStep(0)
    setCalAddTime('08:00');setCalAddEndTime('10:00')
  }
  async function removeFromCalendar(customerId:string){
    if(!confirm('Ta bort från kalendern?'))return
    await updateDoc(doc(db,'customers',customerId),{booked_date:'',booked_time:'',booked_end_time:''})
    await loadCustomers()
  }
  async function loadInternalEvents(){
    try{const snap=await getDocs(query(collection(db,'calendar_events'),orderBy('date','asc')));setInternalEvents(snap.docs.map(d=>({id:d.id,...d.data()})))}catch(e){setInternalEvents([])}
  }
  async function saveInternalEvent(){
    if(!calInternalTitle.trim()||!calInternalDate)return
    await addDoc(collection(db,'calendar_events'),{title:calInternalTitle,note:calInternalNote,date:calInternalDate,time:calInternalTime,end_time:calInternalEndTime,type:'internal',created_at:new Date().toISOString()})
    await loadInternalEvents()
    setCalInternalModal(false);setCalInternalTitle('');setCalInternalNote('');setCalInternalTime('08:00');setCalInternalEndTime('09:00')
  }
  async function removeInternalEvent(id:string){
    if(!confirm('Ta bort händelsen?'))return
    await deleteDoc(doc(db,'calendar_events',id))
    await loadInternalEvents()
  }

  /* ── Material items ── */
  async function saveMaterialItems(){
    if(!current)return
    setMaterialSaving(true);setMaterialMsg('')
    try{
      const items=materialItems.filter(i=>i.name.trim()).map(i=>({name:i.name.trim(),qty:parseFloat(i.qty)||0,unit_price:parseFloat(i.unit_price)||0}))
      await updateDoc(doc(db,'customers',current.id),{material_items:items})
      await loadCustomers()
      setCurrent((p:any)=>({...p,material_items:items}))
      setMaterialMsg('✓ Sparat!')
      setTimeout(()=>setMaterialMsg(''),3000)
    }catch(e){setMaterialMsg('Fel vid sparning.')}
    finally{setMaterialSaving(false)}
  }
  const materialTotal=materialItems.reduce((s,i)=>{const q=parseFloat(i.qty)||0;const u=parseFloat(i.unit_price)||0;return s+q*u},0)
  const customerPrice=current?parseFloat(current.price_excl_vat)||0:0
  const materialProfit=customerPrice-materialTotal
  const materialMargin=customerPrice>0?Math.round(materialProfit/customerPrice*100):0

  /* ── CSV Export ── */
  function exportCSV(){
    const rows=[['Namn','Telefon','E-post','Adress','Tjänster','Status','Pris','Bokningsdatum','Skapat']]
    filtered.forEach(c=>{
      rows.push([
        c.name||'',
        c.phone||'',
        c.email||'',
        c.address||'',
        getServices(c).map((s:string)=>svcLabel(s)).join('; '),
        statusLabel(getStatus(c)),
        String(parseFloat(c.price_excl_vat)||0),
        c.booked_date||'',
        c.created_at?new Date(c.created_at).toLocaleDateString('sv-SE'):'',
      ])
    })
    const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a');a.href=url;a.download='kunder.csv';a.click()
    URL.revokeObjectURL(url)
  }

  /* ── Jobs 2025 functions ── */
  function openEditJob2025(j:any){
    const items=getJob2025Items(j)
    const selectedServices=items.map((i:any)=>i.service)
    const serviceData:Record<string,SvcData>={}
    items.forEach((i:any)=>{serviceData[i.service]={kvm:String(i.kvm||''),hours:String(Math.floor((i.tid||0)/60)),mins:String((i.tid||0)%60),pris:String(i.pris||'')}})
    setJobs2025Form({name:j.name,selectedServices,serviceData})
    setJobs2025EditId(j.id)
    document.getElementById('job2025-form')?.scrollIntoView({behavior:'smooth',block:'start'})
  }
  async function deleteJob2025(id:string){if(!confirm('Ta bort detta jobb?'))return;await deleteDoc(doc(db,'customers_2025',id));await loadJobs2025()}
  async function saveJob2025(){
    const{name,selectedServices,serviceData}=jobs2025Form
    if(!name.trim())return setJobs2025Msg('Ange ett namn.')
    if(!selectedServices.length)return setJobs2025Msg('Välj minst en tjänst.')
    for(const svc of selectedServices){
      const d=serviceData[svc]||{kvm:'',hours:'',mins:'',pris:''}
      const kvmN=parseFloat(d.kvm||'0')
      if(isNaN(kvmN)||kvmN<=0)return setJobs2025Msg(`Ange giltigt kvm för ${SERVICES_2025.find(s=>s.key===svc)?.label||svc}.`)
      const tid=(parseInt(d.hours||'0')||0)*60+(parseInt(d.mins||'0')||0)
      if(tid<=0)return setJobs2025Msg(`Ange minst 1 minut för ${SERVICES_2025.find(s=>s.key===svc)?.label||svc}.`)
      const prisN=parseFloat(d.pris||'0')
      if(isNaN(prisN)||prisN<0)return setJobs2025Msg(`Ange giltigt pris för ${SERVICES_2025.find(s=>s.key===svc)?.label||svc}.`)
    }
    const service_items=selectedServices.map(svc=>{
      const d=serviceData[svc]||{kvm:'0',hours:'0',mins:'0',pris:'0'}
      return{service:svc,kvm:parseFloat(d.kvm)||0,tid:(parseInt(d.hours)||0)*60+(parseInt(d.mins)||0),pris:parseFloat(d.pris)||0}
    })
    setJobs2025Saving(true);setJobs2025Msg('')
    try{
      if(jobs2025EditId){await updateDoc(doc(db,'customers_2025',jobs2025EditId),{name:name.trim(),service_items})}
      else{await addDoc(collection(db,'customers_2025'),{name:name.trim(),service_items,created_at:new Date().toISOString()})}
      setJobs2025Form(EMPTY_JOB_FORM);setJobs2025EditId(null);setJobs2025Msg('✓ Sparat!')
      setTimeout(()=>setJobs2025Msg(''),3000);await loadJobs2025()
    }catch(e){setJobs2025Msg('Fel vid sparning.');console.error(e)}
    finally{setJobs2025Saving(false)}
  }
  function toggleSvc2025(key:string){
    const sel=jobs2025Form.selectedServices
    if(sel.includes(key)){
      const next=sel.filter(s=>s!==key)
      const sd={...jobs2025Form.serviceData};delete sd[key]
      setJobs2025Form({...jobs2025Form,selectedServices:next,serviceData:sd})
    }else{
      setJobs2025Form({...jobs2025Form,selectedServices:[...sel,key],serviceData:{...jobs2025Form.serviceData,[key]:{kvm:'',hours:'',mins:'',pris:''}}})
    }
  }
  function setSvcField(svcKey:string,field:keyof SvcData,val:string){
    setJobs2025Form(prev=>({...prev,serviceData:{...prev.serviceData,[svcKey]:{...(prev.serviceData[svcKey]||{kvm:'',hours:'',mins:'',pris:''}),[field]:val}}}))
  }

  async function saveContract(){
    const data={name:uhForm.name.trim(),phone:uhForm.phone.trim(),email:uhForm.email.trim(),address:uhForm.address.trim(),amount:parseFloat(uhForm.amount)||0,note:uhForm.note.trim(),done:false,created_at:new Date().toISOString()}
    if(uhIsEdit&&uhCurrentId){await updateDoc(doc(db,'maintenance_contracts',uhCurrentId),{name:data.name,phone:data.phone,email:data.email,address:data.address,amount:data.amount,note:data.note})}
    else{await addDoc(collection(db,'maintenance_contracts'),data)}
    await loadContracts();setUhModal(false);setUhForm(EMPTY_UH)
  }
  async function toggleDone(id:string){const c=uhContracts.find(x=>x.id===id);if(!c)return;await updateDoc(doc(db,'maintenance_contracts',id),{done:!c.done});await loadContracts()}
  async function deleteContract(id:string){if(!confirm('Ta bort detta avtal?'))return;await deleteDoc(doc(db,'maintenance_contracts',id));await loadContracts();setUhDetailModal(false)}
  async function openCustomerMail(c:any){
    setCustomerMailTarget(c)
    setCustomerMailOpen(true)
    setCustomerMailThread([])
    setCustomerMailCompose('')
    setCustomerMailStatus('')
    setCustomerMailShowSchedule(false)
    setCustomerMailScheduleDate("")
    setCustomersWithNewMail(prev=>{const s=new Set(prev);s.delete(c.id);return s})
    if(!c.email)return
    setCustomerMailLoading(true)
    try{
      const r=await fetch(`/api/mail?action=thread&email=${encodeURIComponent(c.email)}`)
      const d=await r.json()
      const sorted=(d.emails||[]).slice().sort((a:any,b:any)=>new Date(b.date).getTime()-new Date(a.date).getTime())
      setCustomerMailThread(sorted)
    }catch{}
    setCustomerMailLoading(false)
  }

  async function sendCustomerMail(){
    if(!customerMailTarget?.email||!customerMailCompose.trim())return
    setCustomerMailSending(true)
    try{
      const body:any={action:'send',to:customerMailTarget.email,subject:`HT Ytrengöring — ${customerMailTarget.name}`,body:customerMailCompose}
      if(customerMailScheduleDate){body.scheduledAt=customerMailScheduleDate+'T'+customerMailScheduleTime+':00'}
      const r=await fetch('/api/mail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      const d=await r.json()
      if(d.success){setCustomerMailStatus(customerMailScheduleDate?`✓ Schemalagd — ${new Date(customerMailScheduleDate+'T'+customerMailScheduleTime+':00').toLocaleString('sv-SE')}`:'✓ Skickat!');setCustomerMailCompose('');if(!customerMailScheduleDate)openCustomerMail(customerMailTarget)}
      else setCustomerMailStatus('Fel: '+(d.error||''))
    }catch(e:any){setCustomerMailStatus('Fel: '+e.message)}
    setCustomerMailSending(false)
  }

  const STYLE_GUIDE_AI = `Du är Ida Karlsson, kundansvarig på HT Ytrengöring AB. Du skriver mail på uppdrag av företaget.\n\nSIGNATUR (använd ALLTID exakt denna):\nVänligen,\n\nIda Karlsson | Kundfrågor | HT Ytrengöring AB\n\nMejltråden är öppen mellan 07-22 på vardagar\n\nBesöksadress: Storgatan 58, Linköping\n\nSKRIVSÄTT — följ dessa regler exakt:\n- Börja alltid med "Hej [namn]," (komma efter namnet, ny rad)\n- Tom rad efter hälsningen\n- Professionellt, varmt och personligt — som att prata med en vän men ändå seriöst\n- Avsluta med en trevlig hälsning t.ex. "Önskar dig en fin dag/kväll/vecka!" innan signaturen\n- Tom rad innan signaturen\n- Aldrig för kort — ge kunden ordentlig information\n- Erbjud alltid kostnadsfritt hembesök vid prisförfrågningar\n- Hembesök tar "max en kvart", är "helt kostnadsfria", innefattar "vid önskan en liten provtvätt"\n- Ge alltid 2 tidsalternativ för hembesök om relevant\n- Bekräfta bokningar med exakt tid och datum\n\nFÖRETAGET:\n- HT Ytrengöring AB — fasad- och ytrengöring i Östergötland\n- Tjänster: stentvätt (inkl. impregnering, biocid, fogsand), altantvätt, asfaltstvätt, betongtvatt\n- Mejltråden öppen 07-22 vardagar\n- Besöksadress: Storgatan 58, Linköping\n\nSVARA BARA med mailtexten — ingen förklaring, inga kommentarer.`

  async function generateCustomerMailAi(){
    if(!customerMailTarget)return
    setCustomerMailAiLoading(true)
    try{
      const latestIncoming=customerMailThread.find((m:any)=>m.from?.toLowerCase().includes(customerMailTarget.email?.toLowerCase()))
      const prompt=`${STYLE_GUIDE_AI}\n\nKund: ${customerMailTarget.name}\n\n${latestIncoming?`INKOMMANDE MAIL:\nFrån: ${latestIncoming.from}\nÄmne: ${latestIncoming.subject}\nDatum: ${latestIncoming.date}\nInnehåll:\n${latestIncoming.body}`:'(Inget inkommande mail — skriv ett generellt välkomstmail)'}\n\nSkriv ett professionellt svar. Svara BARA med mailtexten.`
      const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:prompt,customers:[]})})
      const d=await r.json()
      setCustomerMailCompose(d.reply||d.message||'')
    }catch{}
    setCustomerMailAiLoading(false)
  }

  async function openCustomer(c:any){setCurrent(c);setShowModal(true);setEditMode(false);setEditLogId(null);setEditLogForm({});setTimeForm({moment:'',hours:'',mins:'',date:TODAY});await loadLogs(c.id)}
  async function addComment(){if(!current||!comment.trim())return;await addDoc(collection(db,'activity_logs'),{customer_id:current.id,log_type:'comment',content:comment,timestamp:new Date().toISOString()});setComment('');await loadLogs(current.id);await loadRecentActivity()}
  async function updateCust(id:string,data:any){await updateDoc(doc(db,'customers',id),data);await loadCustomers();setCurrent((prev:any)=>({...prev,...data}))}
  async function deleteCust(){if(!current||!confirm(`Ta bort ${current.name}?`))return;await deleteDoc(doc(db,'customers',current.id));setShowModal(false);setCurrent(null);await loadCustomers()}
  async function createCustomer(){
    const svcs=newForm.services
    if(!newForm.name||!newForm.phone||!newForm.address||!svcs.length)return alert('Fyll i alla obligatoriska fält')
    const prog:Record<string,number>={};const kv:Record<string,string>={}
    svcs.forEach(s=>{prog[s]=0;kv[s]=newForm.kvm[s]||'0'})
    const include_fogsand=(newForm.service_addons.stentvatt?.length??0)>0
    await addDoc(collection(db,'customers'),{name:newForm.name,phone:newForm.phone,email:newForm.email,address:newForm.address,services:svcs,service_kvm:kv,service_progress:prog,skipped_steps:{},include_fogsand,service_addons:newForm.service_addons,note:newForm.note,price_excl_vat:parseFloat(newForm.price)||0,status:'new',rejected:false,created_at:new Date().toISOString()})
    setNewForm({name:'',phone:'',email:'',address:'',services:[],kvm:{},service_addons:{},note:'',price:''})
    await loadCustomers();setPage('customers')
  }
  async function logTime(){
    if(!current||!timeForm.moment)return alert('Välj ett moment')
    const totalMins=(parseInt(timeForm.hours)||0)*60+(parseInt(timeForm.mins)||0)
    if(totalMins<=0)return alert('Ange minst 1 minut')
    await addDoc(collection(db,'activity_logs'),{customer_id:current.id,log_type:'time_log',moment:timeForm.moment,time_spent:totalMins,date:timeForm.date,content:`${timeForm.moment}: ${fmtMins(totalMins)}`,timestamp:new Date().toISOString()})
    setTimeForm({moment:'',hours:'',mins:'',date:TODAY});await loadLogs(current.id);await loadAllLogs();await loadRecentActivity()
  }
  async function handleAIAction(actionOrEvent?:any){
    if(actionOrEvent&&typeof actionOrEvent==='object'&&actionOrEvent.type==='createCustomer'){
      const d=actionOrEvent.data??actionOrEvent
      const rawServices=Array.isArray(d.services)?d.services:typeof d.services==='string'?[d.services]:['stentvatt']
      const services=rawServices.map(normaliseSvcKey)
      const include_fogsand:boolean=d.include_fogsand??false
      const prog:Record<string,number>={};const kv:Record<string,string>={}
      services.forEach((s:string)=>{prog[s]=0;kv[s]=String(d.service_kvm?.[s]??d.kvm??0)})
      try{await addDoc(collection(db,'customers'),{name:d.name??'',phone:d.phone??'',email:d.email??'',address:d.address??'',services,service_kvm:kv,service_progress:prog,skipped_steps:{},include_fogsand,note:d.note??'',price_excl_vat:parseFloat(d.price)||0,status:'new',rejected:false,created_at:new Date().toISOString()})}
      catch(e){console.error('AI createCustomer error:',e)}
    }
    await loadCustomers()
  }
  async function moveStep(service:string,idx:number){
    if(!current)return
    const p={...getProgress(current)};p[service]=idx
    const steps=getSteps(service,current.include_fogsand)
    const newLabel=steps[idx]?.label||''
    await updateCust(current.id,{service_progress:p})
    await addDoc(collection(db,'activity_logs'),{customer_id:current.id,log_type:'status_change',content:`${svcLabel(service)}: ${newLabel}`,timestamp:new Date().toISOString()})
    await loadLogs(current.id)
    await loadRecentActivity()
    /* Feature 1: if moving to "Bokat", open date picker */
    if(newLabel==='Bokat'){
      setBookedDateCustomer({...current,service_progress:p})
      setBookedDateService(service)
      setBookedDateValue(TODAY)
      setShowBookedDateModal(true)
    }
  }
  async function acceptOffer(service:string){
    if(!current||!confirm('Markera offert som accepterad?'))return
    const p={...getProgress(current)}
    const steps=getSteps(service,current.include_fogsand)
    const offIdx=steps.findIndex(s=>s.label==='Offert')
    p[service]=offIdx+1
    await updateCust(current.id,{service_progress:p,rejected:false})
    await addDoc(collection(db,'activity_logs'),{customer_id:current.id,log_type:'status_change',content:`${svcLabel(service)}: Offert accepterad → Bokat`,timestamp:new Date().toISOString()})
    await loadLogs(current.id)
    await loadRecentActivity()
    /* open date picker */
    setBookedDateCustomer({...current,service_progress:p})
    setBookedDateService(service)
    setBookedDateValue(TODAY)
    setShowBookedDateModal(true)
  }
  async function rejectOffer(){
    if(!current||!confirm('Markera offert som nekad?'))return
    await updateCust(current.id,{rejected:true})
    await addDoc(collection(db,'activity_logs'),{customer_id:current.id,log_type:'status_change',content:'Offert nekad',timestamp:new Date().toISOString()})
    await loadLogs(current.id)
    await loadRecentActivity()
  }
  async function deleteLog(logId:string){
    if(!confirm('Ta bort denna loggpost?'))return
    await deleteDoc(doc(db,'activity_logs',logId))
    if(current)await loadLogs(current.id)
    await loadAllLogs()
    await loadRecentActivity()
  }
  function startEditLog(log:any){
    setEditLogId(log.id)
    if(log.log_type==='time_log'){setEditLogForm({moment:log.moment||'',hours:String(Math.floor((log.time_spent||0)/60)),mins:String((log.time_spent||0)%60),date:log.date||TODAY})}
    else{setEditLogForm({content:log.content||''})}
  }
  async function saveEditLog(){
    if(!editLogId||!current)return
    const log=logs.find(l=>l.id===editLogId);if(!log)return
    if(log.log_type==='time_log'){
      const totalMins=(parseInt(editLogForm.hours)||0)*60+(parseInt(editLogForm.mins)||0)
      if(totalMins<=0)return alert('Ange minst 1 minut')
      await updateDoc(doc(db,'activity_logs',editLogId),{moment:editLogForm.moment,time_spent:totalMins,date:editLogForm.date,content:`${editLogForm.moment}: ${fmtMins(totalMins)}`})
      await loadAllLogs()
    }else if(log.log_type==='comment'){
      if(!editLogForm.content.trim())return
      await updateDoc(doc(db,'activity_logs',editLogId),{content:editLogForm.content.trim()})
    }
    setEditLogId(null);setEditLogForm({});await loadLogs(current.id)
  }

  /* ── Derived values ── */
  const filtered=(()=>{
    let list=customers.filter(c=>{
      const s=getStatus(c)
      if(filter==='active'&&s!=='new'&&s!=='in_progress')return false
      if(filter==='rejected'&&s!=='rejected')return false
      if(filter!=='all'&&filter!=='active'&&filter!=='rejected'&&s!==filter)return false
      if(processFilter!=='all'){const stages=getCustomerProcessStages(c);if(!stages.has(processFilter))return false}
      if(search){const q=search.toLowerCase();if(!c.name?.toLowerCase().includes(q)&&!c.phone?.includes(q)&&!c.address?.toLowerCase().includes(q))return false}
      return true
    })
    if(sortCol){
      list=[...list].sort((a,b)=>{
        let va:any,vb:any
        if(sortCol==='name'){va=a.name||'';vb=b.name||''}
        else if(sortCol==='address'){va=a.address||'';vb=b.address||''}
        else if(sortCol==='status'){va=statusLabel(getStatus(a));vb=statusLabel(getStatus(b))}
        else if(sortCol==='price'){va=parseFloat(a.price_excl_vat)||0;vb=parseFloat(b.price_excl_vat)||0}
        else if(sortCol==='booked_date'){va=a.booked_date||'';vb=b.booked_date||''}
        else if(sortCol==='created_at'){va=a.created_at||'';vb=b.created_at||''}
        else if(sortCol==='services'){va=getServices(a).map((s:string)=>svcLabel(s)).join(', ');vb=getServices(b).map((s:string)=>svcLabel(s)).join(', ')}
        else if(sortCol==='processteg'){va=Array.from(getCustomerProcessStages(a)).join('');vb=Array.from(getCustomerProcessStages(b)).join('')}
        else{va='';vb=''}
        if(typeof va==='number')return sortAsc?va-vb:vb-va
        return sortAsc?String(va).localeCompare(String(vb),'sv'):String(vb).localeCompare(String(va),'sv')
      })
    }
    return list
  })()

  const stats={
    total:customers.length,
    new:customers.filter(c=>getStatus(c)==='new').length,
    progress:customers.filter(c=>getStatus(c)==='in_progress').length,
    completed:customers.filter(c=>getStatus(c)==='completed').length,
    rejected:customers.filter(c=>getStatus(c)==='rejected').length,
    revenue:customers.filter(c=>!c.rejected&&(parseFloat(c.price_excl_vat)||0)>0).reduce((s:number,c:any)=>s+(parseFloat(c.price_excl_vat)||0),0),
  }

  /* Dashboard new KPIs */
  const now2=new Date()
  const thisMonthStart=new Date(now2.getFullYear(),now2.getMonth(),1).toISOString()
  const jobsThisMonth=customers.filter(c=>c.created_at&&c.created_at>=thisMonthStart).length
  const revenueThisMonth=customers.filter(c=>c.created_at&&c.created_at>=thisMonthStart&&!c.rejected).reduce((s:number,c:any)=>s+(parseFloat(c.price_excl_vat)||0),0)

  /* Dashboard: upcoming jobs this week */
  const weekStart=new Date();weekStart.setHours(0,0,0,0)
  const weekEnd=new Date(weekStart);weekEnd.setDate(weekEnd.getDate()+7)
  const upcomingJobs=customers.filter(c=>{
    if(!c.booked_date)return false
    const d=new Date(c.booked_date)
    return d>=weekStart&&d<weekEnd
  }).sort((a,b)=>a.booked_date<b.booked_date?-1:1)

  const allItems2025=jobs2025.flatMap(j=>getJob2025Items(j))
  function svc3Group(key:string):'stentvatt'|'altantvatt'|'asfaltstvatt'|'ovrigt'{
    if(key==='stentvatt')return 'stentvatt'
    if(key==='altantvatt')return 'altantvatt'
    if(key==='asfaltstvatt')return 'asfaltstvatt'
    return 'ovrigt'
  }
  const stats2025={
    totalJobb:jobs2025.length,
    totalKvm:allItems2025.reduce((s,i)=>s+(i.kvm||0),0),
    totalOms:Math.round(allItems2025.reduce((s,i)=>s+(i.pris||0),0)),
    totalTid:allItems2025.reduce((s,i)=>s+(i.tid||0),0),
    kvmPerSvc:allItems2025.reduce((acc,i)=>{acc[i.service]=(acc[i.service]||0)+(i.kvm||0);return acc},{} as Record<string,number>),
  }
  const svcOms:Record<string,number>={stentvatt:0,altantvatt:0,asfaltstvatt:0,ovrigt:0}
  const svcKvm:Record<string,number>={stentvatt:0,altantvatt:0,asfaltstvatt:0,ovrigt:0}
  const svcTid:Record<string,number>={stentvatt:0,altantvatt:0,asfaltstvatt:0,ovrigt:0}
  allItems2025.forEach(i=>{const g=svc3Group(i.service);svcOms[g]+=i.pris||0;svcKvm[g]+=i.kvm||0;svcTid[g]+=i.tid||0})
  function svcRate(g:string){return svcTid[g]>0?Math.round(svcOms[g]/(svcTid[g]/60)):0}
  function svcPriceKvm(g:string){return svcKvm[g]>0?Math.round(svcOms[g]/svcKvm[g]):0}
  const omsPerTimme=stats2025.totalTid>0?Math.round(stats2025.totalOms/(stats2025.totalTid/60)):0
  const prisPerKvm=stats2025.totalKvm>0?Math.round(stats2025.totalOms/stats2025.totalKvm):0

  const uhCurrent=uhContracts.find(x=>x.id===uhCurrentId)
  function openUhDetail(id:string){setUhCurrentId(id);setUhDetailModal(true)}
  function openUhAdd(){setUhIsEdit(false);setUhForm(EMPTY_UH);setUhModal(true)}
  function openUhEdit(c:any){setUhIsEdit(true);setUhCurrentId(c.id);setUhForm({name:c.name,phone:c.phone,email:c.email||'',address:c.address,amount:String(c.amount||''),note:c.note||''});setUhModal(true)}
  function importCustomer(c:any){setUhImportModal(false);setUhIsEdit(false);setUhCurrentId(null);setUhForm({name:c.name,phone:c.phone,email:c.email||'',address:c.address,amount:'',note:''});setUhModal(true)}
  const uhFiltered=uhImportQ?customers.filter(c=>c.name.toLowerCase().includes(uhImportQ.toLowerCase())||c.address.toLowerCase().includes(uhImportQ.toLowerCase())):customers.slice(0,20)

  const custTimeLogs=logs.filter(l=>l.log_type==='time_log')
  const totalTid=custTimeLogs.reduce((s,l)=>s+(l.time_spent||0),0)
  const momentTid=custTimeLogs.filter(l=>l.moment!=='Admin'&&l.moment!=='Körtid').reduce((s,l)=>s+(l.time_spent||0),0)
  const adminTid=custTimeLogs.filter(l=>l.moment==='Admin').reduce((s,l)=>s+(l.time_spent||0),0)
  const korTid=custTimeLogs.filter(l=>l.moment==='Körtid').reduce((s,l)=>s+(l.time_spent||0),0)

  const svc3Colors:{[k:string]:string}={stentvatt:'#3b82f6',altantvatt:'#10b981',asfaltstvatt:'#f59e0b',ovrigt:'#8b5cf6'}
  const modalOverlay:React.CSSProperties={position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:isMobile?'flex-end':'center',justifyContent:'center',zIndex:1000,padding:isMobile?0:20}
  const modalBox=(maxW=900):React.CSSProperties=>({background:C.surface,borderRadius:isMobile?'12px 12px 0 0':8,maxWidth:isMobile?'100%':maxW,width:'100%',maxHeight:isMobile?'95vh':'90vh',overflowY:'auto',boxShadow:'0 0 0 1px rgba(0,0,0,0.1),0 8px 32px rgba(0,0,0,0.3)'})

  /* ── Calendar helpers ── */
  function getCalDays(year:number,month:number){
    const firstDay=new Date(year,month,1).getDay()
    const daysInMonth=new Date(year,month+1,0).getDate()
    const startPad=firstDay===0?6:firstDay-1
    const cells:({day:number,date:string}|null)[]=[]
    for(let i=0;i<startPad;i++)cells.push(null)
    for(let d=1;d<=daysInMonth;d++){
      const dd=String(d).padStart(2,'0')
      const mm=String(month+1).padStart(2,'0')
      cells.push({day:d,date:`${year}-${mm}-${dd}`})
    }
    while(cells.length%7!==0)cells.push(null)
    return cells
  }
  const calDays=getCalDays(calYear,calMonth)
  const MONTH_NAMES=['Januari','Februari','Mars','April','Maj','Juni','Juli','Augusti','September','Oktober','November','December']
  const DAY_NAMES=['Mån','Tis','Ons','Tor','Fre','Lör','Sön']
  const todayStr=((d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)()

  /* Calendar customers: have booked_date and are NOT "Fakturerad" */
  const calCustomers=customers.filter(c=>{
    if(!c.booked_date)return false
    const p=getProgress(c),svcs=getServices(c)
    let anyBooked=false,allFakturerad=true
    for(const s of svcs){
      const steps=getSteps(s,c.include_fogsand)
      const cur=p[s]||0
      const label=steps[cur]?.label||''
      const bookedIdx=steps.findIndex(st=>st.label==='Bokat')
      if(cur>=bookedIdx&&bookedIdx>-1)anyBooked=true
      if(label!=='Fakturerad')allFakturerad=false
    }
    return anyBooked&&!allFakturerad
  })

  function sortCol2(col:string){
    if(sortCol===col){setSortAsc(!sortAsc)}else{setSortCol(col);setSortAsc(true)}
  }
  function sortIcon(col:string){
    if(sortCol!==col)return <i className="fas fa-sort" style={{opacity:0.3,marginLeft:4}}/>
    return <i className={`fas fa-sort-${sortAsc?'up':'down'}`} style={{marginLeft:4,color:C.primary}}/>
  }

  return(
    <div style={{display:'flex',height:'100vh',overflow:'hidden',fontFamily:'Inter,system-ui,sans-serif',background:C.bg,color:C.text,width:'100%',position:'relative'}}>
      {/* Pulsing timer indicator style */}
      <style>{`@keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(1.4)}}`}</style>

      {isMobile&&(
        <button onClick={()=>setSidebarOpen(!sidebarOpen)} style={{position:'fixed',top:12,left:12,zIndex:1100,width:42,height:42,background:C.sidebar,border:'none',borderRadius:10,color:'white',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 8px rgba(0,0,0,0.35)'}}>
          <i className={sidebarOpen?'fas fa-times':'fas fa-bars'}/>
        </button>
      )}
      {isMobile&&sidebarOpen&&<div onClick={()=>setSidebarOpen(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:999}}/>}

      {/* SIDEBAR */}
      <aside style={{width:240,flexShrink:0,background:C.sidebar,color:C.sidebarText,display:'flex',flexDirection:'column',height:'100vh',overflowY:'auto',borderRight:`1px solid ${C.border}`,...(isMobile?{position:'fixed' as const,top:0,left:0,zIndex:1000,transform:sidebarOpen?'translateX(0)':'translateX(-100%)',transition:'transform 0.25s ease'}:{})}}>
        {/* Logo */}
        <div style={{padding:'20px 20px 16px',borderBottom:'1px solid #222'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:28,height:28,borderRadius:6,background:'linear-gradient(135deg, #3b82f6, #6366f1)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <i className="fas fa-droplet" style={{fontSize:12,color:'white'}}/>
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:'#ededed',letterSpacing:'-0.3px'}}>HT Ytrengöring</div>
              <div style={{fontSize:10,color:'#555',letterSpacing:'0.05em'}}>ADMIN</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{flex:1,padding:'8px 0'}}>
          {([
            ['dashboard',   BarChart2,    'Översikt'],
            ['mail',        Bot,          'Mail'],
            ['customers',   Users,         'Kunder'],
            ['kalender',    CalendarDays,  'Kalender'],
            ['new-customer',Plus,          'Ny kund'],
            ['underhall',   RefreshCw,     'Underhåll'],
            ['statistik',   BarChart,      'Statistik'],
            ['arbeten2025', ClipboardList, 'Arbeten 2025'],
          ] as [string,any,string][]).map(([p,Icon,label])=>(
            <div key={p} onClick={()=>{setPage(p);if(isMobile)setSidebarOpen(false)}}
              style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',borderRadius:6,margin:'1px 8px',background:page===p?'rgba(59,130,246,0.12)':'transparent',color:page===p?'#ededed':'#888',transition:'all 0.15s',fontSize:13,borderLeft:page===p?'3px solid #3b82f6':'3px solid transparent'}}>
              <Icon size={14} color={page===p?'#3b82f6':'#555'} style={{flexShrink:0}}/>
              <span>{label}</span>
              {page===p&&<div style={{marginLeft:'auto',width:4,height:4,borderRadius:'50%',background:'#3b82f6'}}/>}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div style={{padding:'12px 8px',borderTop:'1px solid #222',display:'flex',flexDirection:'column',gap:4}}>
          <div onClick={()=>setShowAI(!showAI)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',borderRadius:6,background:showAI?'#111':'transparent',color:showAI?'#ededed':'#888',fontSize:13,transition:'all 0.15s'}}>
            <Bot size={14} color={showAI?'#3b82f6':'#555'} style={{flexShrink:0}}/>
            <span>AI-assistent</span>
            {activeTimer&&<div style={{marginLeft:'auto',width:8,height:8,borderRadius:'50%',background:'#ef4444',animation:'pulse 1.5s infinite'}}/>}
          </div>
          <div onClick={()=>setDark(!dark)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',borderRadius:6,color:'#888',fontSize:13,transition:'all 0.15s'}}>
            {dark?<Sun size={14} color="#555" style={{flexShrink:0}}/>:<Moon size={14} color="#555" style={{flexShrink:0}}/>}
            <span>{dark?'Ljust läge':'Mörkt läge'}</span>
          </div>
          <div onClick={onLogout} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',borderRadius:6,color:'#888',fontSize:13,transition:'all 0.15s'}}>
            <LogOut size={14} color="#555" style={{flexShrink:0}}/>
            <span>Logga ut</span>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{flex:1,padding:isMobile?'16px':'28px 32px',paddingTop:isMobile?'66px':'28px',height:'100vh',overflowY:'auto',minWidth:0,background:C.bg}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isMobile?16:28,gap:8,flexWrap:'wrap' as const}}>
          <h1 style={{fontSize:isMobile?18:22,fontWeight:600,color:C.text,margin:0}}>
            {({'dashboard':'Dashboard','customers':'Kunder','kalender':'Kalender','new-customer':'Ny kund','underhall':'Årligt underhåll','statistik':'Statistik','arbeten2025':'Arbeten 2025','mail':'Mail'} as any)[page]}
          </h1>
          {page==='kalender'
            ?<div style={{display:'flex',gap:8}}>
                <button onClick={()=>{setCalAddDate(((d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)());setCalAddTime('08:00');setCalAddEndTime('10:00');setCalAddCustomerId('');setCalAddSearch('');setCalAddService('');setCalAddStep(0);setCalAddOperator(['Herman']);setCalAddModal(true)}} style={btn(C.primary)}><i className="fas fa-calendar-plus"/>{!isMobile&&' Boka jobb'}</button>
                <button onClick={()=>{setCalInternalDate(((d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)());setCalInternalTime('08:00');setCalInternalEndTime('09:00');setCalInternalTitle('');setCalInternalNote('');setCalInternalModal(true)}} style={btn('#8b5cf6')}><i className="fas fa-sticky-note"/>{!isMobile&&' Intern'}</button>
              </div>
            :<button onClick={()=>setPage('new-customer')} style={btn(C.primary)}><i className="fas fa-plus"/>{!isMobile&&' Ny kund'}</button>
          }
        </div>

        {/* ── DASHBOARD ── */}
        {page==='dashboard'&&<>
          <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(4,1fr)',gap:isMobile?10:14,marginBottom:24}}>
            {([
              ['fas fa-folder-open','Totalt ärenden', stats.total,                                    '#6366f1'],
              ['fas fa-star',       'Nya ärenden',    stats.new,                                      '#f59e0b'],
              ['fas fa-spinner',    'Öppna ärenden',  stats.progress,                                 C.primary],
              ['fas fa-check-circle','Stängda',       stats.completed,                                '#10b981'],
              ['fas fa-times-circle','Ej Accepterade',stats.rejected,                                 '#ef4444'],
              ['fas fa-coins',      'Omsättning',     stats.revenue>0?fmtCur(stats.revenue):'0 kr',  '#10b981'],
              ['fas fa-calendar-check','Jobb denna månad', String(jobsThisMonth),                     '#06b6d4'],
              ['fas fa-money-bill-wave','Intäkt denna månad', revenueThisMonth>0?fmtCur(revenueThisMonth):'0 kr','#8b5cf6'],
            ] as [string,string,any,string][]).map(([icon,label,val,color])=>(
              <div key={label} style={{background:C.surface,padding:isMobile?'14px 12px':'18px 16px',borderRadius:10,border:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:isMobile?8:14,minWidth:0,minHeight:80,transition:'all 0.2s',cursor:'default'}}
                onMouseEnter={e=>(e.currentTarget.style.borderColor=color)}
                onMouseLeave={e=>(e.currentTarget.style.borderColor=C.border)}>
                <div style={{width:isMobile?36:44,height:isMobile?36:44,borderRadius:10,background:`linear-gradient(135deg, ${color}20, ${color}10)`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <i className={icon} style={{fontSize:20,color}}/>
                </div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:isMobile?14:typeof val==='string'&&val.length>6?16:28,fontWeight:700,color:C.text,lineHeight:1}}>{val}</div>
                  <div style={{fontSize:isMobile?10:12,color:C.textSec,marginTop:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Kommande jobb denna vecka */}
          <div style={{background:C.surface,padding:isMobile?16:24,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',marginBottom:20}}>
            <h2 style={{fontSize:isMobile?15:18,fontWeight:600,marginBottom:16,color:C.text,display:'flex',alignItems:'center',gap:8}}><i className="fas fa-calendar-week" style={{color:C.primary}}/> Kommande jobb denna vecka</h2>
            {upcomingJobs.length===0
              ?<div style={{color:C.textSec,fontSize:14,padding:'12px 0'}}>Inga bokade jobb de kommande 7 dagarna.</div>
              :<div style={{display:'flex',flexDirection:'column',gap:8}}>
                {upcomingJobs.map(c=>(
                  <div key={c.id} onClick={()=>openCustomer(c)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',background:C.bg,borderRadius:8,cursor:'pointer',border:`1px solid ${C.border}`,transition:'border-color 0.2s'}}
                    onMouseEnter={e=>(e.currentTarget.style.borderColor=C.primary)}
                    onMouseLeave={e=>(e.currentTarget.style.borderColor=C.border)}>
                    <div>
                      <div style={{fontWeight:600,color:C.text,fontSize:14}}>{c.name}</div>
                      <div style={{fontSize:12,color:C.textSec}}>{c.address} · {getServices(c).map((s:string)=>svcLabel(s)).join(', ')}</div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                      <span style={{fontSize:13,fontWeight:700,color:C.primary,whiteSpace:'nowrap'}}>{c.booked_date}</span>
                      {(parseFloat(c.price_excl_vat)||0)>0&&<span style={{fontSize:12,color:'#10b981',fontWeight:600}}>{fmtCur(parseFloat(c.price_excl_vat))}</span>}
                    </div>
                  </div>
                ))}
              </div>
            }
          </div>

          <div style={{background:C.surface,padding:isMobile?16:24,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)'}}>
            <h2 style={{fontSize:isMobile?15:18,fontWeight:600,marginBottom:16,color:C.text}}>Aktiva ärenden</h2>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(340px,1fr))',gap:16}}>
              {customers.filter(c=>{const s=getStatus(c);return s==='new'||s==='in_progress'}).map(c=><CustomerCard key={c.id} c={c} C={C} onClick={()=>openCustomer(c)} onMail={openCustomerMail} hasNewMail={customersWithNewMail.has(c.id)}/>)}
            </div>
          </div>
        </>}

        {/* ── CUSTOMERS ── */}
        {page==='customers'&&<>
          <div style={{background:C.surface,padding:isMobile?12:16,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',marginBottom:20,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap' as const,gap:12}}>
            <div style={{display:'flex',alignItems:'center',gap:10,background:C.bg,padding:'10px 14px',borderRadius:8,flex:1,maxWidth:400}}>
              <i className="fas fa-search" style={{color:C.textSec}}/>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Sök kund..." style={{border:'none',background:'transparent',outline:'none',flex:1,fontFamily:'inherit',fontSize:14,color:C.text}}/>
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap' as const}}>
              {([['active','Aktiva'],['new','Nya'],['in_progress','Öppna'],['completed','Stängda'],['rejected','Ej Accepterade']] as [string,string][]).map(([f,l])=>(
                <button key={f} onClick={()=>setFilter(f)} style={{padding:'6px 16px',border:`1.5px solid ${filter===f?C.primary:C.border}`,background:filter===f?C.primary:'transparent',color:filter===f?'white':C.textSec,borderRadius:9999,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',minHeight:34,transition:'all 0.15s',letterSpacing:'-0.1px',boxShadow:filter===f?'0 2px 8px rgba(59,130,246,0.3)':'none'}}>{l}</button>
              ))}
            </div>
            <div style={{width:'100%',height:1,background:C.border,opacity:0.9}}/>
            <div style={{width:'100%',display:'flex',flexDirection:'column',gap:8}}>
              <div style={{fontSize:12,fontWeight:700,color:C.textSec,letterSpacing:'0.04em',textTransform:'uppercase' as const}}>Ärendeprocess</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap' as const}}>
                {PROCESS_FILTERS.map(({id,label})=>(
                  <button key={id} onClick={()=>setProcessFilter(id)} style={{padding:'6px 16px',border:`1.5px solid ${processFilter===id?C.primary:C.border}`,background:processFilter===id?C.primary:'transparent',color:processFilter===id?'white':C.textSec,borderRadius:9999,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',minHeight:34,transition:'all 0.15s',letterSpacing:'-0.1px',boxShadow:processFilter===id?'0 2px 8px rgba(59,130,246,0.3)':'none'}}>{label}</button>
                ))}
              </div>
            </div>
            <div style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap' as const}}>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setCustView('card')} style={{padding:'7px 14px',border:`2px solid ${custView==='card'?C.primary:C.border}`,background:custView==='card'?C.primary:C.surface,color:custView==='card'?'white':C.text,borderRadius:8,fontSize:12,fontWeight:500,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6}}><i className="fas fa-th-large"/> Kortvy</button>
                <button onClick={()=>setCustView('table')} style={{padding:'7px 14px',border:`2px solid ${custView==='table'?C.primary:C.border}`,background:custView==='table'?C.primary:C.surface,color:custView==='table'?'white':C.text,borderRadius:8,fontSize:12,fontWeight:500,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6}}><i className="fas fa-table"/> Tabellvy</button>
              </div>
              <button onClick={exportCSV} style={{...btn('#64748b'),fontSize:12}}><i className="fas fa-file-csv"/> Exportera CSV</button>
            </div>
          </div>

          {filtered.length===0
            ?<div style={{textAlign:'center',padding:'60px',color:C.textSec}}>Inga ärenden att visa</div>
            :custView==='card'
              ?<div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(340px,1fr))',gap:16}}>{filtered.map(c=><CustomerCard key={c.id} c={c} C={C} onClick={()=>openCustomer(c)} onMail={openCustomerMail} hasNewMail={customersWithNewMail.has(c.id)}/>)}</div>
              :<div style={{background:C.surface,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',overflow:'hidden'}}>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                    <thead>
                      <tr style={{background:C.bg}}>
                        {([['name','Namn'],['address','Adress'],['services','Tjänster'],['status','Status'],['processteg','Processteg'],['price','Pris'],['booked_date','Bokningsdatum'],['created_at','Skapat']] as [string,string][]).map(([col,lbl])=>(
                          <th key={col} onClick={()=>sortCol2(col)} style={{padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:C.textSec,letterSpacing:'0.04em',textTransform:'uppercase' as const,cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}}>
                            {lbl}{sortIcon(col)}
                          </th>
                        ))}
                        <th style={{padding:'10px 14px',textAlign:'right',fontSize:11,fontWeight:700,color:C.textSec}}>Åtgärder</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c,idx)=>{
                        const status=getStatus(c)
                        const stages=Array.from(getCustomerProcessStages(c)).map(s=>PROCESS_FILTERS.find(p=>p.id===s)?.label||s).join(', ')
                        return(
                          <tr key={c.id} style={{borderTop:`1px solid ${C.border}`,background:idx%2===0?C.surface:C.bg}}>
                            <td style={{padding:'10px 14px',fontWeight:600,color:C.text,whiteSpace:'nowrap'}}>{c.name}</td>
                            <td style={{padding:'10px 14px',color:C.textSec,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.address}</td>
                            <td style={{padding:'10px 14px',color:C.text}}>{getServices(c).map((s:string)=>svcLabel(s)).join(', ')}</td>
                            <td style={{padding:'10px 14px'}}>
                              <StatusBadge status={status}/>
                            </td>
                            <td style={{padding:'10px 14px',color:C.textSec,fontSize:12}}>{stages}</td>
                            <td style={{padding:'10px 14px',fontWeight:700,color:'#10b981',whiteSpace:'nowrap'}}>{(parseFloat(c.price_excl_vat)||0)>0?fmtCur(parseFloat(c.price_excl_vat)):'-'}</td>
                            <td style={{padding:'10px 14px',color:C.textSec,whiteSpace:'nowrap'}}>{c.booked_date||'-'}</td>
                            <td style={{padding:'10px 14px',color:C.textSec,whiteSpace:'nowrap'}}>{c.created_at?new Date(c.created_at).toLocaleDateString('sv-SE'):'-'}</td>
                            <td style={{padding:'10px 14px',textAlign:'right'}}>
                              <button onClick={()=>openCustomer(c)} style={{padding:'5px 12px',background:C.primary,color:'white',border:'none',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}><i className="fas fa-eye"/></button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
          }
        </>}

        {/* ── KALENDER ── */}
        {page==='kalender'&&(()=>{
  const MONTH_NAMES=['Januari','Februari','Mars','April','Maj','Juni','Juli','Augusti','September','Oktober','November','December']
  const DAY_NAMES=['Måndag','Tisdag','Onsdag','Torsdag','Fredag','Lördag','Söndag']
  const DAY_SHORT=['Mån','Tis','Ons','Tor','Fre','Lör','Sön']

  // Beräkna veckans start (måndag)
  const getWeekStart=(date:Date)=>{
    const d=new Date(date)
    const day=d.getDay()
    const diff=day===0?-6:1-day
    d.setDate(d.getDate()+diff)
    d.setHours(0,0,0,0)
    return d
  }

  const weekStart=getWeekStart(new Date(calYear,calMonth,calYear===new Date().getFullYear()&&calMonth===new Date().getMonth()?new Date().getDate():1))

  // Navigera vecka
  const currentWeekStart=new Date(weekStart)
  currentWeekStart.setDate(currentWeekStart.getDate()+weekOffset*7)

  const weekDays=Array.from({length:7},(_,i)=>{
    const d=new Date(currentWeekStart)
    d.setDate(d.getDate()+i);d.setHours(0,0,0,0)
    return d
  })

  const _tn=new Date();const todayStr=`${_tn.getFullYear()}-${String(_tn.getMonth()+1).padStart(2,"0")}-${String(_tn.getDate()).padStart(2,"0")}`
  const weekLabel=`${currentWeekStart.getDate()} ${MONTH_NAMES[currentWeekStart.getMonth()]} – ${weekDays[6].getDate()} ${MONTH_NAMES[weekDays[6].getMonth()]} ${weekDays[6].getFullYear()}`

  return(
    <div>
      {/* Navigation */}
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,flexWrap:'wrap' as const}}>
        <button onClick={()=>setWeekOffset(w=>w-1)} style={{padding:'8px 14px',border:`1px solid ${C.border}`,background:C.surface,color:C.text,borderRadius:10,cursor:'pointer',fontSize:16,fontWeight:600}}>‹</button>
        <button onClick={()=>setWeekOffset(0)} style={{padding:'6px 14px',border:`1px solid ${C.border}`,background:C.surface,color:C.primary,borderRadius:10,cursor:'pointer',fontSize:12,fontWeight:600}}>Idag</button>
        <span style={{fontSize:isMobile?14:18,fontWeight:700,color:C.text,flex:1,textAlign:'center'}}>{weekLabel}</span>
        <button onClick={()=>setWeekOffset(w=>w+1)} style={{padding:'8px 14px',border:`1px solid ${C.border}`,background:C.surface,color:C.text,borderRadius:10,cursor:'pointer',fontSize:16,fontWeight:600}}>›</button>
      </div>

      {/* Veckokalender */}
      <div style={{background:C.surface,borderRadius:16,border:`1px solid ${C.border}`,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
        {/* Dag-headers */}
        <div style={{display:'grid',gridTemplateColumns:'36px repeat(7,1fr)',borderBottom:`1px solid ${C.border}`}}>
          <div style={{padding:'12px 4px',background:C.bg,borderRight:`1px solid ${C.border}`}}/>
          {weekDays.map((d,i)=>{
            const dateStr=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
            const isToday=dateStr===todayStr
            return(
              <div key={i} style={{padding:'8px 4px',textAlign:'center',background:isToday?`${C.primary}10`:C.bg,borderRight:i<6?`1px solid ${C.border}`:'none'}}>
                <div style={{fontSize:isMobile?9:11,fontWeight:600,color:C.textSec,marginBottom:3}}>{isMobile?DAY_SHORT[i]:DAY_NAMES[i]}</div>
                <div style={{width:26,height:26,borderRadius:'50%',background:isToday?C.primary:'transparent',color:isToday?'white':C.text,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto',fontSize:13,fontWeight:isToday?700:400}}>{d.getDate()}</div>
              </div>
            )
          })}
        </div>

        {/* Tidslinje 07–20 */}
        {(()=>{
          const HOUR_START=7,HOUR_END=20,HOUR_COUNT=HOUR_END-HOUR_START,HOUR_H=44
          const TIMELINE_H=HOUR_COUNT*HOUR_H
          const hours=Array.from({length:HOUR_COUNT+1},(_,i)=>HOUR_START+i)
          return(
            <div style={{display:'grid',gridTemplateColumns:'36px repeat(7,1fr)',overflow:'auto'}}>
              {/* Y-axel med timmar */}
              <div style={{borderRight:`1px solid ${C.border}`,position:'relative' as const,height:TIMELINE_H,marginTop:0}}>
                {hours.map(h=>(
                  <div key={h} style={{position:'absolute' as const,top:(h-HOUR_START)*HOUR_H-7,right:4,fontSize:9,color:C.textSec,fontWeight:600,lineHeight:1}}>{String(h).padStart(2,'0')}</div>
                ))}
              </div>
              {weekDays.map((d,i)=>{
                const dateStr=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
                const rawJobs=customers.filter(c=>normalizeBookedDate(c.booked_date)===dateStr&&!c.rejected)
                const dayJobs=[...rawJobs].sort((a,b)=>(a.booked_time||'00:00').localeCompare(b.booked_time||'00:00'))
                const isToday=dateStr===todayStr
                return(
                  <div key={i} style={{borderRight:i<6?`1px solid ${C.border}`:'none',position:'relative' as const,height:TIMELINE_H,background:isToday?`${C.primary}04`:'transparent'}}>
                    {/* Horisontella timlinjer */}
                    {hours.map(h=>(
                      <div key={h} style={{position:'absolute' as const,top:(h-HOUR_START)*HOUR_H,left:0,right:0,borderTop:`1px solid ${C.border}`,opacity:0.5}}/>
                    ))}
                    {/* Jobb-kort med overlap-hantering */}
                    {(()=>{
                      // Beräkna position för varje jobb
                      type JPos={top:number,height:number}
                      const positions:JPos[]=dayJobs.map(c=>{
                        let top=0,height=HOUR_H
                        if(c.booked_time){const[sh,sm]=(c.booked_time).split(':').map(Number);top=(sh-HOUR_START+sm/60)*HOUR_H}
                        if(c.booked_time&&c.booked_end_time){const[sh,sm]=c.booked_time.split(':').map(Number);const[eh,em]=c.booked_end_time.split(':').map(Number);height=Math.max(HOUR_H,(eh-sh+(em-sm)/60)*HOUR_H)}
                        return{top,height}
                      })
                      // Overlap-kolumner: varje jobb får col-index, totalCols = max i SAMMA överlapp-grupp
                      const cols:number[]=new Array(dayJobs.length).fill(0)
                      const totalCols:number[]=new Array(dayJobs.length).fill(1)
                      const overlaps=(a:number,b:number)=>{
                        const aBot=positions[a].top+positions[a].height
                        const bBot=positions[b].top+positions[b].height
                        return positions[a].top<bBot&&aBot>positions[b].top
                      }
                      // Tilldela kolumner
                      for(let a=0;a<dayJobs.length;a++){
                        const usedCols=new Set<number>()
                        for(let b=0;b<a;b++){if(overlaps(a,b))usedCols.add(cols[b])}
                        let c=0;while(usedCols.has(c))c++
                        cols[a]=c
                      }
                      // Räkna totalCols = max kolumner i varje överlapp-grupp
                      for(let a=0;a<dayJobs.length;a++){
                        let maxC=cols[a]
                        for(let b=0;b<dayJobs.length;b++){if(a!==b&&overlaps(a,b))maxC=Math.max(maxC,cols[b])}
                        totalCols[a]=maxC+1
                      }
                      return dayJobs.map((c,idx)=>{
                        const statusColors:Record<string,string>={new:'#22c55e',in_progress:C.primary,completed:'#10b981',rejected:'#888888'}
                        const s=getStatus(c),color=statusColors[s]||'#888'
                        const{top:topPx,height:heightPx}=positions[idx]
                        const col=cols[idx],total=Math.max(totalCols[idx],1)
                        const colW=`${100/total}%`,colL=`calc(${col*100/total}% + 2px)`
                        const svcs=getServices(c)
                        const ops:string[]=Array.isArray(c.booked_operator)?c.booked_operator:c.booked_operator?[c.booked_operator]:[]
                        return(
                          <div key={c.id} style={{position:'absolute' as const,top:topPx,left:colL,width:`calc(${colW} - 4px)`,height:heightPx,background:`${color}18`,border:`1px solid ${color}40`,borderLeft:`3px solid ${color}`,borderRadius:6,overflow:'hidden',zIndex:1,transition:'all 0.15s'}}>
                            <div onClick={()=>openCustomer(c)} style={{cursor:'pointer',padding:'3px 5px',height:'100%',overflow:'hidden'}}>
                              {c.booked_time&&<div style={{fontSize:8,color:color,fontWeight:700,lineHeight:1.2}}>{c.booked_time}{c.booked_end_time?`–${c.booked_end_time}`:''}</div>}
                              <div style={{fontSize:isMobile?9:11,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</div>
                              {heightPx>HOUR_H&&<div style={{fontSize:9,color:C.textSec,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.address}</div>}
                              {heightPx>HOUR_H&&svcs.length>0&&<div style={{fontSize:8,color:color,fontWeight:600,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{svcs.map((sv:string)=>svcLabel(sv)).join(', ')}</div>}
                              {ops.length>0&&<div style={{fontSize:8,color:'#8b5cf6',fontWeight:700,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ops.join(' & ')}</div>}
                            </div>
                            {/* Redigera + ta bort knappar */}
                            <div style={{position:'absolute',bottom:4,right:4,display:'flex',gap:3,zIndex:2}}>
                              <button onClick={e=>{e.stopPropagation();setCalAddDate(c.booked_date||dateStr);setCalAddTime(c.booked_time||'08:00');setCalAddEndTime(c.booked_end_time||'10:00');setCalAddCustomerId(c.id);setCalAddSearch(c.name);setCalAddService(getServices(c));setCalAddOperator(Array.isArray(c.booked_operator)?c.booked_operator:c.booked_operator?[c.booked_operator]:['Herman']);setCalAddStep(0);setCalAddModal(true)}}
                                title="Redigera bokning"
                                style={{width:20,height:20,background:`${color}30`,border:`1px solid ${color}50`,borderRadius:4,color:color,cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>
                                ✏
                              </button>
                              <button onClick={e=>{e.stopPropagation();removeFromCalendar(c.id)}}
                                title="Ta bort från kalender"
                                style={{width:20,height:20,background:'rgba(239,68,68,0.15)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:4,color:'#ef4444',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>
                                ✕
                              </button>
                            </div>
                          </div>
                        )
                      })
                    })()}
                    {/* Interna händelser */}
                    {internalEvents.filter(ev=>ev.date===dateStr).map(ev=>{
                      let topPx=0,heightPx=HOUR_H
                      if(ev.time){const [sh,sm]=(ev.time).split(':').map(Number);topPx=(sh-HOUR_START+sm/60)*HOUR_H}
                      if(ev.time&&ev.end_time){const [sh,sm]=ev.time.split(':').map(Number);const [eh,em]=ev.end_time.split(':').map(Number);heightPx=Math.max(HOUR_H,(eh-sh+(em-sm)/60)*HOUR_H)}
                      return(
                        <div key={ev.id} style={{position:'absolute' as const,top:topPx,left:2,right:2,height:heightPx,background:'rgba(139,92,246,0.15)',border:'1px solid rgba(139,92,246,0.4)',borderLeft:'3px solid #8b5cf6',borderRadius:6,overflow:'hidden',zIndex:1}}>
                          <div style={{padding:'3px 5px',height:'100%',overflow:'hidden'}}>
                            {ev.time&&<div style={{fontSize:8,color:'#8b5cf6',fontWeight:700,lineHeight:1.2}}>{ev.time}{ev.end_time?`–${ev.end_time}`:''}</div>}
                            <div style={{fontSize:isMobile?9:11,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ev.title}</div>
                            {heightPx>HOUR_H&&ev.note&&<div style={{fontSize:9,color:C.textSec,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ev.note}</div>}
                          </div>
                          <button onClick={e=>{e.stopPropagation();removeInternalEvent(ev.id)}}
                            style={{position:'absolute',top:2,right:2,width:16,height:16,background:'rgba(139,92,246,0.2)',border:'none',borderRadius:3,color:'#8b5cf6',cursor:'pointer',fontSize:9,display:'flex',alignItems:'center',justifyContent:'center',padding:0,zIndex:2}}>✕</button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>

      {/* Denna veckas jobb - summering */}
      {(()=>{
        const thisWeekJobs=customers.filter(c=>{
          if(!c.booked_date||c.rejected)return false
          const d=new Date(c.booked_date)
          return d>=currentWeekStart&&d<=weekDays[6]
        })
        if(thisWeekJobs.length===0)return null
        return(
          <div style={{marginTop:16,background:C.surface,borderRadius:12,border:`1px solid ${C.border}`,padding:'16px 20px'}}>
            <h3 style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:12,display:'flex',alignItems:'center',gap:8}}>
              <i className="fas fa-list-ul" style={{color:C.primary}}/> Veckans jobb ({thisWeekJobs.length} st)
            </h3>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {thisWeekJobs.sort((a,b)=>a.booked_date.localeCompare(b.booked_date)).map(c=>(
                <div key={c.id} onClick={()=>openCustomer(c)} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:C.bg,borderRadius:8,cursor:'pointer',border:`1px solid ${C.border}`}}
                  onMouseEnter={e=>(e.currentTarget.style.borderColor=C.primary)}
                  onMouseLeave={e=>(e.currentTarget.style.borderColor=C.border)}>
                  <div style={{width:36,height:36,borderRadius:8,background:`${C.primary}15`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <i className="fas fa-calendar-check" style={{fontSize:14,color:C.primary}}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text}}>{c.name}</div>
                    <div style={{fontSize:11,color:C.textSec,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.address} · {getServices(c).map((s:string)=>svcLabel(s)).join(', ')}</div>
                  </div>
                  <div style={{flexShrink:0,textAlign:'right'}}>
                    <div style={{fontSize:11,color:C.textSec}}>{new Date(c.booked_date).toLocaleDateString('sv-SE',{weekday:'short',day:'numeric',month:'short'})}</div>
                    {c.booked_time&&<div style={{fontSize:11,color:C.primary,display:'flex',alignItems:'center',justifyContent:'flex-end',gap:3}}><i className="fas fa-clock" style={{fontSize:9}}/>{c.booked_time}</div>}
                    {(parseFloat(c.price_excl_vat)||0)>0&&<div style={{fontSize:12,fontWeight:700,color:'#10b981'}}>{fmtCur(parseFloat(c.price_excl_vat))}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
})()}

        {/* ── NY KUND ── */}
        {page==='new-customer'&&<div style={{maxWidth:isMobile?'100%':600}}>
          <div style={{background:'#0a0a0a',padding:isMobile?20:32,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',border:'1px solid #1a1a1a'}}>
            <h2 style={{fontSize:22,fontWeight:600,marginBottom:24,color:C.text}}>Skapa nytt ärende</h2>
            {([['Kundnamn *','name','text'],['Telefon *','phone','tel'],['E-post','email','email'],['Adress *','address','text']] as [string,string,string][]).map(([label,field,type])=>(
              <div key={field} style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:6,color:C.text}}>{label}</label>
                <input type={type} value={(newForm as any)[field]} onChange={e=>setNewForm({...newForm,[field]:e.target.value})} style={inp}/>
              </div>
            ))}
            <div style={{marginBottom:20}}>
              <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:8,color:C.text}}>Tjänster *</label>
              {([['stentvatt','Stentvätt'],['betongtvatt','Betongtvätt'],['altantvatt','Altantvätt'],['asfaltstvatt','Asfaltstvätt']] as [string,string][]).map(([val,lbl])=>(
                <div key={val} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0'}}>
                  <div onClick={()=>{const s=newForm.services.includes(val)?newForm.services.filter(x=>x!==val):[...newForm.services,val];setNewForm({...newForm,services:s})}}
                    style={{width:18,height:18,borderRadius:4,border:`2px solid ${newForm.services.includes(val)?C.primary:C.border}`,background:newForm.services.includes(val)?C.primary:'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}}>
                    {newForm.services.includes(val)&&<span style={{color:'white',fontSize:11,fontWeight:700,lineHeight:1}}>✓</span>}
                  </div>
                  <span style={{fontSize:14,color:C.text,cursor:'pointer'}} onClick={()=>{const s=newForm.services.includes(val)?newForm.services.filter(x=>x!==val):[...newForm.services,val];setNewForm({...newForm,services:s})}}>{lbl}</span>
                  {newForm.services.includes(val)&&<input type="number" placeholder="Kvm" value={newForm.kvm[val]||''} onChange={e=>setNewForm({...newForm,kvm:{...newForm.kvm,[val]:e.target.value}})} style={{...inp,width:110}}/>}
                </div>
              ))}
            </div>
            {newForm.services.includes('stentvatt')&&(
              <div style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:8,color:C.text}}>Sand / Fogsand (Stentvätt)</label>
                {[['ograshammande_fogsand','Ogräshämmande fogsand'],['flexibel_fogsand','Flexibel fogsand'],['stenmjol','Stenmjöl']].map(([val,lbl])=>{
                  const sel=(newForm.service_addons.stentvatt??[]).includes(val)
                  return(
                  <div key={val} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',cursor:'pointer'}} onClick={()=>{
                    const cur=newForm.service_addons.stentvatt??[]
                    const next=sel?cur.filter(x=>x!==val):[...cur,val]
                    setNewForm({...newForm,service_addons:{...newForm.service_addons,stentvatt:next}})
                  }}>
                    <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${sel?C.primary:C.border}`,background:sel?C.primary:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}}>
                      {sel&&<span style={{color:'white',fontSize:11,fontWeight:700,lineHeight:1}}>✓</span>}
                    </div>
                    <span style={{fontSize:14,color:C.text}}>{lbl}</span>
                  </div>
                )})}
              </div>
            )}
            {newForm.services.includes('altantvatt')&&(
              <div style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:8,color:C.text}}>Tillval (Altantvätt)</label>
                {[['saapa','Såpa'],['kiselimpregnering','Kiselimpregnering'],['impregnering','Impregnering'],['olja','Olja']].map(([val,lbl])=>{
                  const selected=(newForm.service_addons.altantvatt??[]).includes(val)
                  return(
                    <div key={val} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',cursor:'pointer'}} onClick={()=>{
                      const cur=newForm.service_addons.altantvatt??[]
                      const next=selected?cur.filter(x=>x!==val):[...cur,val]
                      setNewForm({...newForm,service_addons:{...newForm.service_addons,altantvatt:next}})
                    }}>
                      <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${selected?C.primary:C.border}`,background:selected?C.primary:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}}>
                        {selected&&<span style={{color:'white',fontSize:10,fontWeight:700,lineHeight:1}}>✓</span>}
                      </div>
                      <span style={{fontSize:14,color:C.text}}>{lbl}</span>
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{marginBottom:20}}>
              <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:6,color:C.text}}>Notis</label>
              <textarea value={newForm.note} onChange={e=>setNewForm({...newForm,note:e.target.value})} rows={3} style={{...inp,resize:'vertical' as const}}/>
            </div>
            <div style={{marginBottom:24}}>
              <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:6,color:C.text}}>Offererat pris (exkl. moms)</label>
              <input type="number" value={newForm.price} onChange={e=>setNewForm({...newForm,price:e.target.value})} placeholder="0" style={{...inp,maxWidth:200}}/>
            </div>
            <div style={{display:'flex',gap:12,justifyContent:'flex-end',flexWrap:'wrap' as const}}>
              <button onClick={()=>setPage('dashboard')} style={btn('#64748b')}>Avbryt</button>
              <button onClick={createCustomer} style={btn(C.primary)}>Skapa ärende</button>
            </div>
          </div>
        </div>}

        {/* ── ÅRSUNDERHÅLL ── */}
        {page==='underhall'&&<>
          <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fit,minmax(220px,1fr))',gap:16,marginBottom:24}}>
            <div style={{background:C.surface,padding:'20px 24px',borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',display:'flex',alignItems:'center',gap:16}}>
              <div style={{width:60,height:60,borderRadius:12,background:'rgba(16,185,129,0.15)',display:'flex',alignItems:'center',justifyContent:'center'}}><i className="fas fa-file-signature" style={{fontSize:24,color:'#10b981'}}/></div>
              <div><div style={{fontSize:32,fontWeight:700,color:'#10b981'}}>{uhContracts.length}</div><div style={{fontSize:14,color:C.textSec}}>Signerade avtal</div></div>
            </div>
            <div style={{background:C.surface,padding:'20px 24px',borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',display:'flex',alignItems:'center',gap:16}}>
              <div style={{width:60,height:60,borderRadius:12,background:'rgba(37,99,235,0.1)',display:'flex',alignItems:'center',justifyContent:'center'}}><i className="fas fa-money-bill-wave" style={{fontSize:24,color:'#2563eb'}}/></div>
              <div><div style={{fontSize:28,fontWeight:700,color:'#2563eb'}}>{fmtCur(uhContracts.reduce((s,c)=>s+(parseFloat(c.amount)||0),0))}</div><div style={{fontSize:14,color:C.textSec}}>Total årlig omsättning</div></div>
            </div>
            <div style={{background:C.surface,padding:'20px 24px',borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',display:'flex',alignItems:'center',gap:16}}>
              <div style={{width:60,height:60,borderRadius:12,background:'rgba(245,158,11,0.1)',display:'flex',alignItems:'center',justifyContent:'center'}}><i className="fas fa-calculator" style={{fontSize:24,color:'#f59e0b'}}/></div>
              <div>
                <div style={{fontSize:28,fontWeight:700,color:C.text}}>{(()=>{const w=uhContracts.filter(c=>(parseFloat(c.amount)||0)>0);return w.length?fmtCur(Math.round(w.reduce((s,c)=>s+(parseFloat(c.amount)||0),0)/w.length)):'—'})()}</div>
                <div style={{fontSize:14,color:C.textSec}}>Snitt per avtal</div>
              </div>
            </div>
          </div>
          <div style={{display:'flex',gap:12,marginBottom:24,flexWrap:'wrap' as const}}>
            <button onClick={openUhAdd} style={btn(C.primary)}><i className="fas fa-plus"/> Lägg till avtal</button>
            <button onClick={()=>setUhImportModal(true)} style={btn('#64748b')}><i className="fas fa-user-check"/> Importera från befintlig kund</button>
          </div>
          {uhContracts.length===0
            ?<div style={{textAlign:'center',padding:'60px',color:C.textSec}}><i className="fas fa-file-signature" style={{fontSize:48,opacity:0.2,display:'block',marginBottom:16}}/>Inga avtal ännu</div>
            :<div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(340px,1fr))',gap:16}}>
              {[...uhContracts].sort((a,b)=>Number(!!a.done)-Number(!!b.done)).map(c=>{
                const amt=parseFloat(c.amount)||0
                return(
                  <div key={c.id} onClick={()=>openUhDetail(c.id)} style={{background:c.done?'rgba(16,185,129,0.08)':C.surface,padding:'20px 24px',borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',cursor:'pointer',border:c.done?'2px solid rgba(16,185,129,0.4)':`1px solid ${C.border}`,transition:'all 0.2s',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}
                    onMouseEnter={e=>(e.currentTarget.style.borderColor=c.done?'rgba(16,185,129,0.7)':'#10b981')}
                    onMouseLeave={e=>(e.currentTarget.style.borderColor=c.done?'rgba(16,185,129,0.4)':C.border)}>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <span style={{fontSize:16,fontWeight:600,color:C.text,opacity:c.done?0.7:1}}>{c.name}</span>
                      <span style={{fontSize:13,color:C.textSec,display:'flex',alignItems:'center',gap:6}}><i className="fas fa-map-marker-alt" style={{color:C.primary,width:14}}/>{c.address}</span>
                      {c.phone&&<span style={{fontSize:13,color:C.textSec,display:'flex',alignItems:'center',gap:6}}><i className="fas fa-phone" style={{color:C.primary,width:14}}/>{c.phone}</span>}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                      {c.done&&<span style={{display:'inline-flex',alignItems:'center',gap:6,background:'#dcfce7',color:'#16a34a',fontSize:12,fontWeight:700,padding:'3px 10px',borderRadius:9999,whiteSpace:'nowrap'}}><i className="fas fa-check-circle"/>Genomförd</span>}
                      <span style={{fontSize:18,fontWeight:700,color:'#10b981',whiteSpace:'nowrap',opacity:c.done?0.7:1}}>{amt>0?fmtCur(amt)+'/år':'—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          }
        </>}

        {/* ── STATISTIK ── */}
        {page==='statistik'&&<StatPage customers={customers} allLogs={allLogs} C={C} isMobile={isMobile}/>}
        {page==='mail'&&<MailPage customers={customers} C={C} isMobile={isMobile}/>}

        {/* ── ARBETEN 2025 ── */}
        {page==='arbeten2025'&&<>
          <div style={{overflowX:isMobile?'auto':'visible',marginBottom:16}}>
            <div style={{minWidth:isMobile?620:'unset',background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',borderBottom:`1px solid ${C.border}`}}>
                {([
                  ['fas fa-briefcase',     'Jobb',        String(stats2025.totalJobb),                         '#6366f1'],
                  ['fas fa-ruler-combined','Totalt kvm',  stats2025.totalKvm>0?`${stats2025.totalKvm} kvm`:'—','#06b6d4'],
                  ['fas fa-coins',         'Omsättning',  stats2025.totalOms>0?fmtCur(stats2025.totalOms):'—', '#10b981'],
                  ['fas fa-clock',         'Total tid',   stats2025.totalTid>0?fmtMins(stats2025.totalTid):'—','#f59e0b'],
                  ['fas fa-tachometer-alt','Snitt kr/h',  omsPerTimme>0?fmtCur(omsPerTimme)+'/h':'—',          '#f97316'],
                ] as [string,string,string,string][]).map(([icon,label,val,color],idx,arr)=>(
                  <div key={label} style={{padding:'14px 16px',borderRight:idx<arr.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:34,height:34,borderRadius:9,background:`${color}18`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className={icon} style={{fontSize:14,color}}/></div>
                    <div><div style={{fontSize:16,fontWeight:700,color:C.text,lineHeight:1.15,whiteSpace:'nowrap'}}>{val}</div><div style={{fontSize:11,color:C.textSec,marginTop:1}}>{label}</div></div>
                  </div>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'auto 1fr 1fr 1fr 1fr',fontSize:12}}>
                <div style={{padding:'8px 16px',background:C.bg,borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:11,color:C.textSec,letterSpacing:'0.04em',textTransform:'uppercase' as const,display:'flex',alignItems:'center'}}>Tjänst</div>
                {(['Snitt kr/h','Snitt kr/kvm','Omsättning','KVM'] as string[]).map((h,i,a)=>(
                  <div key={h} style={{padding:'8px 14px',background:C.bg,borderRight:i<a.length-1?`1px solid ${C.border}`:'none',borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:11,color:C.textSec,letterSpacing:'0.04em',textTransform:'uppercase' as const}}>{h}</div>
                ))}
                {([['stentvatt','Stentvätt',C.surface],['altantvatt','Altantvätt',C.bg],['asfaltstvatt','Asfaltstvätt',C.surface],['ovrigt','Övrigt',C.bg]] as [string,string,string][]).map(g=>[
                  <div key={`${g[0]}-n`} style={{padding:'9px 16px',borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:7,background:g[2]}}><div style={{width:8,height:8,borderRadius:'50%',background:svc3Colors[g[0]],flexShrink:0}}/><span style={{fontWeight:600,color:C.text,whiteSpace:'nowrap' as const,fontSize:12}}>{g[1]}</span></div>,
                  <div key={`${g[0]}-r`} style={{padding:'9px 14px',borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,background:g[2],fontWeight:700,color:svcRate(g[0])>0?svc3Colors[g[0]]:C.textSec,fontSize:12}}>{svcRate(g[0])>0?fmtCur(svcRate(g[0]))+'/h':'—'}</div>,
                  <div key={`${g[0]}-k`} style={{padding:'9px 14px',borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,background:g[2],fontWeight:700,color:svcPriceKvm(g[0])>0?svc3Colors[g[0]]:C.textSec,fontSize:12}}>{svcPriceKvm(g[0])>0?fmtCur(svcPriceKvm(g[0]))+'/kvm':'—'}</div>,
                  <div key={`${g[0]}-o`} style={{padding:'9px 14px',borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,background:g[2],color:C.text,fontSize:12}}>{svcOms[g[0]]>0?fmtCur(Math.round(svcOms[g[0]])):'—'}</div>,
                  <div key={`${g[0]}-kv`} style={{padding:'9px 14px',borderBottom:`1px solid ${C.border}`,background:g[2],color:C.textSec,fontSize:12}}>{svcKvm[g[0]]>0?`${svcKvm[g[0]]} kvm`:'—'}</div>,
                ])}
              </div>
              <div style={{padding:'10px 16px',borderTop:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap' as const}}>
                <span style={{fontSize:11,fontWeight:700,color:C.textSec,textTransform:'uppercase' as const,letterSpacing:'0.05em',whiteSpace:'nowrap' as const}}><i className="fas fa-ruler-combined" style={{marginRight:4,color:'#8b5cf6'}}/>KVM per tjänst:</span>
                {Object.entries(stats2025.kvmPerSvc).map(([svc,kvm])=>(
                  <span key={svc} style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',background:C.bg,borderRadius:9999,border:`1px solid ${C.border}`,fontSize:12}}>
                    <span style={{color:C.textSec}}>{SERVICES_2025.find(s=>s.key===svc)?.label||svc}</span>
                    <span style={{fontWeight:700,color:C.text}}>{kvm} kvm</span>
                  </span>
                ))}
                {prisPerKvm>0&&(
                  <span style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:6,padding:'4px 12px',background:`${svc3Colors.ovrigt}12`,borderRadius:9999,border:`1px solid ${svc3Colors.ovrigt}40`,fontSize:12,whiteSpace:'nowrap' as const}}>
                    <i className="fas fa-ruler-combined" style={{color:svc3Colors.ovrigt,fontSize:11}}/>
                    <span style={{color:C.textSec}}>Snitt intäkt/kvm totalt:</span>
                    <span style={{fontWeight:700,color:svc3Colors.ovrigt}}>{fmtCur(prisPerKvm)}/kvm</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div id="job2025-form" style={{background:C.surface,padding:isMobile?16:28,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',marginBottom:28,border:jobs2025EditId?`2px solid ${C.primary}`:'2px solid transparent'}}>
            <h2 style={{fontSize:17,fontWeight:600,marginBottom:18,color:C.text,display:'flex',alignItems:'center',gap:8}}>
              <i className={jobs2025EditId?'fas fa-edit':'fas fa-plus-circle'} style={{color:C.primary}}/>{jobs2025EditId?'Redigera jobb':'Lägg till jobb'}
            </h2>
            <div style={{marginBottom:18}}>
              <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:5,color:C.text}}>Kundnamn *</label>
              <input placeholder="Kundens namn" value={jobs2025Form.name} onChange={e=>setJobs2025Form({...jobs2025Form,name:e.target.value})} style={{...inp,maxWidth:isMobile?'100%':400}}/>
            </div>
            <div style={{marginBottom:10}}>
              <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:10,color:C.text}}>Välj tjänster *</label>
              <div style={{display:'flex',flexWrap:'wrap' as const,gap:8,marginBottom:16}}>
                {SERVICES_2025.map(s=>{
                  const active=jobs2025Form.selectedServices.includes(s.key)
                  return(
                    <button key={s.key} type="button" onClick={()=>toggleSvc2025(s.key)} style={{padding:'7px 14px',borderRadius:9999,fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',border:`2px solid ${active?C.primary:C.border}`,background:active?C.primary:'transparent',color:active?'white':C.text,transition:'all 0.15s',minHeight:38}}>{s.label}</button>
                  )
                })}
              </div>
              {jobs2025Form.selectedServices.length>0&&(
                <div style={{display:'flex',flexDirection:'column',gap:12}}>
                  {jobs2025Form.selectedServices.map(svcKey=>{
                    const svcName=SERVICES_2025.find(s=>s.key===svcKey)?.label||svcKey
                    const d=jobs2025Form.serviceData[svcKey]||{kvm:'',hours:'',mins:'',pris:''}
                    return(
                      <div key={svcKey} style={{background:C.bg,borderRadius:10,padding:'14px 16px',border:`1px solid ${C.border}`}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.primary,marginBottom:10,display:'flex',alignItems:'center',gap:6}}><i className="fas fa-tools" style={{fontSize:11}}/>{svcName}</div>
                        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'1fr 80px 80px 1fr',gap:10,alignItems:'end'}}>
                          <div><label style={{display:'block',fontSize:12,fontWeight:500,marginBottom:4,color:C.textSec}}>KVM *</label><input type="number" min={0} step="0.1" placeholder="0" value={d.kvm} onChange={e=>setSvcField(svcKey,'kvm',e.target.value)} style={inp}/></div>
                          <div><label style={{display:'block',fontSize:12,fontWeight:500,marginBottom:4,color:C.textSec}}>Tim *</label><input type="number" min={0} max={99} placeholder="0" value={d.hours} onChange={e=>setSvcField(svcKey,'hours',e.target.value)} style={inp}/></div>
                          <div><label style={{display:'block',fontSize:12,fontWeight:500,marginBottom:4,color:C.textSec}}>Min *</label><input type="number" min={0} max={59} placeholder="0" value={d.mins} onChange={e=>setSvcField(svcKey,'mins',e.target.value)} style={inp}/></div>
                          <div><label style={{display:'block',fontSize:12,fontWeight:500,marginBottom:4,color:C.textSec}}>Pris (kr) *</label><input type="number" min={0} placeholder="0" value={d.pris} onChange={e=>setSvcField(svcKey,'pris',e.target.value)} style={inp}/></div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:12,marginTop:18,flexWrap:'wrap' as const}}>
              <button onClick={saveJob2025} disabled={jobs2025Saving} style={{...btn(C.primary),opacity:jobs2025Saving?0.6:1}}><i className={jobs2025EditId?'fas fa-save':'fas fa-plus'}/>{jobs2025Saving?'Sparar…':jobs2025EditId?' Spara ändringar':' Lägg till'}</button>
              {jobs2025EditId&&<button onClick={()=>{setJobs2025Form(EMPTY_JOB_FORM);setJobs2025EditId(null);setJobs2025Msg('')}} style={btn('#64748b')}><i className="fas fa-times"/> Avbryt</button>}
              {jobs2025Msg&&<span style={{fontSize:13,color:jobs2025Msg.startsWith('✓')?'#10b981':'#ef4444',fontWeight:500}}>{jobs2025Msg}</span>}
            </div>
          </div>

          <div style={{background:C.surface,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',overflow:'hidden'}}>
            <div style={{padding:'16px 24px',borderBottom:`1px solid ${C.border}`}}>
              <h2 style={{fontSize:16,fontWeight:600,color:C.text}}>Jobb ({stats2025.totalJobb})</h2>
            </div>
            {jobs2025.length===0
              ?<div style={{textAlign:'center',padding:'48px',color:C.textSec}}><i className="fas fa-clipboard-list" style={{fontSize:36,opacity:0.2,display:'block',marginBottom:12}}/>Inga jobb tillagda ännu</div>
              :<div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
                  <thead>
                    <tr style={{background:C.bg}}>
                      {['Namn','Tjänster','KVM','Tid','Pris',''].map((h,i)=>(
                        <th key={i} style={{padding:'10px 16px',textAlign:i===5?'right':'left',fontSize:12,fontWeight:600,color:C.textSec,letterSpacing:'0.05em',textTransform:'uppercase' as const,whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jobs2025.map((j,rowIdx)=>{
                      const items=getJob2025Items(j)
                      const totKvm=items.reduce((s,i)=>s+(i.kvm||0),0)
                      const totTid=items.reduce((s,i)=>s+(i.tid||0),0)
                      const totPris=items.reduce((s,i)=>s+(i.pris||0),0)
                      const isEditing=jobs2025EditId===j.id
                      return(
                        <tr key={j.id} style={{borderTop:`1px solid ${C.border}`,background:isEditing?`${C.primary}08`:rowIdx%2===0?C.surface:C.bg}}>
                          <td style={{padding:'12px 16px',fontWeight:600,color:C.text,verticalAlign:'top'}}>{j.name}</td>
                          <td style={{padding:'12px 16px',verticalAlign:'top'}}>
                            <div style={{display:'flex',flexDirection:'column',gap:5}}>
                              {items.map((it,ii)=>(
                                <div key={ii} style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap' as const}}>
                                  <span style={{padding:'2px 8px',borderRadius:9999,fontSize:11,fontWeight:600,background:`${C.primary}18`,color:C.primary,whiteSpace:'nowrap'}}>{SERVICES_2025.find(s=>s.key===it.service)?.label||it.service}</span>
                                  <span style={{fontSize:12,color:C.textSec}}>{it.kvm} kvm · {fmtMins(it.tid||0)} · <span style={{color:'#10b981',fontWeight:600}}>{fmtCur(it.pris||0)}</span></span>
                                </div>
                              ))}
                            </div>
                          </td>
                          <td style={{padding:'12px 16px',color:C.text,verticalAlign:'top',whiteSpace:'nowrap'}}>{totKvm} kvm</td>
                          <td style={{padding:'12px 16px',color:C.text,verticalAlign:'top',whiteSpace:'nowrap'}}>{fmtMins(totTid)}</td>
                          <td style={{padding:'12px 16px',fontWeight:700,color:'#10b981',verticalAlign:'top',whiteSpace:'nowrap'}}>{fmtCur(Math.round(totPris))}</td>
                          <td style={{padding:'12px 16px',verticalAlign:'top',textAlign:'right',whiteSpace:'nowrap'}}>
                            <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                              <button onClick={()=>openEditJob2025(j)} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'5px 10px',background:isEditing?C.primary:'#64748b',color:'white',border:'none',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}><i className="fas fa-edit"/> Redigera</button>
                              <button onClick={()=>deleteJob2025(j.id)} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'5px 10px',background:'#ef4444',color:'white',border:'none',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}><i className="fas fa-trash"/> Ta bort</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            }
          </div>
        </>}
      </main>

      {showAI&&(
        <div style={{width:isMobile?'100%':400,flexShrink:0,height:'100vh',borderLeft:isMobile?'none':`1px solid ${C.border}`,...(isMobile?{position:'fixed' as const,inset:0,zIndex:1050}:{})}}>
          <AIPanel onClose={()=>setShowAI(false)} onAction={handleAIAction} dark={dark} C={C as any}/>
        </div>
      )}

      {/* ── KUND-MODAL ── */}
      {showModal&&current&&(
        <div style={modalOverlay} onClick={e=>{if(e.target===e.currentTarget){setShowModal(false);setCurrent(null)}}}>
          <div style={modalBox(900)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:10}}>
              <div>
                <h2 style={{fontSize:20,fontWeight:600,color:C.text,margin:0}}>{current.name}</h2>
                {current.booked_date&&<div style={{fontSize:12,color:C.primary,marginTop:2}}><i className="fas fa-calendar-check" style={{marginRight:4}}/>Bokad: {current.booked_date}</div>}
              </div>
              <button onClick={()=>{setShowModal(false);setCurrent(null)}} style={{width:36,height:36,border:'none',background:C.bg,borderRadius:8,cursor:'pointer',fontSize:18,color:C.text,display:'flex',alignItems:'center',justifyContent:'center'}}><i className="fas fa-times"/></button>
            </div>
            <div style={{padding:isMobile?16:24}}>
              {!editMode
                ?<div style={{marginBottom:24}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                    <h3 style={{fontSize:16,fontWeight:600,color:C.text}}>Kunduppgifter</h3>
                    <button onClick={()=>setEditMode(true)} style={btn('#64748b')}><i className="fas fa-edit"/> Redigera</button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
                    {([
                      ['fas fa-phone',current.phone],
                      ['fas fa-envelope',current.email||'Ingen e-post'],
                      ['fas fa-map-marker-alt',current.address],
                      ['fas fa-tools',getServices(current).map((s:string)=>`${svcLabel(s)} (${getKvm(current)[s]||0}kvm)`).join(', ')],
                      ['fas fa-tag',(parseFloat(current.price_excl_vat)||0)>0?fmtCur(parseFloat(current.price_excl_vat)):'Inget pris satt'],
                    ] as [string,string][]).map(([icon,val])=>(
                      <div key={icon} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',background:C.bg,borderRadius:8}}>
                        <i className={icon} style={{color:C.primary,width:18}}/><span style={{fontSize:14,color:C.text}}>{val}</span>
                      </div>
                    ))}
                  </div>
                  {current.note&&<div style={{marginTop:12,padding:'10px 14px',background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.2)',borderLeft:'3px solid #6366f1',borderRadius:8,fontSize:14,color:C.text}}>📝 {current.note}</div>}
                  {current.rejected&&<div style={{marginTop:12,padding:'10px 14px',background:'rgba(239,68,68,0.1)',borderLeft:'3px solid #ef4444',borderRadius:8,fontSize:14,color:'#ef4444',fontWeight:600}}><i className="fas fa-times-circle"/> Offert nekad</div>}
                </div>
                :<EditForm current={current} C={C} inp={inp} btn={btn} onSave={async(data:any)=>{await updateCust(current.id,data);setEditMode(false)}} onCancel={()=>setEditMode(false)}/>
              }

              {/* ÄRENDEPROCESS */}
              <div style={{marginBottom:24}}>
                <h3 style={{fontSize:16,fontWeight:600,marginBottom:16,color:C.text}}>Ärendeprocess</h3>
                {getServices(current).map((service:string)=>{
                  const steps=getSteps(service,current.include_fogsand),cur2=getProgress(current)[service]||0
                  const offIdx=steps.findIndex(s=>s.label==='Offert'),onOffer=cur2===offIdx&&offIdx>-1
                  return(
                    <div key={service} style={{background:C.bg,borderRadius:12,border:`2px solid ${C.border}`,padding:isMobile?14:20,marginBottom:12}}>
                      <h4 style={{fontSize:14,fontWeight:600,color:C.primary,marginBottom:16,display:'flex',alignItems:'center',gap:8}}><i className="fas fa-tools"/>{svcLabel(service)} — {getKvm(current)[service]||0} kvm</h4>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,overflowX:'auto',paddingBottom:4}}>
                        {steps.map((step,i)=>{
                          const done=i<cur2,active=i===cur2
                          return(
                            <div key={i} style={{flex:1,textAlign:'center',position:'relative',minWidth:isMobile?44:56}}>
                              {i<steps.length-1&&<div style={{position:'absolute',top:20,left:'50%',right:'-50%',height:2,background:done?'#10b981':'#e2e8f0',zIndex:0}}/>}
                              <div onClick={()=>!onOffer&&moveStep(service,i)} style={{position:'relative',zIndex:1,width:isMobile?34:40,height:isMobile?34:40,borderRadius:'50%',background:done?'#10b981':active?C.primary:'#e2e8f0',color:done||active?'white':'#64748b',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 6px',fontWeight:600,fontSize:isMobile?12:14,cursor:onOffer?'default':'pointer',transition:'all 0.2s',boxShadow:active?`0 0 0 4px ${C.primary}33`:'none'}}>
                                {done?<i className="fas fa-check"/>:step.id}
                              </div>
                              <div style={{fontSize:isMobile?9:11,color:active?C.text:C.textSec,fontWeight:active?600:400,position:'relative',zIndex:1}}>{step.label}</div>
                            </div>
                          )
                        })}
                      </div>
                      {onOffer
                        ?<div style={{background:'#fffbeb',border:'1px solid #fbbf24',borderRadius:8,padding:12,display:'flex',flexDirection:'column',gap:8}}>
                          <span style={{fontSize:13,color:'#92400e',fontWeight:500}}><i className="fas fa-file-invoice"/> Väntar på kundens svar</span>
                          <div style={{display:'flex',gap:8,flexWrap:'wrap' as const}}>
                            <button onClick={()=>acceptOffer(service)} style={btn('#10b981')}><i className="fas fa-check"/> Accepterad</button>
                            <button onClick={rejectOffer} style={btn('#ef4444')}><i className="fas fa-times"/> Nekad</button>
                          </div>
                        </div>
                        :<div style={{display:'flex',gap:8,flexWrap:'wrap' as const}}>
                          {cur2>0&&<button onClick={()=>moveStep(service,cur2-1)} style={btn('#64748b')}><i className="fas fa-arrow-left"/> Tillbaka</button>}
                          {cur2<steps.length-1&&<button onClick={()=>moveStep(service,cur2+1)} style={btn(C.primary)}>Nästa <i className="fas fa-arrow-right"/></button>}
                        </div>
                      }
                      {getSteps(service,current.include_fogsand)[getProgress(current)[service]||0]?.label==='Bokat'&&(
                        <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' as const}}>
                          <label style={{fontSize:12,color:C.textSec,fontWeight:500}}>📅 Datum för jobbet:</label>
                          <input type="date" value={current.booked_date||''} onChange={async e=>{await updateCust(current.id,{booked_date:e.target.value})}} style={{...inp,maxWidth:180,fontSize:13}}/>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* LIVE TIMER */}
              <div style={{marginBottom:24,background:C.bg,borderRadius:12,padding:isMobile?14:20,border:`2px solid ${timerRunning&&timerCustomerId===current.id?'#ef4444':C.border}`}}>
                <h3 style={{fontSize:16,fontWeight:600,marginBottom:16,color:C.text,display:'flex',alignItems:'center',gap:8}}>
                  <i className="fas fa-stopwatch" style={{color:'#ef4444'}}/>
                  Timer
                  {timerRunning&&timerCustomerId===current.id&&(
                    <span style={{marginLeft:'auto',fontSize:22,fontWeight:800,color:'#ef4444',fontVariantNumeric:'tabular-nums'}}>{fmtTimer(timerSecs)}</span>
                  )}
                </h3>
                {timerRunning&&timerCustomerId!==current.id&&(
                  <div style={{padding:'10px 14px',background:'rgba(59,130,246,0.08)',border:'1px solid rgba(59,130,246,0.2)',borderRadius:8,fontSize:13,color:C.primary,marginBottom:12}}>
                    <i className="fas fa-info-circle" style={{marginRight:6}}/>Timer körs för en annan kund: <strong>{timerCustomerName}</strong>
                  </div>
                )}
                {(!timerRunning||(timerRunning&&timerCustomerId===current.id))&&(
                  <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap' as const}}>
                    <select value={timerSelectMoment} onChange={e=>setTimerSelectMoment(e.target.value)} style={{...inp,flex:'2 1 160px',minWidth:160,cursor:'pointer'}} disabled={timerRunning&&timerCustomerId===current.id}>
                      <option value="">Välj moment...</option>
                      {buildMoments(current).map(m=><option key={m} value={m}>{m}</option>)}
                    </select>
                    {!timerRunning&&(
                      <button onClick={()=>{if(!timerSelectMoment)return alert('Välj ett moment');startTimer(current,timerSelectMoment)}} style={btn('#ef4444')}>
                        <i className="fas fa-play"/> Starta timer
                      </button>
                    )}
                    {timerRunning&&timerCustomerId===current.id&&(
                      <button onClick={stopTimer} style={btn('#10b981')}>
                        <i className="fas fa-stop"/> Stoppa &amp; logga
                      </button>
                    )}
                  </div>
                )}
                {timerRunning&&timerCustomerId===current.id&&(
                  <div style={{marginTop:10,fontSize:12,color:C.textSec}}>
                    Moment: <strong>{timerMoment}</strong> · Starttid: {timerStartTime?new Date(timerStartTime).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}):''}
                  </div>
                )}
              </div>

              {/* LOGGA TID */}
              <div style={{marginBottom:24,background:C.bg,borderRadius:12,padding:isMobile?14:20,border:`1px solid ${C.border}`}}>
                <h3 style={{fontSize:16,fontWeight:600,marginBottom:16,color:C.text,display:'flex',alignItems:'center',gap:8}}><i className="fas fa-clock" style={{color:C.primary}}/> Logga tid manuellt</h3>
                <div style={{display:'flex',gap:10,flexWrap:'wrap' as const,marginBottom:16,alignItems:'center'}}>
                  <select value={timeForm.moment} onChange={e=>setTimeForm({...timeForm,moment:e.target.value})} style={{...inp,flex:'2 1 160px',minWidth:160,cursor:'pointer'}}>
                    <option value="">Välj moment...</option>
                    {buildMoments(current).map(m=><option key={m} value={m}>{m}</option>)}
                  </select>
                  <input type="number" min={0} max={23} placeholder="Tim" value={timeForm.hours} onChange={e=>setTimeForm({...timeForm,hours:e.target.value})} style={{...inp,flex:'1 1 70px',minWidth:70}}/>
                  <input type="number" min={0} max={59} placeholder="Min" value={timeForm.mins} onChange={e=>setTimeForm({...timeForm,mins:e.target.value})} style={{...inp,flex:'1 1 70px',minWidth:70}}/>
                  <input type="date" value={timeForm.date} onChange={e=>setTimeForm({...timeForm,date:e.target.value})} style={{...inp,flex:'1 1 140px',minWidth:140}}/>
                  <button onClick={logTime} style={{...btn(C.primary),flexShrink:0,whiteSpace:'nowrap'}}><i className="fas fa-clock"/> Logga tid</button>
                </div>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(4,1fr)',gap:12}}>
                  {([
                    ['Total tid',   totalTid,  C.primary],
                    ['Momenttid',   momentTid, '#10b981'],
                    ['Admintid',    adminTid,  '#f59e0b'],
                    ['Körtid',      korTid,    '#8b5cf6'],
                  ] as [string,number,string][]).map(([label,mins,color])=>(
                    <div key={label} style={{background:C.surface,borderRadius:8,padding:'14px 16px',border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:12,color:C.textSec,marginBottom:4}}>{label}:</div>
                      <div style={{fontSize:isMobile?16:20,fontWeight:700,color}}>{fmtMins(mins)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* OFFERT & EKONOMI */}
              {customerPrice>0&&(
                <div style={{marginBottom:24,background:C.bg,borderRadius:12,padding:isMobile?14:20,border:`1px solid ${C.border}`}}>
                  <h3 style={{fontSize:16,fontWeight:600,marginBottom:16,color:C.text,display:'flex',alignItems:'center',gap:8}}><i className="fas fa-file-invoice-dollar" style={{color:'#10b981'}}/> Offert &amp; Ekonomi</h3>
                  {/* PDF-uppladdning */}
                  <div style={{marginBottom:16,padding:'12px 16px',background:C.surface,borderRadius:10,border:`1px dashed ${C.border}`}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                      <i className="fas fa-file-pdf" style={{color:'#ef4444'}}/> Ladda upp offert-PDF
                    </div>
                    <div style={{fontSize:12,color:C.textSec,marginBottom:10}}>AI läser av PDF:en och fyller i material och priser automatiskt</div>
                    <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' as const}}>
                      <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',background:C.primary,color:'white',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer'}}>
                        <i className="fas fa-file-pdf"/> Välj PDF
                        <input type="file" accept=".pdf,application/pdf" style={{display:'none'}} onChange={async e=>{
                          const file=e.target.files?.[0]
                          if(!file)return
                          setMaterialMsg('⏳ Läser PDF...')
                          const reader=new FileReader()
                          reader.onload=async ev=>{
                            const base64=ev.target?.result as string
                            const base64Data=base64.split(',')[1]
                            try{
                              const res=await fetch('/api/ai',{
                                method:'POST',
                                headers:{'Content-Type':'application/json'},
                                body:JSON.stringify({action:'pdf',pdfBase64:base64Data,customerId:current?.id??''})
                              })
                              const data=await res.json()
                              if(data.error){
                                setMaterialMsg(`❌ ${data.error}`)
                              } else {
                                // Sätt material-poster
                                const parsedItems=data.material_items?.length>0
                                  ?data.material_items.map((i:any)=>({name:String(i.name||''),qty:String(i.qty||1),unit_price:String(i.unit_price||0)}))
                                  :[]
                                if(parsedItems.length>0) setMaterialItems(parsedItems)
                                // Spara PDF + pris + material på kunden
                                if(current?.id){
                                  const {updateDoc,doc:fsDoc}=await import('firebase/firestore')
                                  const {db:fsDb}=await import('@/lib/firebase')
                                  const updateData:any={
                                    pdf_name: file.name,
                                    pdf_base64: base64Data,
                                    pdf_uploaded_at: new Date().toISOString(),
                                  }
                                  if(data.total_price_excl_vat&&data.total_price_excl_vat>0){
                                    updateData.price_excl_vat=String(data.total_price_excl_vat)
                                  }
                                  // Spara material direkt
                                  if(parsedItems.length>0){
                                    updateData.material_items=parsedItems.map((i:any)=>({
                                      name:i.name,qty:parseFloat(i.qty)||1,unit_price:parseFloat(i.unit_price)||0
                                    }))
                                  }
                                  await updateDoc(fsDoc(fsDb,'customers',current.id),updateData)
                                  setCurrent((p:any)=>({
                                    ...p,
                                    pdf_name:file.name,
                                    pdf_base64:base64Data,
                                    pdf_uploaded_at:updateData.pdf_uploaded_at,
                                    ...(updateData.price_excl_vat?{price_excl_vat:updateData.price_excl_vat}:{}),
                                    ...(parsedItems.length>0?{material_items:updateData.material_items}:{})
                                  }))
                                  const priceStr=data.total_price_excl_vat>0?` · pris ${data.total_price_excl_vat.toLocaleString('sv')} kr`:''
                                  setMaterialMsg(`✓ PDF sparad · ${parsedItems.length} material${priceStr}`)
                                }
                              }
                            }catch(err:any){
                              setMaterialMsg(`❌ Fel: ${err.message}`)
                            }
                          }
                          reader.readAsDataURL(file)
                          e.target.value=''
                        }}/>
                      </label>
                      <span style={{fontSize:11,color:C.textSec}}>PDF läses av — fyller in material, sätter pris och sparas på kunden</span>
                    </div>
                    {/* Sparad PDF-länk */}
                    {current?.pdf_name&&(
                      <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:`${C.primary}10`,border:`1px solid ${C.primary}30`,borderRadius:8}}>
                        <i className="fas fa-file-pdf" style={{color:'#ef4444',fontSize:14}}/>
                        <span style={{fontSize:12,color:C.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{current.pdf_name}</span>
                        <button onClick={()=>(()=>{const w=window.open('','_blank');w&&w.document.write('<html><body style="margin:0"><iframe src="data:application/pdf;base64,'+current.pdf_base64+'" style="width:100%;height:100vh;border:none"></iframe></body></html>');w&&w.document.close()})()} style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 10px',color:C.primary,fontSize:11,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                          <i className="fas fa-eye"/> Öppna
                        </button>
                        <button onClick={async()=>{
                          if(!confirm('Ta bort offerten?'))return
                          const {updateDoc,doc:fsDoc,deleteField}=await import('firebase/firestore')
                          const {db:fsDb}=await import('@/lib/firebase')
                          await updateDoc(fsDoc(fsDb,'customers',current.id),{pdf_name:deleteField(),pdf_base64:deleteField(),pdf_uploaded_at:deleteField()})
                          setCurrent((p:any)=>{const n={...p};delete n.pdf_name;delete n.pdf_base64;delete n.pdf_uploaded_at;return n})
                        }} style={{background:'none',border:`1px solid rgba(239,68,68,0.3)`,borderRadius:6,padding:'3px 8px',color:'#ef4444',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                          <i className="fas fa-times"/>
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:12,marginBottom:20}}>
                    {([
                      ['Offererat pris',     fmtCur(customerPrice),                '#3b82f6'],
                      ['Materialkostnad',    fmtCur(materialTotal),                '#f59e0b'],
                      ['Vinst',              fmtCur(materialProfit),               materialProfit>=0?'#10b981':'#ef4444'],
                      ['Vinstmarginal',      `${materialMargin}%`,                 materialMargin>=50?'#10b981':materialMargin>=25?'#f59e0b':'#ef4444'],
                    ] as [string,string,string][]).map(([label,val,color])=>(
                      <div key={label} style={{background:C.surface,borderRadius:8,padding:'14px 16px',border:`1px solid ${C.border}`}}>
                        <div style={{fontSize:12,color:C.textSec,marginBottom:4}}>{label}</div>
                        <div style={{fontSize:isMobile?15:18,fontWeight:700,color}}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{marginBottom:12}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                      <span style={{fontSize:14,fontWeight:600,color:C.text}}>Material</span>
                      <button onClick={()=>setMaterialItems([...materialItems,{name:'',qty:'',unit_price:''}])} style={{...btn(C.bg,C.text),padding:'5px 10px',fontSize:12,border:`1px solid ${C.border}`}}><i className="fas fa-plus"/> Lägg till rad</button>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {materialItems.map((item,idx)=>(
                        <div key={idx} style={{display:'grid',gridTemplateColumns:'1fr 80px 100px 36px',gap:6,alignItems:'center'}}>
                          <input placeholder="Materialnamn" value={item.name} onChange={e=>{const n=[...materialItems];n[idx]={...n[idx],name:e.target.value};setMaterialItems(n)}} style={{...inp,fontSize:13,padding:'7px 10px'}}/>
                          <input type="number" placeholder="Antal" value={item.qty} onChange={e=>{const n=[...materialItems];n[idx]={...n[idx],qty:e.target.value};setMaterialItems(n)}} style={{...inp,fontSize:13,padding:'7px 10px'}}/>
                          <input type="number" placeholder="À-pris" value={item.unit_price} onChange={e=>{const n=[...materialItems];n[idx]={...n[idx],unit_price:e.target.value};setMaterialItems(n)}} style={{...inp,fontSize:13,padding:'7px 10px'}}/>
                          <button onClick={()=>setMaterialItems(materialItems.filter((_,i)=>i!==idx))} style={{width:32,height:32,background:'transparent',border:`1px solid rgba(239,68,68,0.4)`,borderRadius:6,color:'#ef4444',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flexShrink:0}}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Totals row */}
                  {materialItems.some(i=>i.name.trim())&&(
                    <div style={{background:C.surface,borderRadius:8,padding:'10px 14px',border:`1px solid ${C.border}`,marginBottom:12}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.textSec,marginBottom:6}}>Inköpslista</div>
                      <div style={{display:'flex',flexDirection:'column',gap:3}}>
                        {materialItems.filter(i=>i.name.trim()).map((item,idx)=>{
                          const total=(parseFloat(item.qty)||0)*(parseFloat(item.unit_price)||0)
                          return(
                            <div key={idx} style={{display:'flex',justifyContent:'space-between',fontSize:13,color:C.text}}>
                              <span>{item.name}</span>
                              <span style={{color:C.textSec}}>{item.qty||0} st × {fmtCur(parseFloat(item.unit_price)||0)} = <strong>{fmtCur(total)}</strong></span>
                            </div>
                          )
                        })}
                        <div style={{borderTop:`1px solid ${C.border}`,marginTop:6,paddingTop:6,display:'flex',justifyContent:'space-between',fontWeight:700,fontSize:14}}>
                          <span>Total materialkostnad</span>
                          <span style={{color:'#f59e0b'}}>{fmtCur(materialTotal)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <button onClick={saveMaterialItems} disabled={materialSaving} style={{...btn(C.primary),opacity:materialSaving?0.6:1}}><i className="fas fa-save"/> Spara material</button>
                    {materialMsg&&<span style={{fontSize:13,color:materialMsg.startsWith('✓')?'#10b981':'#ef4444',fontWeight:500}}>{materialMsg}</span>}
                  </div>
                </div>
              )}

              {/* AKTIVITETSLOGG */}
              <div style={{marginBottom:24}}>
                <h3 style={{fontSize:16,fontWeight:600,marginBottom:16,color:C.text}}>Aktivitetslogg</h3>
                <div style={{marginBottom:12,display:'flex',gap:8}}>
                  <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Skriv en kommentar..." rows={2} style={{...inp,flex:1,resize:'vertical' as const}}/>
                  <button onClick={addComment} style={btn(C.primary)}><i className="fas fa-comment"/> Lägg till</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {logs.length===0
                    ?<div style={{textAlign:'center',padding:20,color:C.textSec}}>Ingen aktivitet ännu</div>
                    :logs.map(log=>{
                      const isEditing=editLogId===log.id
                      const accentColor=log.log_type==='comment'?C.primary:log.log_type==='status_change'?'#10b981':'#6366f1'
                      return(
                        <div key={log.id} style={{padding:'10px 14px',background:`${accentColor}08`,borderRadius:8,border:`1px solid ${accentColor}25`,borderLeft:`3px solid ${accentColor}`}}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,gap:8}}>
                            <span style={{fontSize:12,fontWeight:500,color:C.textSec}}>
                              <i className={log.log_type==='comment'?'fas fa-comment':log.log_type==='status_change'?'fas fa-sync':'fas fa-clock'}/>
                              {' '}{log.log_type==='comment'?'Kommentar':log.log_type==='status_change'?'Statusändring':'Tidslogg'}
                              {log.log_type==='time_log'&&log.date&&<span style={{marginLeft:6,color:C.textSec}}>· {log.date}</span>}
                            </span>
                            <span style={{fontSize:11,color:C.textSec,flexShrink:0}}>{fmtDate(log.timestamp)}</span>
                          </div>
                          {isEditing?(
                            log.log_type==='time_log'?(
                              <div style={{display:'flex',gap:8,flexWrap:'wrap' as const,alignItems:'flex-end',marginTop:8}}>
                                <div style={{flex:'2 1 140px',minWidth:140}}>
                                  <label style={{display:'block',fontSize:11,color:C.textSec,marginBottom:3}}>Moment</label>
                                  <select value={editLogForm.moment} onChange={e=>setEditLogForm({...editLogForm,moment:e.target.value})} style={{...inp,fontSize:12,padding:'6px 8px',cursor:'pointer'}}>
                                    <option value="">Välj moment...</option>
                                    {buildMoments(current).map(m=><option key={m} value={m}>{m}</option>)}
                                  </select>
                                </div>
                                <div style={{flex:'1 1 62px',minWidth:62}}><label style={{display:'block',fontSize:11,color:C.textSec,marginBottom:3}}>Tim</label><input type="number" min={0} max={23} value={editLogForm.hours} onChange={e=>setEditLogForm({...editLogForm,hours:e.target.value})} style={{...inp,fontSize:12,padding:'6px 8px'}}/></div>
                                <div style={{flex:'1 1 62px',minWidth:62}}><label style={{display:'block',fontSize:11,color:C.textSec,marginBottom:3}}>Min</label><input type="number" min={0} max={59} value={editLogForm.mins} onChange={e=>setEditLogForm({...editLogForm,mins:e.target.value})} style={{...inp,fontSize:12,padding:'6px 8px'}}/></div>
                                <div style={{flex:'1 1 130px',minWidth:130}}><label style={{display:'block',fontSize:11,color:C.textSec,marginBottom:3}}>Datum</label><input type="date" value={editLogForm.date} onChange={e=>setEditLogForm({...editLogForm,date:e.target.value})} style={{...inp,fontSize:12,padding:'6px 8px'}}/></div>
                                <div style={{display:'flex',gap:6,alignSelf:'flex-end'}}>
                                  <button onClick={saveEditLog} style={{...btn('#10b981'),padding:'7px 12px',fontSize:12}}><i className="fas fa-save"/> Spara</button>
                                  <button onClick={()=>{setEditLogId(null);setEditLogForm({})}} style={{...btn('#64748b'),padding:'7px 10px',fontSize:12}}><i className="fas fa-times"/></button>
                                </div>
                              </div>
                            ):(
                              <div style={{display:'flex',gap:8,alignItems:'flex-start',marginTop:8}}>
                                <textarea value={editLogForm.content} onChange={e=>setEditLogForm({...editLogForm,content:e.target.value})} rows={2} style={{...inp,flex:1,resize:'vertical' as const,fontSize:13,padding:'6px 10px'}}/>
                                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                                  <button onClick={saveEditLog} style={{...btn('#10b981'),padding:'7px 10px',fontSize:12}}><i className="fas fa-save"/></button>
                                  <button onClick={()=>{setEditLogId(null);setEditLogForm({})}} style={{...btn('#64748b'),padding:'7px 10px',fontSize:12}}><i className="fas fa-times"/></button>
                                </div>
                              </div>
                            )
                          ):(
                            <div style={{fontSize:13,color:C.text}}>{log.content}</div>
                          )}
                          {!isEditing&&(
                            <div style={{display:'flex',justifyContent:'flex-end',gap:6,marginTop:8}}>
                              {(log.log_type==='time_log'||log.log_type==='comment')&&(
                                <button onClick={()=>startEditLog(log)} style={{padding:'3px 9px',background:'transparent',border:`1px solid ${C.border}`,borderRadius:6,fontSize:11,color:C.textSec,cursor:'pointer',fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:4,minHeight:26}}><i className="fas fa-edit"/>Redigera</button>
                              )}
                              <button onClick={()=>deleteLog(log.id)} style={{padding:'3px 9px',background:'transparent',border:'1px solid rgba(239,68,68,0.35)',borderRadius:6,fontSize:11,color:'#ef4444',cursor:'pointer',fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:4,minHeight:26}}><i className="fas fa-trash"/>Ta bort</button>
                            </div>
                          )}
                        </div>
                      )
                    })
                  }
                </div>
              </div>
              <div style={{paddingTop:16,borderTop:`1px solid ${C.border}`}}>
                <button onClick={deleteCust} style={btn('#ef4444')}><i className="fas fa-trash"/> Ta bort ärende</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KALENDER: Intern händelse ── */}
      {calInternalModal&&(
        <div style={{...modalOverlay,zIndex:1003}} onClick={e=>{if(e.target===e.currentTarget)setCalInternalModal(false)}}>
          <div style={modalBox(440)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px',borderBottom:`1px solid ${C.border}`,background:C.surface}}>
              <h2 style={{fontSize:18,fontWeight:600,color:C.text,display:'flex',alignItems:'center',gap:8}}><i className="fas fa-sticky-note" style={{color:'#8b5cf6'}}/> Intern händelse</h2>
              <button onClick={()=>setCalInternalModal(false)} style={{width:32,height:32,background:'transparent',border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{padding:24}}>
              <div style={{marginBottom:14}}>
                <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:6,color:C.text}}>Rubrik *</label>
                <input value={calInternalTitle} onChange={e=>setCalInternalTitle(e.target.value)} placeholder="T.ex. Möte, Leverans, Inköp..." style={inp}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:8,color:C.text}}>Datum & tid</label>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  <div><div style={{fontSize:11,color:C.textSec,marginBottom:4}}>Datum</div><input type="date" value={calInternalDate} onChange={e=>setCalInternalDate(e.target.value)} style={{...inp,colorScheme:'dark'}}/></div>
                  <div><div style={{fontSize:11,color:C.textSec,marginBottom:4}}>Start</div><input type="time" value={calInternalTime} onChange={e=>setCalInternalTime(e.target.value)} style={{...inp,colorScheme:'dark'}}/></div>
                  <div><div style={{fontSize:11,color:C.textSec,marginBottom:4}}>Slut</div><input type="time" value={calInternalEndTime} onChange={e=>setCalInternalEndTime(e.target.value)} style={{...inp,colorScheme:'dark'}}/></div>
                </div>
              </div>
              <div style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:6,color:C.text}}>Anteckning</label>
                <textarea value={calInternalNote} onChange={e=>setCalInternalNote(e.target.value)} rows={3} placeholder="Valfri beskrivning..." style={{...inp,resize:'vertical' as const}}/>
              </div>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end',borderTop:`1px solid ${C.border}`,paddingTop:16}}>
                <button onClick={()=>setCalInternalModal(false)} style={btn('#64748b')}>Avbryt</button>
                <button onClick={saveInternalEvent} disabled={!calInternalTitle.trim()||!calInternalDate} style={{...btn((!calInternalTitle.trim()||!calInternalDate)?'#333':'#8b5cf6'),opacity:(!calInternalTitle.trim()||!calInternalDate)?0.5:1}}><i className="fas fa-sticky-note"/> Spara</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KALENDER: Lägg till jobb ── */}
      {calAddModal&&(
        <div style={{...modalOverlay,zIndex:1003}} onClick={e=>{if(e.target===e.currentTarget)setCalAddModal(false)}}>
          <div style={modalBox(500)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:10}}>
              <h2 style={{fontSize:18,fontWeight:600,color:C.text}}>Boka jobb</h2>
              <button onClick={()=>setCalAddModal(false)} style={{width:32,height:32,background:'transparent',border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{padding:24}}>
              {/* Datum + tider på rad */}
              <div style={{marginBottom:16}}>
                <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:8,color:C.text}}>Datum & tid</label>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  <div>
                    <div style={{fontSize:11,color:C.textSec,marginBottom:4}}>Datum</div>
                    <input type="date" value={calAddDate} onChange={e=>setCalAddDate(e.target.value)}
                      style={{...inp,colorScheme:'dark'}}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,color:C.textSec,marginBottom:4}}>Starttid</div>
                    <input type="time" value={calAddTime} onChange={e=>setCalAddTime(e.target.value)}
                      style={{...inp,colorScheme:'dark'}}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,color:C.textSec,marginBottom:4}}>Sluttid</div>
                    <input type="time" value={calAddEndTime} onChange={e=>setCalAddEndTime(e.target.value)}
                      style={{...inp,colorScheme:'dark'}}/>
                  </div>
                </div>
              </div>
              {/* Kundsök */}
              <div style={{marginBottom:16}}>
                <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:8,color:C.text}}>Kund</label>
                <div style={{display:'flex',alignItems:'center',gap:8,background:C.bg,borderRadius:8,padding:'8px 12px',border:`1px solid ${C.border}`,marginBottom:8}}>
                  <i className="fas fa-search" style={{color:C.textSec,fontSize:12}}/>
                  <input value={calAddSearch} onChange={e=>{setCalAddSearch(e.target.value);setCalAddCustomerId('');setCalAddService('');setCalAddStep(0)}}
                    placeholder="Sök kund..." style={{border:'none',background:'transparent',outline:'none',flex:1,color:C.text,fontSize:13,fontFamily:'inherit'}}/>
                </div>
                {calAddSearch&&(
                  <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,maxHeight:180,overflowY:'auto'}}>
                    {customers.filter(c=>c.name.toLowerCase().includes(calAddSearch.toLowerCase())||c.address?.toLowerCase().includes(calAddSearch.toLowerCase())).slice(0,8).map(c=>(
                      <div key={c.id} onClick={()=>{setCalAddCustomerId(c.id);setCalAddSearch(c.name);setCalAddService('');setCalAddStep(0)}}
                        style={{padding:'10px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,display:'flex',flexDirection:'column',gap:2,transition:'background 0.1s'}}
                        onMouseEnter={e=>(e.currentTarget.style.background=`${C.primary}15`)}
                        onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                        <span style={{fontSize:13,fontWeight:600,color:C.text}}>{c.name}</span>
                        <span style={{fontSize:11,color:C.textSec}}>{c.address}</span>
                      </div>
                    ))}
                  </div>
                )}
                {calAddCustomerId&&<div style={{marginTop:6,padding:'6px 10px',background:`${C.primary}12`,borderRadius:6,fontSize:12,color:C.primary,fontWeight:600}}>✓ {customers.find(c=>c.id===calAddCustomerId)?.name}</div>}
              </div>
              {/* Tjänst */}
              {calAddCustomerId&&(()=>{
                const cust=customers.find(c=>c.id===calAddCustomerId)
                if(!cust)return null
                const svcs=getServices(cust)
                if(!svcs.length)return null
                return(
                  <div style={{marginBottom:16}}>
                    <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:8,color:C.text}}>Tjänst</label>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap' as const}}>
                      {svcs.map((s:string)=>(
                        <button key={s} onClick={()=>{setCalAddService((prev:any)=>{const arr=Array.isArray(prev)?prev:[prev].filter(Boolean);return arr.includes(s)?arr.filter((x:string)=>x!==s):[...arr,s]});setCalAddStep(0)}}
                          style={{padding:'6px 14px',borderRadius:9999,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',border:`1.5px solid ${(Array.isArray(calAddService)?calAddService:[calAddService]).includes(s)?C.primary:C.border}`,background:(Array.isArray(calAddService)?calAddService:[calAddService]).includes(s)?C.primary:'transparent',color:(Array.isArray(calAddService)?calAddService:[calAddService]).includes(s)?'white':C.text,transition:'all 0.15s'}}>
                          {svcLabel(s)}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}
              {/* Processteg */}
              {calAddCustomerId&&calAddService&&(()=>{
                const cust=customers.find(c=>c.id===calAddCustomerId)
                if(!cust)return null
                const steps=getSteps(calAddService,cust.include_fogsand)
                const curStep=getProgress(cust)[calAddService]||0
                if(!steps.length)return null
                return(
                  <div style={{marginBottom:16}}>
                    <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:8,color:C.text}}>Processteg <span style={{fontSize:11,color:C.textSec,fontWeight:400}}>(nu: {steps[curStep]?.label})</span></label>
                    <select value={calAddStep} onChange={e=>setCalAddStep(Number(e.target.value))} style={inp}>
                      <option value={0}>— Ändra ej —</option>
                      {steps.map(st=>(
                        <option key={st.id} value={st.id}>{st.label}</option>
                      ))}
                    </select>
                  </div>
                )
              })()}
              {/* Operatör */}
              <div style={{marginBottom:16}}>
                <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:8,color:C.text}}>Operatör</label>
                <div style={{display:'flex',gap:8}}>
                  {(['Herman','Ture'] as string[]).map(op=>{
                    const sel=calAddOperator.includes(op)
                    return(
                      <button key={op} onClick={()=>setCalAddOperator((prev:string[])=>prev.includes(op)?prev.filter(x=>x!==op):[...prev,op])}
                        style={{padding:'6px 18px',borderRadius:9999,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',border:`1.5px solid ${sel?'#10b981':C.border}`,background:sel?'#10b981':'transparent',color:sel?'white':C.text,transition:'all 0.15s'}}>
                        {op}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' as const,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                <button onClick={()=>setCalAddModal(false)} style={btn('#64748b')}>Avbryt</button>
                <button onClick={saveCalAdd} disabled={!calAddCustomerId||!calAddDate} style={{...btn((!calAddCustomerId||!calAddDate)?'#333':C.primary),opacity:(!calAddCustomerId||!calAddDate)?0.5:1}}><i className="fas fa-calendar-plus"/> Spara</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBookedDateModal&&bookedDateCustomer&&(
        <div style={{...modalOverlay,zIndex:1002}} onClick={e=>{if(e.target===e.currentTarget)setShowBookedDateModal(false)}}>
          <div style={modalBox(440)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:10}}>
              <h2 style={{fontSize:18,fontWeight:600,color:C.text}}>Välj bokningsdatum</h2>
              <button onClick={()=>setShowBookedDateModal(false)} style={{background:'none',border:'none',color:C.textSec,cursor:'pointer',fontSize:22}}><i className="fas fa-times"/></button>
            </div>
            <div style={{padding:24}}>
              <p style={{fontSize:14,color:C.textSec,marginBottom:16}}>
                {bookedDateCustomer.name} — {svcLabel(bookedDateService)} är nu bokad. Välj datum för jobbet.
              </p>
              <div style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:8,color:C.text}}>Bokningsdatum</label>
                <input type="date" value={bookedDateValue} onChange={e=>setBookedDateValue(e.target.value)} style={inp}/>
              </div>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' as const}}>
                <button onClick={()=>setShowBookedDateModal(false)} style={btn('#64748b')}>Hoppa över</button>
                <button onClick={saveBookedDate} style={btn(C.primary)}><i className="fas fa-calendar-check"/> Spara datum</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── UH MODAL: Lägg till/Redigera ── */}
      {uhModal&&(
        <div style={{...modalOverlay,zIndex:1001}} onClick={e=>{if(e.target===e.currentTarget)setUhModal(false)}}>
          <div style={modalBox(500)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:10}}>
              <h2 style={{fontSize:20,fontWeight:600,color:C.text}}>{uhIsEdit?'Redigera avtal':'Lägg till årligt underhåll'}</h2>
              <button onClick={()=>setUhModal(false)} style={{background:'none',border:'none',color:C.textSec,cursor:'pointer',fontSize:22}}><i className="fas fa-times"/></button>
            </div>
            <div style={{padding:24}}>
              {([['Namn *','name','text'],['Telefon *','phone','tel'],['E-post','email','email'],['Adress *','address','text']] as [string,string,string][]).map(([label,field,type])=>(
                <div key={field} style={{marginBottom:16}}>
                  <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:6,color:C.text}}>{label}</label>
                  <input type={type} value={(uhForm as any)[field]} onChange={e=>setUhForm({...uhForm,[field]:e.target.value})} style={inp}/>
                </div>
              ))}
              <div style={{marginBottom:16}}>
                <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:6,color:C.text}}>Årligt belopp (exkl. moms)</label>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <input type="number" value={uhForm.amount} onChange={e=>setUhForm({...uhForm,amount:e.target.value})} placeholder="0" style={{...inp,maxWidth:180}}/>
                  <span style={{color:C.textSec}}>kr/år</span>
                </div>
              </div>
              <div style={{marginBottom:24}}>
                <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:6,color:C.text}}>Notis</label>
                <textarea value={uhForm.note} onChange={e=>setUhForm({...uhForm,note:e.target.value})} rows={2} style={{...inp,resize:'vertical' as const}}/>
              </div>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' as const}}>
                <button onClick={()=>setUhModal(false)} style={btn('#64748b')}>Avbryt</button>
                <button onClick={saveContract} style={btn(C.primary)}><i className="fas fa-save"/> Spara avtal</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── UH MODAL: Detalj ── */}
      {uhDetailModal&&uhCurrent&&(
        <div style={{...modalOverlay,zIndex:1001}} onClick={e=>{if(e.target===e.currentTarget)setUhDetailModal(false)}}>
          <div style={modalBox(500)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:10}}>
              <h2 style={{fontSize:20,fontWeight:600,color:C.text}}>{uhCurrent.name}</h2>
              <button onClick={()=>setUhDetailModal(false)} style={{background:'none',border:'none',color:C.textSec,cursor:'pointer',fontSize:22}}><i className="fas fa-times"/></button>
            </div>
            <div style={{padding:24}}>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12,marginBottom:20}}>
                {([
                  ['fas fa-phone',uhCurrent.phone||'—'],
                  ['fas fa-envelope',uhCurrent.email||'Ingen e-post'],
                  ['fas fa-map-marker-alt',uhCurrent.address],
                  ['fas fa-money-bill-wave',(parseFloat(uhCurrent.amount)||0)>0?fmtCur(parseFloat(uhCurrent.amount))+'/år':'Inget belopp'],
                ] as [string,string][]).map(([icon,val])=>(
                  <div key={icon} style={{display:'flex',alignItems:'center',gap:10,padding:'12px',background:C.bg,borderRadius:8}}>
                    <i className={icon} style={{color:C.primary,width:18}}/><span style={{fontSize:13,color:C.text}}>{val}</span>
                  </div>
                ))}
              </div>
              {uhCurrent.note&&<div style={{marginBottom:16,padding:'10px 14px',background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.2)',borderLeft:'3px solid #6366f1',borderRadius:8,fontSize:14,color:C.text}}>📝 {uhCurrent.note}</div>}
              <div style={{display:'flex',gap:10,flexWrap:'wrap' as const,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
                <button onClick={async()=>{await toggleDone(uhCurrent.id);setUhDetailModal(false)}} style={btn(uhCurrent.done?'#64748b':'#10b981')}><i className={uhCurrent.done?'fas fa-undo':'fas fa-check-circle'}/>{uhCurrent.done?' Ångra genomförd':' Markera genomförd'}</button>
                <button onClick={()=>{setUhDetailModal(false);openUhEdit(uhCurrent)}} style={btn('#64748b')}><i className="fas fa-edit"/> Redigera</button>
                <button onClick={()=>deleteContract(uhCurrent.id)} style={btn('#ef4444')}><i className="fas fa-trash"/> Ta bort</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── UH MODAL: Importera ── */}
      {uhImportModal&&(
        <div style={{...modalOverlay,zIndex:1001}} onClick={e=>{if(e.target===e.currentTarget)setUhImportModal(false)}}>
          <div style={modalBox(500)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:10}}>
              <h2 style={{fontSize:20,fontWeight:600,color:C.text}}>Importera kund till underhåll</h2>
              <button onClick={()=>setUhImportModal(false)} style={{background:'none',border:'none',color:C.textSec,cursor:'pointer',fontSize:22}}><i className="fas fa-times"/></button>
            </div>
            <div style={{padding:24}}>
              <p style={{color:C.textSec,fontSize:14,marginBottom:16}}>Välj en befintlig kund så fylls uppgifterna i automatiskt.</p>
              <div style={{display:'flex',alignItems:'center',gap:8,background:C.bg,padding:'10px 14px',borderRadius:8,marginBottom:12,border:`1px solid ${C.border}`}}>
                <i className="fas fa-search" style={{color:C.textSec}}/>
                <input value={uhImportQ} onChange={e=>setUhImportQ(e.target.value)} placeholder="Skriv namn eller adress..." style={{border:'none',background:'transparent',outline:'none',flex:1,fontFamily:'inherit',fontSize:14,color:C.text}}/>
              </div>
              <div style={{maxHeight:280,overflowY:'auto',display:'flex',flexDirection:'column',gap:8}}>
                {uhFiltered.map(c=>(
                  <div key={c.id} onClick={()=>importCustomer(c)} style={{padding:'12px 16px',background:C.bg,borderRadius:8,cursor:'pointer',border:'2px solid transparent',transition:'border-color 0.2s',display:'flex',justifyContent:'space-between',alignItems:'center'}}
                    onMouseEnter={e=>(e.currentTarget.style.borderColor=C.primary)}
                    onMouseLeave={e=>(e.currentTarget.style.borderColor='transparent')}>
                    <div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{c.name}</div><div style={{fontSize:12,color:C.textSec}}>{c.address} · {c.phone}</div></div>
                    <i className="fas fa-chevron-right" style={{color:C.textSec}}/>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KUND MAIL MODAL ── */}
      {customerMailOpen&&customerMailTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{if(e.target===e.currentTarget)setCustomerMailOpen(false)}}>
          <div style={{width:'min(700px,95vw)',maxHeight:'90vh',background:C.surface,borderRadius:12,display:'flex',flexDirection:'column',overflow:'hidden',border:`1px solid ${C.border}`}}>
            {/* HEADER */}
            <div style={{padding:'16px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
              <div>
                <div style={{fontSize:16,fontWeight:700,color:C.text,display:'flex',alignItems:'center',gap:8}}><i className="fas fa-envelope" style={{color:C.primary}}/> {customerMailTarget.name}</div>
                <div style={{fontSize:12,color:C.textSec,marginTop:2}}>{customerMailTarget.email}</div>
              </div>
              <button onClick={()=>setCustomerMailOpen(false)} style={{width:32,height:32,background:'transparent',border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            {/* AI-SEKTION */}
            <div style={{padding:16,background:C.primary+'08',borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
              <div style={{marginBottom:8}}>
                <button onClick={generateCustomerMailAi} disabled={customerMailAiLoading}
                  style={{padding:'7px 16px',background:'#8b5cf6',color:'white',border:'none',borderRadius:8,fontWeight:600,fontSize:13,cursor:'pointer',fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:8,opacity:customerMailAiLoading?0.7:1}}>
                  {customerMailAiLoading?<><i className="fas fa-spinner fa-spin"/> Genererar...</>:<><i className="fas fa-magic"/> Generera AI-svar</>}
                </button>
              </div>
              <textarea value={customerMailCompose} onChange={e=>setCustomerMailCompose(e.target.value)} rows={6}
                placeholder="Skriv eller generera svar..."
                style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.input,color:C.text,fontSize:13,fontFamily:'inherit',outline:'none',resize:'vertical' as const,boxSizing:'border-box' as const,lineHeight:1.6,marginBottom:8}}/>
              <div style={{marginBottom:8}}>
                <button onClick={()=>setCustomerMailShowSchedule(s=>!s)}
                  style={{padding:'5px 12px',background:'transparent',border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,fontSize:12,cursor:'pointer',fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:6}}>
                  <i className="fas fa-clock"/> {customerMailShowSchedule?'Dölj schemaläggning':'Schemalägg'}
                </button>
              </div>
              {customerMailShowSchedule&&(
                <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center'}}>
                  <input type="date" value={customerMailScheduleDate} onChange={e=>setCustomerMailScheduleDate(e.target.value)}
                    style={{padding:'6px 10px',borderRadius:6,border:`1px solid ${C.border}`,background:C.input,color:C.text,fontSize:13,fontFamily:'inherit',outline:'none'}}/>
                  <input type="time" value={customerMailScheduleTime} onChange={e=>setCustomerMailScheduleTime(e.target.value)}
                    style={{padding:'6px 10px',borderRadius:6,border:`1px solid ${C.border}`,background:C.input,color:C.text,fontSize:13,fontFamily:'inherit',outline:'none'}}/>
                </div>
              )}
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <button onClick={sendCustomerMail} disabled={customerMailSending||!customerMailCompose.trim()}
                  style={{padding:'8px 20px',background:C.primary,color:'white',border:'none',borderRadius:8,fontWeight:600,fontSize:13,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:8,opacity:customerMailSending?0.7:1}}>
                  {customerMailSending?<><i className="fas fa-spinner fa-spin"/> Skickar...</>:<><i className="fas fa-paper-plane"/> Skicka</>}
                </button>
                {customerMailStatus&&<span style={{fontSize:13,fontWeight:600,color:customerMailStatus.startsWith('✓')?'#10b981':'#ef4444'}}>{customerMailStatus}</span>}
              </div>
            </div>
            {/* TRÅD */}
            <div style={{flex:1,overflowY:'auto',padding:0}}>
              <div style={{padding:'12px 16px 8px',fontSize:12,fontWeight:600,color:C.textSec,textTransform:'uppercase' as const,letterSpacing:'0.05em'}}>Konversation</div>
              {customerMailLoading
                ?<div style={{textAlign:'center',padding:24,color:C.textSec}}><i className="fas fa-spinner fa-spin"/> Laddar...</div>
                :customerMailThread.length===0
                  ?<div style={{textAlign:'center',padding:24,color:C.textSec,fontSize:13}}>Ingen mailhistorik med {customerMailTarget.name}</div>
                  :customerMailThread.map((m:any)=>{
                    const isIncoming=m.from?.toLowerCase().includes(customerMailTarget.email?.toLowerCase())
                    return(
                      <div key={m.id} style={{margin:'0 16px 12px',padding:'12px 14px',background:isIncoming?`${C.primary}08`:'transparent',border:`1px solid ${C.border}`,borderLeft:`3px solid ${isIncoming?C.primary:'#10b981'}`,borderRadius:8}}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                          <span style={{fontSize:12,fontWeight:600,color:isIncoming?C.primary:'#10b981'}}>{isIncoming?'↙ Inkommande':'↗ Skickat'} — {m.subject}</span>
                          <span style={{fontSize:11,color:C.textSec}}>{new Date(m.date).toLocaleString('sv-SE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                        </div>
                        <pre style={{fontSize:12,color:C.text,lineHeight:1.6,whiteSpace:'pre-wrap',fontFamily:'inherit',margin:0,maxHeight:140,overflowY:'auto'}}>{m.body}</pre>
                      </div>
                    )
                  })
              }
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

/* ─── CUSTOMER CARD ──────────────────────────────────────────── */
function CustomerCard({c,C,onClick,onMail,hasNewMail}:{c:any,C:any,onClick:()=>void,onMail?:(c:any)=>void,hasNewMail?:boolean}){
  const status=getStatus(c),prog=Math.round(calcProgress(c))
  const svcs=getServices(c),kvm=getKvm(c)
  const svcStr=svcs.map((s:string)=>`${svcLabel(s)} (${kvm[s]||0}kvm)`).join(', ')
  const price=parseFloat(c.price_excl_vat)||0
  const statusColors:Record<string,string>={new:'#22c55e',in_progress:'#3b82f6',completed:'#10b981',rejected:'#ef4444'}
  const topColor=statusColors[status]||'#888'
  const addonLabels:Record<string,string>={ograshammande_fogsand:'Ogräshämmande fogsand',flexibel_fogsand:'Flexibel fogsand',stenmjol:'Stenmjöl',saapa:'Såpa',kiselimpregnering:'Kiselimpregnering',impregnering:'Impregnering',olja:'Olja'}
  const serviceAddons:Record<string,string[]>=typeof c.service_addons==='object'&&c.service_addons?c.service_addons:{}
  const allAddonBadges:string[]=Object.values(serviceAddons).flat()
  return(
    <div onClick={onClick} style={{background:C.surface,padding:18,borderRadius:12,border:`1px solid ${C.border}`,borderTop:`3px solid ${topColor}`,cursor:'pointer',transition:'border-color 0.15s,box-shadow 0.15s'}}
      onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=C.primary;(e.currentTarget as HTMLElement).style.boxShadow=`0 0 0 1px ${C.primary}22`}}
      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=C.border;(e.currentTarget as HTMLElement).style.boxShadow='none'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:4}}>{c.name}</div>
          <div style={{fontSize:13,color:C.textSec}}>{svcStr}</div>
          {allAddonBadges.length>0&&(
            <div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:4}}>
              {allAddonBadges.map(a=>(
                <span key={a} style={{fontSize:10,padding:'2px 7px',background:'rgba(139,92,246,0.12)',border:'1px solid rgba(139,92,246,0.25)',borderRadius:9999,color:'#8b5cf6',fontWeight:600}}>{addonLabels[a]||a}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6}}>
          <StatusBadge status={status}/>
          {price>0&&<span style={{fontSize:13,fontWeight:700,color:'#10b981',whiteSpace:'nowrap'}}>{fmtCur(price)}</span>}
          {c.booked_date&&<span style={{fontSize:11,color:'#3b82f6',whiteSpace:'nowrap'}}><i className="fas fa-calendar-check" style={{marginRight:3}}/>{c.booked_date}</span>}
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize:14,color:C.textSec}}><PhoneIcon size={16} color={C.primary}/>{c.phone}</div>
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize:14,color:C.textSec}}><MapPinIcon size={16} color={C.primary}/>{c.address}</div>
      </div>
      {c.note&&<div style={{fontSize:12,color:C.text,background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.2)',padding:'6px 10px',borderRadius:6,marginBottom:12}}>📝 {c.note}</div>}
      <div style={{paddingTop:12,borderTop:`1px solid ${C.border}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <div style={{fontSize:12,color:C.textSec}}>Framsteg: {prog}%</div>
          {onMail&&c.email&&<button onClick={e=>{e.stopPropagation();onMail(c)}} style={{padding:'3px 10px',background:'transparent',border:`1px solid ${hasNewMail?'#ef4444':C.border}`,borderRadius:6,color:hasNewMail?'#ef4444':C.textSec,fontSize:11,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:4}}>
            <i className="fas fa-envelope" style={{color:hasNewMail?'#ef4444':C.primary}}/> Mail{hasNewMail&&<span style={{fontSize:10,padding:'1px 6px',background:'#ef4444',color:'white',borderRadius:9999,fontWeight:700,marginLeft:4}}>NYTT</span>}
          </button>}
        </div>
        <div style={{height:6,background:C.bg,borderRadius:9999,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${prog}%`,background:C.primary,borderRadius:9999,transition:'width 0.3s'}}/>
        </div>
      </div>
    </div>
  )
}

/* ─── EDIT FORM ──────────────────────────────────────────────── */
function EditForm({current,C,inp,btn,onSave,onCancel}:any){
  const services=getServices(current)
  const hasStentvatt=services.includes('stentvatt')
  const hasAltantvatt=services.includes('altantvatt')
  const existingAddons:Record<string,string[]>=typeof current.service_addons==='object'&&current.service_addons?current.service_addons:{}
  const [form,setForm]=useState({
    name:current.name,
    phone:current.phone,
    email:current.email||'',
    address:current.address,
    note:current.note||'',
    price:current.price_excl_vat||'',
    service_kvm:getKvm(current) as Record<string,string>,
    include_fogsand:current.include_fogsand||false,
    service_addons:existingAddons as Record<string,string[]>,
  })
  return(
    <div style={{marginBottom:24}}>
      <h3 style={{fontSize:16,fontWeight:600,marginBottom:16,color:C.text}}>Redigera uppgifter</h3>
      {([['Namn','name','text'],['Telefon','phone','tel'],['E-post','email','email'],['Adress','address','text']] as [string,string,string][]).map(([l,f,t])=>(
        <div key={f} style={{marginBottom:14}}>
          <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:5,color:C.text}}>{l}</label>
          <input type={t} value={(form as any)[f]} onChange={e=>setForm({...form,[f]:e.target.value})} style={inp}/>
        </div>
      ))}
      {services.length>0&&(
        <div style={{marginBottom:14}}>
          <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:8,color:C.text}}>Antal kvm per tjänst</label>
          {services.map((s:string)=>(
            <div key={s} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <span style={{fontSize:13,color:C.text,minWidth:110,fontWeight:500}}>{svcLabel(s)}</span>
              <input type="number" placeholder="Kvm" value={form.service_kvm[s]||''} onChange={e=>setForm({...form,service_kvm:{...form.service_kvm,[s]:e.target.value}})} style={{...inp,maxWidth:130}}/>
              <span style={{fontSize:13,color:C.textSec}}>kvm</span>
            </div>
          ))}
        </div>
      )}
      {hasStentvatt&&(
        <div style={{marginBottom:14}}>
          <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:8,color:C.text}}>Sand / Fogsand (Stentvätt)</label>
          {[['ograshammande_fogsand','Ogräshämmande fogsand'],['flexibel_fogsand','Flexibel fogsand'],['stenmjol','Stenmjöl']].map(([val,lbl])=>{
            const sel=(form.service_addons.stentvatt??[]).includes(val)
            return(
            <div key={val} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',cursor:'pointer'}} onClick={()=>{
              const cur=form.service_addons.stentvatt??[]
              const next=sel?cur.filter(x=>x!==val):[...cur,val]
              setForm({...form,service_addons:{...form.service_addons,stentvatt:next},include_fogsand:next.length>0})
            }}>
              <div style={{width:15,height:15,borderRadius:4,border:`2px solid ${sel?C.primary:C.border}`,background:sel?C.primary:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}}>
                {sel&&<span style={{color:'white',fontSize:10,fontWeight:700,lineHeight:1}}>✓</span>}
              </div>
              <span style={{fontSize:13,color:C.text}}>{lbl}</span>
            </div>
          )})}
        </div>
      )}
      {hasAltantvatt&&(
        <div style={{marginBottom:14}}>
          <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:8,color:C.text}}>Tillval (Altantvätt)</label>
          {[['saapa','Såpa'],['kiselimpregnering','Kiselimpregnering'],['impregnering','Impregnering'],['olja','Olja']].map(([val,lbl])=>{
            const selected=(form.service_addons.altantvatt??[]).includes(val)
            return(
              <div key={val} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',cursor:'pointer'}} onClick={()=>{
                const cur=form.service_addons.altantvatt??[]
                const next=selected?cur.filter(x=>x!==val):[...cur,val]
                setForm({...form,service_addons:{...form.service_addons,altantvatt:next}})
              }}>
                <div style={{width:15,height:15,borderRadius:3,border:`2px solid ${selected?C.primary:C.border}`,background:selected?C.primary:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}}>
                  {selected&&<span style={{color:'white',fontSize:9,fontWeight:700,lineHeight:1}}>✓</span>}
                </div>
                <span style={{fontSize:13,color:C.text}}>{lbl}</span>
              </div>
            )
          })}
        </div>
      )}
      <div style={{marginBottom:14}}>
        <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:5,color:C.text}}>Notis</label>
        <textarea value={form.note} onChange={e=>setForm({...form,note:e.target.value})} rows={2} style={{...inp,resize:'vertical' as const}}/>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:5,color:C.text}}>Pris (exkl. moms)</label>
        <input type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} style={{...inp,maxWidth:180}}/>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap' as const}}>
        <button onClick={onCancel} style={btn('#64748b')}>Avbryt</button>
        <button onClick={()=>onSave({
          name:form.name,phone:form.phone,email:form.email,address:form.address,
          note:form.note,price_excl_vat:parseFloat(String(form.price))||0,
          service_kvm:form.service_kvm,include_fogsand:(form.service_addons.stentvatt??[]).length>0,
          service_addons:form.service_addons,
        })} style={btn(C.primary)}>Spara</button>
      </div>
    </div>
  )
}

/* ─── DONUT CHART ────────────────────────────────────────────── */
function DonutChart({data,C}:{data:{label:string,value:number,color:string}[],C:any}){
  const total=data.reduce((s,d)=>s+d.value,0)
  if(!total)return <div style={{color:C.textSec,textAlign:'center',padding:20,fontSize:13}}>Ingen data</div>
  const r=45,circ=2*Math.PI*r
  let offset=0
  return(
    <div style={{display:'flex',alignItems:'center',gap:24,flexWrap:'wrap' as const}}>
      <svg width={120} height={120} viewBox="0 0 120 120" style={{flexShrink:0}}>
        <circle cx={60} cy={60} r={r} fill="none" stroke={C.border} strokeWidth={18}/>
        {data.map((d,i)=>{
          const dash=(d.value/total)*circ,gap=circ-dash
          const rot=(offset/total)*360-90
          offset+=d.value
          return <circle key={i} cx={60} cy={60} r={r} fill="none" stroke={d.color} strokeWidth={18} strokeDasharray={`${dash} ${gap}`} strokeDashoffset={0} transform={`rotate(${rot},60,60)`}/>
        })}
        <text x={60} y={64} textAnchor="middle" style={{fontSize:12,fontWeight:700,fill:C.text,fontFamily:'Inter,sans-serif'}}>{total}</text>
      </svg>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {data.map(d=>(
          <div key={d.label} style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:10,height:10,borderRadius:'50%',background:d.color,flexShrink:0}}/>
            <span style={{fontSize:13,color:C.text}}>{d.label}</span>
            <span style={{fontSize:13,color:C.textSec,marginLeft:'auto',paddingLeft:12}}>{Math.round(d.value/total*100)}%</span>
          </div>
        ))}
      </div>

    </div>
  )
}

/* ─── STAT PAGE ──────────────────────────────────────────────── */
function StatPage({customers,allLogs,C,isMobile}:any){
  const GOAL=2500000
  // Fakturerade = alla tjänster nått sista steget (Fakturerad)
  const invoicedJobs=customers.filter((c:any)=>{
    if(c.rejected)return false
    if(!(parseFloat(c.price_excl_vat)||0))return false
    const p=getProgress(c),svcs=getServices(c)
    if(!svcs.length)return false
    return svcs.every((s:string)=>{
      const steps=getSteps(s,c.include_fogsand)
      const lastIdx=steps.length-1
      return (p[s]||0)>=lastIdx
    })
  })
  // completedJobs = aktiva + stängda (för omsättning, snitt etc — EXKL tid)
  const completedJobs=customers.filter((c:any)=>!c.rejected&&(parseFloat(c.price_excl_vat)||0)>0&&(getStatus(c)==='completed'||getStatus(c)==='in_progress'))
  // Tid räknas ENBART på fakturerade
  const timeJobIds=new Set(invoicedJobs.map((c:any)=>c.id))
  const totalRev=completedJobs.reduce((s:number,c:any)=>s+(parseFloat(c.price_excl_vat)||0),0)
  const avgRev=completedJobs.length?Math.round(totalRev/completedJobs.length):0
  const timeLogs=allLogs.filter((l:any)=>l.log_type==='time_log'&&l.time_spent)
  // Tid ENBART för fakturerade jobb
  const completedTimeLogs=timeLogs.filter((l:any)=>timeJobIds.has(l.customer_id))
  const totalMins=completedTimeLogs.reduce((s:number,l:any)=>s+(l.time_spent||0),0)
  const nonRejectedIds=new Set(customers.filter((c:any)=>!c.rejected).map((c:any)=>c.id))
  const allMins=timeLogs.filter((l:any)=>nonRejectedIds.has(l.customer_id)).reduce((s:number,l:any)=>s+(l.time_spent||0),0)
  const revPerHour=totalMins>0&&totalRev>0?Math.round(totalRev/(totalMins/60)):0
  const custMinsCompleted:Record<string,number>={}
  completedTimeLogs.forEach((l:any)=>{if(l.customer_id)custMinsCompleted[l.customer_id]=(custMinsCompleted[l.customer_id]||0)+(l.time_spent||0)})
  const avgHourlyPerJob=invoicedJobs.length>0?(()=>{
    const rates=invoicedJobs.map((c:any)=>{const m=custMinsCompleted[c.id]||0;const r=parseFloat(c.price_excl_vat)||0;return m>0?r/(m/60):0}).filter((x:number)=>x>0)
    return rates.length?Math.round(rates.reduce((a:number,b:number)=>a+b,0)/rates.length):0
  })():0
  const reachedOff=customers.filter((c:any)=>{
    if(c.rejected)return true
    const p=getProgress(c),svcs=getServices(c)
    return svcs.some((s:string)=>{const steps=getSteps(s,c.include_fogsand);const offIdx=steps.findIndex((x:any)=>x.label==='Offert');return offIdx>-1&&(p[s]||0)>offIdx})
  })
  const convRate=reachedOff.length>0?Math.round(completedJobs.length/reachedOff.length*100):0
  const totalKvm=completedJobs.reduce((s:number,c:any)=>{const kvm=getKvm(c);return s+Object.values(kvm).reduce((sk:number,v:any)=>sk+(parseFloat(String(v))||0),0)},0)
  const goalPct=Math.min(100,Math.round((totalRev/GOAL)*100))
  const svcColors:Record<string,string>={stentvatt:'#3b82f6',altantvatt:'#10b981',asfaltstvatt:'#f59e0b',stentvatt_no_fogsand:'#8b5cf6',betongtvatt:'#f97316'}
  // svcRev/svcCount baseras på ALLA aktiva jobb (för att staplar ska visas)
  const allActiveJobs=customers.filter((c:any)=>!c.rejected&&(parseFloat(c.price_excl_vat)||0)>0)
  const svcRev:Record<string,number>={},svcTime:Record<string,number>={},svcCount:Record<string,number>={}
  allActiveJobs.forEach((c:any)=>{
    const svcs=getServices(c),rev=parseFloat(c.price_excl_vat)||0,perSvc=svcs.length?rev/svcs.length:0
    svcs.forEach((s:string)=>{svcRev[s]=(svcRev[s]||0)+perSvc;svcCount[s]=(svcCount[s]||0)+1})
  })
  completedTimeLogs.forEach((l:any)=>{
    const svc=Object.keys(svcColors).find(k=>l.moment&&l.moment.toLowerCase().includes(svcLabel(k).toLowerCase()))
    if(svc)svcTime[svc]=(svcTime[svc]||0)+(l.time_spent||0)
  })
  const donutData=Object.entries(svcCount).map(([key,val])=>({label:svcLabel(key),value:val as number,color:svcColors[key]||'#94a3b8'}))
  const kvmBySvc:Record<string,number>={}
  allActiveJobs.forEach((c:any)=>{const kvm=getKvm(c);getServices(c).forEach((s:string)=>{kvmBySvc[s]=(kvmBySvc[s]||0)+(parseFloat(String(kvm[s]))||0)})})
  const maxKvm=Math.max(...Object.values(kvmBySvc),1)
  const top5=invoicedJobs.map((c:any)=>{const m=custMinsCompleted[c.id]||0;const r=parseFloat(c.price_excl_vat)||0;return{name:c.name,kr_h:m>0?Math.round(r/(m/60)):0,mins:m}}).filter((x:any)=>x.kr_h>0).sort((a:any,b:any)=>b.kr_h-a.kr_h).slice(0,5)
  const medals=['🥇','🥈','🥉','4','5']
  const cols=isMobile?'repeat(2,1fr)':'repeat(4,1fr)'
  const kpiRow1:[string,string,string,string][]=[
    ['fas fa-coins',         'Total omsättning',   totalRev>0?fmtCur(totalRev):'—',                    '#3b82f6'],
    ['fas fa-receipt',       'Snitt per jobb',     avgRev>0?fmtCur(avgRev):'—',                        '#10b981'],
    ['fas fa-tachometer-alt','Omsättning / timme', revPerHour>0?fmtCur(revPerHour)+'/h':'—',           '#f59e0b'],
    ['fas fa-user-check',    'Timlön per jobb',    avgHourlyPerJob>0?fmtCur(avgHourlyPerJob)+'/h':'—', '#06b6d4'],
  ]
  const kpiRow2:[string,string,string,string][]=[
    ['fas fa-briefcase',     'Avslutade jobb',     String(completedJobs.length),                       '#f97316'],
    ['fas fa-ruler-combined','Total kvm',          totalKvm>0?totalKvm+' kvm':'—',                     '#ec4899'],
    ['fas fa-bullseye',      'Konverteringsgrad',  reachedOff.length>0?convRate+'%':'—',               '#8b5cf6'],
    ['fas fa-clock',         'Total tid (aktiva)', allMins>0?fmtMins(allMins):'—',                     '#64748b'],
  ]

  return(
    <div>
      {/* ══ PANEL 1: Mål + KPI ══ */}
      <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',marginBottom:16,overflow:'hidden'}}>
        <div style={{padding:'14px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:16}}>
          <div style={{width:34,height:34,borderRadius:9,background:'rgba(245,158,11,0.12)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <i className="fas fa-trophy" style={{fontSize:14,color:'#f59e0b'}}/>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6,gap:8,flexWrap:'wrap' as const}}>
              <span style={{fontWeight:700,fontSize:13,color:C.text}}>Årsmål: 2 500 000 kr</span>
              <span style={{fontWeight:700,fontSize:14,color:goalPct>=100?'#10b981':C.primary,whiteSpace:'nowrap'}}>
                {fmtCur(totalRev)}{' '}<span style={{fontSize:11,color:C.textSec,fontWeight:400}}>({goalPct}%)</span>
              </span>
            </div>
            <div style={{height:10,background:C.bg,borderRadius:9999,overflow:'hidden',border:`1px solid ${C.border}`}}>
              <div style={{height:'100%',width:`${goalPct}%`,background:goalPct>=100?'#10b981':'linear-gradient(90deg,#3b82f6,#6366f1)',borderRadius:9999,transition:'width 0.4s'}}/>
            </div>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:cols,borderBottom:`1px solid ${C.border}`}}>
          {kpiRow1.map(([icon,label,val,color],idx)=>(
            <div key={label} style={{padding:isMobile?'12px 14px':'16px 20px',borderRight:idx<kpiRow1.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:34,height:34,borderRadius:9,background:`${color}18`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <i className={icon} style={{fontSize:14,color}}/>
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:isMobile?14:16,fontWeight:700,color:C.text,lineHeight:1.15,whiteSpace:'nowrap'}}>{val}</div>
                <div style={{fontSize:10,color:C.textSec,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{display:'grid',gridTemplateColumns:cols}}>
          {kpiRow2.map(([icon,label,val,color],idx)=>(
            <div key={label} style={{padding:isMobile?'12px 14px':'16px 20px',borderRight:idx<kpiRow2.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:34,height:34,borderRadius:9,background:`${color}18`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <i className={icon} style={{fontSize:14,color}}/>
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:isMobile?14:16,fontWeight:700,color:C.text,lineHeight:1.15,whiteSpace:'nowrap'}}>{val}</div>
                <div style={{fontSize:10,color:C.textSec,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ PANEL 2: Per-tjänst-tabell ══ */}
      <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',marginBottom:16,overflow:'hidden'}}>
        <div style={{padding:'12px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8}}>
          <i className="fas fa-tools" style={{color:C.primary,fontSize:13}}/>
          <span style={{fontWeight:700,fontSize:13,color:C.text}}>Per tjänst</span>
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:isMobile?12:13}}>
            <thead>
              <tr style={{background:C.bg}}>
                {(['Tjänst','Jobb','Omsättning','Snitt/jobb','Tid'] as string[]).map((h,i,a)=>(
                  <th key={h} style={{padding:'8px 16px',textAlign:'left',fontWeight:600,fontSize:11,color:C.textSec,letterSpacing:'0.04em',textTransform:'uppercase' as const,borderRight:i<a.length-1?`1px solid ${C.border}`:'none',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(svcCount).length===0
                ?<tr><td colSpan={5} style={{padding:'24px',textAlign:'center',color:C.textSec,fontSize:13}}>Inga avslutade jobb ännu</td></tr>
                :Object.entries(svcCount).map(([svc,cnt],rowIdx)=>{
                  const rev=svcRev[svc]||0,mins=svcTime[svc]||0,avg=(cnt as number)>0?Math.round((rev as number)/(cnt as number)):0
                  return(
                    <tr key={svc} style={{borderTop:`1px solid ${C.border}`,background:rowIdx%2===0?C.surface:C.bg}}>
                      <td style={{padding:'10px 16px',borderRight:`1px solid ${C.border}`}}>
                        <div style={{display:'flex',alignItems:'center',gap:7}}>
                          <div style={{width:8,height:8,borderRadius:'50%',background:svcColors[svc]||'#94a3b8',flexShrink:0}}/>
                          <span style={{fontWeight:600,color:C.text}}>{svcLabel(svc)}</span>
                        </div>
                      </td>
                      <td style={{padding:'10px 16px',borderRight:`1px solid ${C.border}`,color:C.text,fontWeight:700,textAlign:'center'}}>{cnt as number}</td>
                      <td style={{padding:'10px 16px',borderRight:`1px solid ${C.border}`,fontWeight:700,color:'#10b981',whiteSpace:'nowrap'}}>{fmtCur(Math.round(rev as number))}</td>
                      <td style={{padding:'10px 16px',borderRight:`1px solid ${C.border}`,color:C.textSec,whiteSpace:'nowrap'}}>{avg>0?fmtCur(avg):'—'}</td>
                      <td style={{padding:'10px 16px',color:C.textSec,whiteSpace:'nowrap'}}>{mins>0?fmtMins(mins as number):'—'}</td>
                    </tr>
                  )
                })
              }
            </tbody>
            {Object.entries(svcCount).length>0&&(
              <tfoot>
                <tr style={{borderTop:`2px solid ${C.border}`,background:C.bg}}>
                  <td style={{padding:'10px 16px',fontWeight:700,color:C.text,borderRight:`1px solid ${C.border}`}}>Totalt</td>
                  <td style={{padding:'10px 16px',fontWeight:700,color:C.text,textAlign:'center',borderRight:`1px solid ${C.border}`}}>{completedJobs.length}</td>
                  <td style={{padding:'10px 16px',fontWeight:800,color:'#10b981',whiteSpace:'nowrap',borderRight:`1px solid ${C.border}`}}>{fmtCur(Math.round(totalRev))}</td>
                  <td style={{padding:'10px 16px',color:C.textSec,whiteSpace:'nowrap',borderRight:`1px solid ${C.border}`}}>{avgRev>0?fmtCur(avgRev):'—'}</td>
                  <td style={{padding:'10px 16px',color:C.textSec,whiteSpace:'nowrap'}}>{totalMins>0?fmtMins(totalMins):'—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {totalKvm>0&&(
          <div style={{padding:'10px 16px',borderTop:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' as const}}>
            <span style={{fontSize:11,fontWeight:700,color:C.textSec,textTransform:'uppercase' as const,letterSpacing:'0.05em',whiteSpace:'nowrap' as const}}>
              <i className="fas fa-ruler-combined" style={{marginRight:4,color:'#8b5cf6'}}/>KVM per tjänst:
            </span>
            {Object.entries(kvmBySvc).map(([svc,kvm])=>(
              <span key={svc} style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',background:C.bg,borderRadius:9999,border:`1px solid ${C.border}`,fontSize:12}}>
                <span style={{color:C.textSec}}>{svcLabel(svc)}</span>
                <span style={{fontWeight:700,color:C.text}}>{Math.round(kvm as number)} kvm</span>
              </span>
            ))}
            <span style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:6,padding:'4px 12px',background:`${C.primary}12`,borderRadius:9999,border:`1px solid ${C.primary}40`,fontSize:12,whiteSpace:'nowrap' as const}}>
              <span style={{color:C.textSec}}>Totalt:</span>
              <span style={{fontWeight:700,color:C.primary}}>{Math.round(totalKvm)} kvm</span>
            </span>
          </div>
        )}
      </div>

      {/* ══ PANEL 2b: Material & täckningsbidrag ══ */}
      {(()=>{
        const jobsWithMaterial=completedJobs.filter((c:any)=>Array.isArray(c.material_items)&&c.material_items.length>0&&c.material_items.some((i:any)=>i.name?.trim()))
        if(!jobsWithMaterial.length)return null
        const totalMaterialCost=jobsWithMaterial.reduce((s:number,c:any)=>s+((c.material_items||[]).reduce((ms:number,i:any)=>{const q=parseFloat(String(i.qty||0)),u=parseFloat(String(i.unit_price||0));return ms+q*u},0)),0)
        const totalRevWithMaterial=jobsWithMaterial.reduce((s:number,c:any)=>s+(parseFloat(c.price_excl_vat)||0),0)
        const totalProfitMaterial=totalRevWithMaterial-totalMaterialCost
        const materialMarginPct=totalRevWithMaterial>0?Math.round(totalProfitMaterial/totalRevWithMaterial*100):0
        return(
          <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',marginBottom:16,overflow:'hidden'}}>
            <div style={{padding:'12px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8}}>
              <i className="fas fa-box" style={{color:'#f59e0b',fontSize:13}}/>
              <span style={{fontWeight:700,fontSize:13,color:C.text}}>Material & täckningsbidrag</span>
              <span style={{marginLeft:'auto',fontSize:11,color:C.textSec}}>{jobsWithMaterial.length} jobb med material</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderBottom:`1px solid ${C.border}`}}>
              {([
                ['fas fa-coins','Intäkt (m. material)',totalRevWithMaterial>0?fmtCur(Math.round(totalRevWithMaterial)):'—','#3b82f6'],
                ['fas fa-box-open','Materialkostnad',totalMaterialCost>0?fmtCur(Math.round(totalMaterialCost)):'—','#f59e0b'],
                ['fas fa-chart-line','Täckningsbidrag',totalProfitMaterial>0?fmtCur(Math.round(totalProfitMaterial)):'—',totalProfitMaterial>=0?'#10b981':'#ef4444'],
                ['fas fa-percent','Marginal',materialMarginPct>0?`${materialMarginPct}%`:'—',materialMarginPct>=50?'#10b981':materialMarginPct>=25?'#f59e0b':'#ef4444'],
              ] as [string,string,string,string][]).map(([icon,label,val,color],idx,arr)=>(
                <div key={label} style={{padding:'16px 20px',borderRight:idx<arr.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:34,height:34,borderRadius:9,background:`${color}18`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <i className={icon} style={{fontSize:14,color}}/>
                  </div>
                  <div>
                    <div style={{fontSize:16,fontWeight:700,color:C.text}}>{val}</div>
                    <div style={{fontSize:11,color:C.textSec,marginTop:1}}>{label}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{padding:'12px 20px'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6,fontSize:12}}>
                <span style={{color:C.textSec}}>Materialkostnad {totalRevWithMaterial>0?Math.round(totalMaterialCost/totalRevWithMaterial*100):0}%</span>
                <span style={{color:'#10b981',fontWeight:600}}>Vinst {materialMarginPct}%</span>
              </div>
              <div style={{height:8,background:C.bg,borderRadius:9999,overflow:'hidden',border:`1px solid ${C.border}`}}>
                <div style={{height:'100%',display:'flex',borderRadius:9999,overflow:'hidden'}}>
                  <div style={{width:`${totalRevWithMaterial>0?Math.round(totalMaterialCost/totalRevWithMaterial*100):0}%`,background:'#f59e0b',transition:'width 0.4s'}}/>
                  <div style={{flex:1,background:'#10b981'}}/>
                </div>
              </div>
              <div style={{display:'flex',gap:12,marginTop:8,flexWrap:'wrap' as const}}>
                {jobsWithMaterial.slice(0,5).map((c:any)=>{
                  const matCost=(c.material_items||[]).reduce((s:number,i:any)=>{const q=parseFloat(String(i.qty||0)),u=parseFloat(String(i.unit_price||0));return s+q*u},0)
                  const rev=parseFloat(c.price_excl_vat)||0
                  const margin=rev>0?Math.round((rev-matCost)/rev*100):0
                  return(
                    <span key={c.id} style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',background:C.bg,borderRadius:9999,border:`1px solid ${C.border}`,fontSize:12}}>
                      <span style={{color:C.text,fontWeight:600}}>{c.name}</span>
                      <span style={{color:C.textSec}}>{fmtCur(Math.round(matCost))}</span>
                      <span style={{color:margin>=50?'#10b981':'#f59e0b',fontWeight:700}}>{margin}%</span>
                    </span>
                  )
                })}
              </div>
            </div>

            {/* ── Detaljerad materiallista ── */}
            {(()=>{
              // Normalisera materialnamn till standardkategorier
              function normalizeMaterialName(raw: string): string {
                const n = raw.toLowerCase().trim()
                if(/kisel|silikat/.test(n)) return 'Kiselimpregnering'
                if(/flexifog|flexibel fog|flex fog|flexibel fogsand/.test(n)) return 'Flexibel fogsand'
                if(/ogräs|ogrash|ogräshämmande|ograshammande/.test(n)) return 'Ogräshämmande fogsand'
                if(/fogsand|fog sand/.test(n)) return 'Fogsand'
                if(/stenmjöl|stenmjol/.test(n)) return 'Stenmjöl'
                if(/impregner/.test(n)) return 'Impregnering'
                if(/biocid|mossmedel|algmedel|algbort/.test(n)) return 'Biocid/Algmedel'
                if(/träsåpa|tra.?sapa|rengöringssåpa|såpa/.test(n)) return 'Träsåpa'
                if(/träolja|tra.?olja|terrassolja/.test(n)) return 'Träolja'
                if(/tvättmedel|rengöringsmedel/.test(n)) return 'Rengöringsmedel'
                return raw.trim().slice(0, 35)
              }
              // Aggregera alla material-poster över alla jobb
              const materialMap: Record<string, {totalCost: number, totalQty: number, unitPrice: number, count: number}> = {}
              jobsWithMaterial.forEach((c:any)=>{
                ;(c.material_items||[]).forEach((i:any)=>{
                  const name = normalizeMaterialName(String(i.name||'').trim())
                  if(!name) return
                  const qty = parseFloat(String(i.qty||0))
                  const unitPrice = parseFloat(String(i.unit_price||0))
                  const cost = qty * unitPrice
                  if(!materialMap[name]) materialMap[name] = {totalCost:0, totalQty:0, unitPrice, count:0}
                  materialMap[name].totalCost += cost
                  materialMap[name].totalQty += qty
                  materialMap[name].count += 1
                })
              })
              const sorted = Object.entries(materialMap).sort((a,b)=>b[1].totalCost-a[1].totalCost)
              if(!sorted.length) return null
              const grandTotal = sorted.reduce((s,[,v])=>s+v.totalCost, 0)
              return(
                <div style={{borderTop:`1px solid ${C.border}`}}>
                  <div style={{padding:'10px 20px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <span style={{fontSize:12,fontWeight:700,color:C.text}}><i className="fas fa-list" style={{marginRight:6,color:'#f59e0b'}}/>Materialspecifikation</span>
                    <span style={{fontSize:12,fontWeight:700,color:'#f59e0b'}}>{fmtCur(Math.round(grandTotal))} totalt</span>
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:C.bg}}>
                        {(['Material','Totalt antal','À-pris','Total kostnad','Andel'] as string[]).map((h,i,a)=>(
                          <th key={h} style={{padding:'7px 16px',textAlign:'left',fontWeight:600,fontSize:11,color:C.textSec,letterSpacing:'0.04em',textTransform:'uppercase' as const,borderRight:i<a.length-1?`1px solid ${C.border}`:'none',whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(([name,v],rowIdx)=>{
                        const pct = grandTotal>0 ? Math.round(v.totalCost/grandTotal*100) : 0
                        return(
                          <tr key={name} style={{borderTop:`1px solid ${C.border}`,background:rowIdx%2===0?C.surface:C.bg}}>
                            <td style={{padding:'9px 16px',borderRight:`1px solid ${C.border}`,fontWeight:600,color:C.text}}>{name}</td>
                            <td style={{padding:'9px 16px',borderRight:`1px solid ${C.border}`,color:C.textSec,textAlign:'center'}}>{v.totalQty % 1 === 0 ? v.totalQty : v.totalQty.toFixed(1)}</td>
                            <td style={{padding:'9px 16px',borderRight:`1px solid ${C.border}`,color:C.textSec,whiteSpace:'nowrap'}}>{v.unitPrice>0?fmtCur(v.unitPrice):'—'}</td>
                            <td style={{padding:'9px 16px',borderRight:`1px solid ${C.border}`,fontWeight:700,color:'#f59e0b',whiteSpace:'nowrap'}}>{fmtCur(Math.round(v.totalCost))}</td>
                            <td style={{padding:'9px 16px'}}>
                              <div style={{display:'flex',alignItems:'center',gap:8}}>
                                <div style={{flex:1,height:6,background:C.bg,borderRadius:9999,overflow:'hidden',border:`1px solid ${C.border}`}}>
                                  <div style={{height:'100%',width:`${pct}%`,background:'#f59e0b',borderRadius:9999}}/>
                                </div>
                                <span style={{fontSize:11,color:C.textSec,minWidth:28,textAlign:'right'}}>{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:`2px solid ${C.border}`,background:C.bg}}>
                        <td style={{padding:'9px 16px',fontWeight:700,color:C.text,borderRight:`1px solid ${C.border}`}}>Totalt</td>
                        <td style={{padding:'9px 16px',borderRight:`1px solid ${C.border}`}}/>
                        <td style={{padding:'9px 16px',borderRight:`1px solid ${C.border}`}}/>
                        <td style={{padding:'9px 16px',fontWeight:800,color:'#f59e0b',whiteSpace:'nowrap',borderRight:`1px solid ${C.border}`}}>{fmtCur(Math.round(grandTotal))}</td>
                        <td style={{padding:'9px 16px'}}/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            })()}
          </div>
        )
      })()}

      {/* ══ PANEL 3: Månadsdiagram + Munkdiagram ══ */}
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16,marginBottom:16}}>
        <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',overflow:'hidden'}}>
          <div style={{padding:'12px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8}}>
            <i className="fas fa-chart-bar" style={{color:C.primary,fontSize:13}}/>
            <span style={{fontWeight:700,fontSize:13,color:C.text}}>Månadsvis omsättning</span>
          </div>
          <div style={{padding:'16px 20px'}}>
            {(()=>{
              const months=['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec']
              // Månadsdiagram: visa ALL omsättning (aktiva + stängda) för att ge bild av var pengarna är
              const allRevenueJobs=customers.filter((c:any)=>!c.rejected&&(parseFloat(c.price_excl_vat)||0)>0)
              const monthRev=months.map((_,i)=>{
                const m=i+1
                return allRevenueJobs.filter((c:any)=>{
                  const d=c.completed_at?new Date(c.completed_at):c.created_at?new Date(c.created_at):null
                  return d&&d.getMonth()+1===m
                }).reduce((s:number,c:any)=>s+(parseFloat(c.price_excl_vat)||0),0)
              })
              const maxRev=Math.max(...monthRev,1)
              return(
                <div style={{display:'flex',alignItems:'flex-end',gap:isMobile?3:5,height:120,paddingBottom:24,position:'relative'}}>
                  {monthRev.map((rev,i)=>{
                    const pct=rev/maxRev*100
                    return(
                      <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',position:'relative'}}>
                        {rev>0&&<span style={{fontSize:8,color:C.textSec,textAlign:'center',position:'absolute',top:pct>80?0:-14,whiteSpace:'nowrap'}}>{rev>=1000?Math.round(rev/1000)+'k':Math.round(rev)}</span>}
                        <div style={{width:'100%',height:`${Math.max(pct,rev>0?3:0)}%`,background:rev>0?'linear-gradient(180deg,#3b82f6,#6366f1)':'transparent',borderRadius:'3px 3px 0 0',alignSelf:'flex-end'}}/>
                        <span style={{fontSize:isMobile?7:8,color:C.textSec,position:'absolute',bottom:-18}}>{months[i]}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
        <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',overflow:'hidden'}}>
          <div style={{padding:'12px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8}}>
            <i className="fas fa-chart-pie" style={{color:'#8b5cf6',fontSize:13}}/>
            <span style={{fontWeight:700,fontSize:13,color:C.text}}>Tjänstefördelning</span>
          </div>
          <div style={{padding:'16px 20px'}}>
            <DonutChart data={donutData} C={C}/>
          </div>
        </div>
      </div>

      {/* ══ PANEL 4: Stapeldiagram omsättning + tid ══ */}
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16,marginBottom:16}}>
        <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',overflow:'hidden'}}>
          <div style={{padding:'12px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8}}>
            <i className="fas fa-coins" style={{color:'#10b981',fontSize:13}}/>
            <span style={{fontWeight:700,fontSize:13,color:C.text}}>Omsättning per tjänst</span>
          </div>
          <div style={{padding:'16px 20px'}}>
            {Object.keys(svcRev).length===0
              ?<div style={{textAlign:'center',padding:24,color:C.textSec,fontSize:13}}>Inga data</div>
              :(()=>{
                const entries=Object.entries(svcRev)
                const maxVal=Math.max(...entries.map(([,v])=>v as number),1)
                return(
                  <div style={{display:'flex',alignItems:'flex-end',gap:isMobile?6:10,height:130,paddingBottom:28,position:'relative'}}>
                    {entries.map(([svc,rev])=>{
                      const pct=(rev as number)/maxVal*100
                      return(
                        <div key={svc} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',position:'relative'}}>
                          <span style={{fontSize:9,color:C.textSec,textAlign:'center',position:'absolute',top:pct>80?0:-14,whiteSpace:'nowrap'}}>{(rev as number)>=1000?Math.round((rev as number)/1000)+'k':Math.round(rev as number)}</span>
                          <div style={{width:'100%',height:`${Math.max(pct,3)}%`,background:svcColors[svc]||'#94a3b8',borderRadius:'3px 3px 0 0',alignSelf:'flex-end'}}/>
                          <span style={{fontSize:isMobile?8:9,color:C.textSec,position:'absolute',bottom:-20,textAlign:'center',maxWidth:48,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{svcLabel(svc)}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()
            }
          </div>
        </div>
        <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',overflow:'hidden'}}>
          <div style={{padding:'12px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8}}>
            <i className="fas fa-clock" style={{color:'#f59e0b',fontSize:13}}/>
            <span style={{fontWeight:700,fontSize:13,color:C.text}}>Tidslogg per tjänst (tim)</span>
          </div>
          <div style={{padding:'16px 20px'}}>
            {Object.keys(svcTime).length===0
              ?<div style={{textAlign:'center',padding:24,color:C.textSec,fontSize:13}}>Logga tid per tjänst för att se data</div>
              :(()=>{
                const entries=Object.entries(svcTime)
                const maxVal=Math.max(...entries.map(([,v])=>v as number),1)
                return(
                  <div style={{display:'flex',alignItems:'flex-end',gap:isMobile?6:10,height:130,paddingBottom:28,position:'relative'}}>
                    {entries.map(([svc,mins])=>{
                      const pct=(mins as number)/maxVal*100,hrs=Math.round((mins as number)/60*10)/10
                      return(
                        <div key={svc} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',position:'relative'}}>
                          <span style={{fontSize:9,color:C.textSec,textAlign:'center',position:'absolute',top:pct>80?0:-14,whiteSpace:'nowrap'}}>{hrs}h</span>
                          <div style={{width:'100%',height:`${Math.max(pct,3)}%`,background:svcColors[svc]||'#94a3b8',borderRadius:'3px 3px 0 0',alignSelf:'flex-end',opacity:0.85}}/>
                          <span style={{fontSize:isMobile?8:9,color:C.textSec,position:'absolute',bottom:-20,textAlign:'center',maxWidth:48,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{svcLabel(svc)}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()
            }
          </div>
        </div>
      </div>

      {/* ══ PANEL 5: KVM per tjänst + Top-5 ══ */}
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16,marginBottom:16}}>
        <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',overflow:'hidden'}}>
          <div style={{padding:'12px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8}}>
            <i className="fas fa-ruler-combined" style={{color:'#06b6d4',fontSize:13}}/>
            <span style={{fontWeight:700,fontSize:13,color:C.text}}>Kvm per tjänst</span>
          </div>
          <div style={{padding:'16px 20px'}}>
            {Object.keys(kvmBySvc).length===0
              ?<div style={{textAlign:'center',padding:24,color:C.textSec,fontSize:13}}>Ingen kvm-data</div>
              :(()=>{
                const entries=Object.entries(kvmBySvc)
                return(
                  <div style={{display:'flex',alignItems:'flex-end',gap:isMobile?6:10,height:130,paddingBottom:28,position:'relative'}}>
                    {entries.map(([svc,kvm])=>{
                      const pct=(kvm as number)/maxKvm*100
                      return(
                        <div key={svc} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',position:'relative'}}>
                          <span style={{fontSize:9,color:C.textSec,textAlign:'center',position:'absolute',top:pct>80?0:-14,whiteSpace:'nowrap'}}>{Math.round(kvm as number)}</span>
                          <div style={{width:'100%',height:`${Math.max(pct,3)}%`,background:'linear-gradient(180deg,#06b6d4,#0891b2)',borderRadius:'3px 3px 0 0',alignSelf:'flex-end'}}/>
                          <span style={{fontSize:isMobile?8:9,color:C.textSec,position:'absolute',bottom:-20,textAlign:'center',maxWidth:48,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{svcLabel(svc)}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()
            }
          </div>
        </div>
        <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',overflow:'hidden'}}>
          <div style={{padding:'12px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8}}>
            <i className="fas fa-trophy" style={{color:'#f59e0b',fontSize:13}}/>
            <span style={{fontWeight:700,fontSize:13,color:C.text}}>Top 5 – bäst timlön per jobb</span>
          </div>
          <div style={{padding:'12px 16px'}}>
            {top5.length===0
              ?<div style={{textAlign:'center',padding:24,color:C.textSec,fontSize:13}}>Logga tid på avslutade jobb för att se ranking</div>
              :top5.map((t:any,i:number)=>(
                <div key={t.name} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 12px',borderRadius:8,background:i%2===0?C.bg:C.surface,marginBottom:4,border:`1px solid ${C.border}`}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:18,minWidth:24}}>{medals[i]}</span>
                    <div>
                      <div style={{fontSize:isMobile?12:13,fontWeight:600,color:C.text,maxWidth:isMobile?100:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.name}</div>
                      <div style={{fontSize:10,color:C.textSec}}>{fmtMins(t.mins)}</div>
                    </div>
                  </div>
                  <span style={{fontSize:isMobile?13:14,fontWeight:800,color:i===0?'#f59e0b':i===1?'#94a3b8':i===2?'#b45309':C.textSec,whiteSpace:'nowrap'}}>{fmtCur(t.kr_h)}/h</span>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* ══ PANEL 6: Ärendeöversikt ══ */}
      <div style={{background:C.surface,borderRadius:16,boxShadow:'0 2px 8px rgba(0,0,0,0.07)',overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'12px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:8}}>
          <i className="fas fa-folder-open" style={{color:C.primary,fontSize:13}}/>
          <span style={{fontWeight:700,fontSize:13,color:C.text}}>Ärendeöversikt</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(4,1fr)'}}>
          {([
            ['fas fa-star',        'Nya',            customers.filter((c:any)=>getStatus(c)==='new').length,         '#f59e0b'],
            ['fas fa-spinner',     'Öppnade',        customers.filter((c:any)=>getStatus(c)==='in_progress').length, '#3b82f6'],
            ['fas fa-check-circle','Stängda',        completedJobs.length,                                           '#10b981'],
            ['fas fa-times-circle','Ej Accepterade', customers.filter((c:any)=>c.rejected).length,                  '#ef4444'],
          ] as [string,string,number,string][]).map(([icon,label,count,color],idx,arr)=>(
            <div key={label} style={{padding:isMobile?'14px 16px':'18px 20px',borderRight:idx<arr.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:38,height:38,borderRadius:10,background:`${color}18`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <i className={icon} style={{fontSize:16,color}}/>
              </div>
              <div>
                <div style={{fontSize:isMobile?20:26,fontWeight:800,color,lineHeight:1}}>{count}</div>
                <div style={{fontSize:11,color:C.textSec,marginTop:2}}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>



      

    </div>
  )
}
