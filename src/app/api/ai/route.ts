import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const KEY_MAP: Record<string, string> = {
  'stentvätt': 'stentvatt', 'stentvatt': 'stentvatt',
  'altantvätt': 'altantvatt', 'altantvatt': 'altantvatt',
  'asfaltstvätt': 'asfaltstvatt', 'asfaltstvatt': 'asfaltstvatt',
  'fasadtvätt': 'fasadtvatt', 'fasadtvatt': 'fasadtvatt',
  'taktvätt': 'taktvatt', 'taktvatt': 'taktvatt',
}
function normKey(raw: string): string {
  return KEY_MAP[raw.toLowerCase().trim()] ?? raw.toLowerCase().trim()
}
function buildProgress(services: string[]): Record<string, number> {
  const p: Record<string, number> = {}
  for (const s of services) p[normKey(s)] = 0
  return p
}
function fmtMins(m: number): string {
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

async function findDoc(idOrName: string, preferCol: string) {
  try {
    const snap = await adminDb.collection(preferCol).doc(idOrName).get()
    if (snap.exists) return { ref: snap.ref, data: snap.data()! }
  } catch (_) {}
  const s1 = await adminDb.collection(preferCol).get()
  const h1 = s1.docs.find(d => String(d.data().name ?? '').toLowerCase().includes(idOrName.toLowerCase()))
  if (h1) return { ref: h1.ref, data: h1.data() }
  const other = preferCol === 'customers' ? 'maintenance_contracts' : 'customers'
  const s2 = await adminDb.collection(other).get()
  const h2 = s2.docs.find(d => String(d.data().name ?? '').toLowerCase().includes(idOrName.toLowerCase()))
  if (h2) return { ref: h2.ref, data: h2.data() }
  return null
}

async function loadMemory(): Promise<string> {
  try {
    const snap = await adminDb.collection('ai_memory').doc('global').get()
    if (!snap.exists) return ''
    const data = snap.data() as Record<string, string>
    const lines = Object.entries(data).filter(([k]) => k !== 'updated_at').map(([k, v]) => `${k}: ${v}`)
    return lines.length ? `\n\nKänd information:\n${lines.join('\n')}` : ''
  } catch { return '' }
}
async function saveMemoryFact(key: string, value: string) {
  await adminDb.collection('ai_memory').doc('global').set({ [key]: value, updated_at: new Date().toISOString() }, { merge: true })
}

type Msg = { role: string; content: string }
async function loadHistory(sessionId: string): Promise<Msg[]> {
  try {
    const snap = await adminDb.collection('ai_sessions').doc(sessionId).get()
    if (!snap.exists) return []
    return ((snap.data()?.messages ?? []) as Msg[]).filter(m => typeof m.content === 'string' && m.content.length < 5000)
  } catch { return [] }
}
async function saveHistory(sessionId: string, msgs: Msg[]) {
  await adminDb.collection('ai_sessions').doc(sessionId).set(
    { messages: msgs.slice(-40), updated_at: new Date().toISOString() }, { merge: false }
  )
}

const tools: Anthropic.Tool[] = [
  {
    name: 'get_customers',
    description: 'Hämta kundlista.',
    input_schema: { type: 'object' as const, properties: { status: { type: 'string', enum: ['active', 'completed', 'all'] } }, required: [] },
  },
  {
    name: 'find_person_by_name',
    description: 'Sök person i customers och maintenance_contracts. Kör ALLTID innan create_customer och add_to_maintenance_contracts.',
    input_schema: { type: 'object' as const, properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'create_customer',
    description: 'Skapa ny kund. EJ vid underhållsavtal. Kör find_person_by_name FÖRST.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
        address: { type: 'string' }, note: { type: 'string' }, price: { type: 'number' },
        services: { type: 'array', items: { type: 'string' }, description: 'stentvatt|altantvatt|asfaltstvatt|fasadtvatt|taktvatt' },
        include_fogsand: { type: 'boolean' }, kvm: { type: 'number' }, service_kvm: { type: 'object' },
      },
      required: ['name', 'services'],
    },
  },
  {
    name: 'add_to_maintenance_contracts',
    description: 'Lägg till i underhållsavtal. ALDRIG create_customer för underhåll.',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' }, amount: { type: 'number' }, note: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'add_service_to_customer',
    description: 'Lägg till tjänst på kund.',
    input_schema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'Personens namn eller Firestore-ID' },
        service: { type: 'string', description: 'stentvatt|altantvatt|asfaltstvatt|fasadtvatt|taktvatt' },
        kvm: { type: 'number' }, include_fogsand: { type: 'boolean' },
      },
      required: ['customer_id', 'service', 'kvm'],
    },
  },
  {
    name: 'update_person',
    description: 'Uppdatera en persons uppgifter. doc_id = personens NAMN.',
    input_schema: {
      type: 'object' as const,
      properties: {
        doc_id: { type: 'string', description: 'Personens namn' },
        collection: { type: 'string', enum: ['customers', 'maintenance_contracts'] },
        address: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
        note: { type: 'string' }, price: { type: 'number' }, name: { type: 'string' },
        kvm: { type: 'number' }, amount: { type: 'number' },
      },
      required: ['doc_id', 'collection'],
    },
  },
  {
    name: 'add_note',
    description: 'Lägg till textanteckning på en kund. Ej för tidloggning.',
    input_schema: {
      type: 'object' as const,
      properties: { customer_id: { type: 'string', description: 'Personens namn eller Firestore-ID' }, note: { type: 'string' } },
      required: ['customer_id', 'note'],
    },
  },
  {
    name: 'log_time',
    description: 'Logga arbetad tid på en kund. Använd ALLTID denna för tidrapportering.',
    input_schema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'Personens namn eller Firestore-ID' },
        hours: { type: 'number', description: 'Antal timmar som decimal, t.ex. 0.17 för 10 min' },
        moment: { type: 'string', description: '"Admin" för adminarbete, annars t.ex. "Stentvätt - Hembesök"' },
        date: { type: 'string', description: 'Datum YYYY-MM-DD' },
        worker: { type: 'string' },
      },
      required: ['customer_id', 'hours', 'moment'],
    },
  },
  {
    name: 'get_stats',
    description: 'Hämta statistik.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'save_memory',
    description: 'Spara ett faktum för framtida samtal.',
    input_schema: { type: 'object' as const, properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
  },
  {
    name: 'add_to_2025',
    description: 'Lägg till ett avslutat jobb i Arbeten 2025 (customers_2025). Används vid "lägg till i 2025" eller "spara i arbeten 2025".',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Kundens namn' },
        service: { type: 'string', description: 'stentvatt|altantvatt|asfaltstvatt|fasadtvatt|taktvatt|ovrigt' },
        kvm: { type: 'number' }, hours: { type: 'number', description: 'Antal timmar som decimal' }, pris: { type: 'number', description: 'Pris i SEK' },
      },
      required: ['name', 'service', 'kvm', 'hours', 'pris'],
    },
  },
  {
    name: 'delete_customer',
    description: 'Ta bort en kund permanent. Bekräfta med användaren (confirmed: false → confirmed: true).',
    input_schema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'Personens namn eller Firestore-ID' },
        confirmed: { type: 'boolean', description: 'true = användaren har bekräftat' },
      },
      required: ['customer_id', 'confirmed'],
    },
  },
  {
    name: 'get_customer_status',
    description: 'Hämta fullständig processtatus för en namngiven kund. Returnerar service_progress (nuvarande steg per tjänst) och service_kvm. ANVÄND ALLTID detta tool när användaren frågar var en specifik kund är i processen.',
    input_schema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'Personens namn eller Firestore-ID' },
      },
      required: ['customer_id'],
    },
  },
]

async function executeFunction(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'get_customers': {
        const status = (args.status as string) ?? 'all'
        let q = adminDb.collection('customers') as FirebaseFirestore.Query
        if (status !== 'all') q = q.where('status', '==', status)
        const snap = await q.orderBy('created_at', 'desc').limit(100).get()
        return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      }
      case 'find_person_by_name': {
        const q = String(args.name ?? '').toLowerCase()
        const [c, m] = await Promise.all([adminDb.collection('customers').get(), adminDb.collection('maintenance_contracts').get()])
        const res = [
          ...c.docs.filter(d => String(d.data().name ?? '').toLowerCase().includes(q)).map(d => ({ id: d.id, collection: 'customers', ...d.data() })),
          ...m.docs.filter(d => String(d.data().name ?? '').toLowerCase().includes(q)).map(d => ({ id: d.id, collection: 'maintenance_contracts', ...d.data() })),
        ]
        return res.length ? res : { error: 'Ingen person hittades.' }
      }
      case 'create_customer': {
        const services = ((args.services as string[]) ?? ['stentvatt']).map(normKey)
        const kvm = Number(args.kvm ?? 0)
        const rawKvm = (args.service_kvm as Record<string, number>) ?? {}
        const service_kvm: Record<string, number> = {}
        for (const s of services) service_kvm[s] = rawKvm[s] ?? kvm
        const docData = {
          name: String(args.name ?? ''), phone: String(args.phone ?? ''), email: String(args.email ?? ''),
          address: String(args.address ?? ''), note: String(args.note ?? ''), price_excl_vat: args.price ?? null,
          services, include_fogsand: Boolean(args.include_fogsand ?? false), service_kvm,
          service_progress: buildProgress(services), skipped_steps: {}, status: 'new', rejected: false,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }
        const ref = await adminDb.collection('customers').add(docData)
        await adminDb.collection('activity_logs').add({ customer_id: ref.id, customer_name: docData.name, log_type: 'customer_created', content: `Kund skapad: ${docData.name} – ${services.join(', ')}`, timestamp: new Date().toISOString() })
        return { success: true, customer_id: ref.id, name: docData.name, services }
      }
      case 'add_to_maintenance_contracts': {
        const docData = { name: String(args.name ?? ''), phone: String(args.phone ?? ''), email: String(args.email ?? ''), address: String(args.address ?? ''), amount: Number(args.amount ?? 0), note: String(args.note ?? ''), created_at: new Date().toISOString() }
        const ref = await adminDb.collection('maintenance_contracts').add(docData)
        return { success: true, contract_id: ref.id, name: docData.name }
      }
      case 'add_service_to_customer': {
        const svc = normKey(String(args.service ?? ''))
        const kvm = Number(args.kvm ?? 0)
        const include_fogsand = Boolean(args.include_fogsand ?? false)
        const found = await findDoc(String(args.customer_id ?? ''), 'customers')
        if (!found) return { error: `Hittade ingen kund med "${args.customer_id}".` }
        const services: string[] = Array.isArray(found.data.services) ? [...found.data.services] : []
        if (services.includes(svc)) return { error: `Kunden har redan "${svc}".` }
        const sp: Record<string, number> = found.data.service_progress ?? {}
        const sk: Record<string, number> = found.data.service_kvm ?? {}
        services.push(svc); sk[svc] = kvm; sp[svc] = 0
        await found.ref.update({ services, service_kvm: sk, service_progress: sp, include_fogsand: svc === 'stentvatt' ? include_fogsand : (found.data.include_fogsand ?? false), updated_at: new Date().toISOString() })
        return { success: true, added_service: svc }
      }
      case 'update_person': {
        const rawId = String(args.doc_id ?? '')
        const col = String(args.collection ?? 'customers')
        const UPDATABLE = ['address', 'phone', 'email', 'note', 'price', 'price_excl_vat', 'name', 'kvm', 'amount']
        const fields: Record<string, unknown> = {}
        for (const k of UPDATABLE) { if (args[k] !== undefined && args[k] !== null) fields[k] = args[k] }
        if (Object.keys(fields).length === 0) return { error: 'Inga fält skickades.' }
        const found = await findDoc(rawId, col)
        if (!found) return { error: `Hittade ingen person med "${rawId}".` }
        await found.ref.update({ ...fields, updated_at: new Date().toISOString() })
        const after = (await found.ref.get()).data()!
        return { success: true, updated_fields: Object.keys(fields), now: { name: after.name, address: after.address, phone: after.phone, email: after.email } }
      }
      case 'add_note': {
        const note = String(args.note ?? '')
        const found = await findDoc(String(args.customer_id ?? ''), 'customers')
        if (!found) return { error: `Hittade ingen kund med "${args.customer_id}".` }
        await found.ref.update({ note, updated_at: new Date().toISOString() })
        await adminDb.collection('activity_logs').add({ customer_id: found.ref.id, log_type: 'comment', content: `Anteckning: ${note}`, timestamp: new Date().toISOString() })
        return { success: true }
      }
      case 'log_time': {
        const customerId = String(args.customer_id ?? '')
        const hours = Number(args.hours ?? 0)
        const moment = String(args.moment ?? 'Admin')
        const date = String(args.date ?? new Date().toISOString().slice(0, 10))
        const worker = String(args.worker ?? '')
        if (hours <= 0) return { error: 'Antal timmar måste vara större än 0.' }
        const found = await findDoc(customerId, 'customers')
        if (!found) return { error: `Hittade ingen kund med "${customerId}".` }
        const timeSpentMins = Math.round(hours * 60)
        await adminDb.collection('activity_logs').add({
          customer_id: found.ref.id, customer_name: String(found.data.name ?? ''), log_type: 'time_log',
          moment, time_spent: timeSpentMins, date,
          content: `${moment}: ${fmtMins(timeSpentMins)}${worker ? ` (${worker})` : ''}`,
          timestamp: new Date().toISOString(),
        })
        return { success: true, customer_name: found.data.name, time_spent_mins: timeSpentMins, moment, date }
      }
      case 'get_stats': {
        const [c, m] = await Promise.all([adminDb.collection('customers').get(), adminDb.collection('maintenance_contracts').get()])
        const custs = c.docs.map(d => d.data())
        const svcCount: Record<string, number> = {}
        for (const cu of custs) { for (const s of (cu.services as string[]) ?? []) { svcCount[s] = (svcCount[s] ?? 0) + 1 } }
        return { total: custs.length, active: custs.filter(c => !c.rejected).length, completed: custs.filter(c => c.status === 'completed').length, revenue: custs.reduce((s, c) => s + (Number(c.price_excl_vat || c.price) || 0), 0), services: svcCount, maintenance_contracts: m.docs.length }
      }
      case 'save_memory': {
        await saveMemoryFact(String(args.key ?? ''), String(args.value ?? ''))
        return { success: true }
      }
      case 'add_to_2025': {
        const svc = normKey(String(args.service ?? 'ovrigt'))
        const kvm = Number(args.kvm ?? 0); const hours = Number(args.hours ?? 0); const pris = Number(args.pris ?? 0); const name = String(args.name ?? '')
        if (!name) return { error: 'Namn saknas.' }
        if (kvm <= 0) return { error: 'Ange giltigt kvm.' }
        if (hours <= 0) return { error: 'Ange giltig tid.' }
        const tidMins = Math.round(hours * 60)
        const ref = await adminDb.collection('customers_2025').add({ name, service: svc, kvm, tid: tidMins, pris, created_at: new Date().toISOString() })
        return { success: true, job_id: ref.id, name, service: svc, kvm, tid_mins: tidMins, pris }
      }
      case 'get_customer_status': {
        const found = await findDoc(String(args.customer_id ?? ''), 'customers')
        if (!found) return { error: `Hittade ingen kund med "${args.customer_id}".` }
        const d = found.data
        const services: string[] = Array.isArray(d.services) ? d.services : []
        const service_progress: Record<string, unknown> = d.service_progress ?? {}
        const service_kvm: Record<string, unknown> = d.service_kvm ?? {}
        // Build human-readable step labels per service
        const SERVICE_STEPS_MAP: Record<string, string[]> = {
          stentvatt: ['Ej påbörjad','Inbokat hembesök','Hembesök','Offert','Bokat','Stentvätt','Impregnering','Fogsand','Fakturerad'],
          altantvatt: ['Ej påbörjad','Inbokat hembesök','Hembesök','Offert','Bokat','Altantvätt','Efterbehandling','Fakturerad'],
          asfaltstvatt: ['Ej påbörjad','Inbokat hembesök','Hembesök','Offert','Bokat','Asfaltstvätt','Fakturerad'],
          fasadtvatt: ['Ej påbörjad','Inbokat hembesök','Hembesök','Offert','Bokat','Fasadtvätt','Impregnering','Fakturerad'],
          taktvatt: ['Ej påbörjad','Inbokat hembesök','Hembesök','Offert','Bokat','Taktvätt','Behandling','Fakturerad'],
        }
        const stepInfo: Record<string, { step_index: number; step_label: string; total_steps: number; kvm: unknown }> = {}
        for (const svc of services) {
          const steps = SERVICE_STEPS_MAP[svc] ?? []
          const idx = Number(service_progress[svc] ?? 0)
          stepInfo[svc] = { step_index: idx, step_label: steps[idx] ?? 'Okänt steg', total_steps: steps.length, kvm: service_kvm[svc] ?? 0 }
        }
        return { customer_id: found.ref.id, name: d.name, services, service_progress, service_kvm, step_info: stepInfo, rejected: d.rejected ?? false, status: d.status ?? 'new' }
      }
      case 'delete_customer': {
        const customerId = String(args.customer_id ?? ''); const confirmed = Boolean(args.confirmed ?? false)
        if (!confirmed) { const found = await findDoc(customerId, 'customers'); const displayName = found?.data.name ?? customerId; return { needs_confirmation: true, message: `Vill du verkligen ta bort "${displayName}" permanent? Svara "ja, ta bort" för att bekräfta.` } }
        const found = await findDoc(customerId, 'customers')
        if (!found) return { error: `Hittade ingen kund med "${customerId}".` }
        const customerName = String(found.data.name ?? customerId)
        await found.ref.delete()
        const logsSnap = await adminDb.collection('activity_logs').where('customer_id', '==', found.ref.id).get()
        const deleteBatch = adminDb.batch(); logsSnap.docs.forEach(d => deleteBatch.delete(d.ref))
        if (logsSnap.docs.length > 0) await deleteBatch.commit()
        return { success: true, deleted_name: customerName, logs_deleted: logsSnap.docs.length }
      }
      default: return { error: `Okänd funktion: ${name}` }
    }
  } catch (err: any) {
    console.error(`[ERROR] ${name}:`, err.message)
    return { error: `Fel: ${err.message}` }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ── PDF-extraktion (action: 'pdf') ──
    if (body.action === 'pdf') {
      const pdfBase64 = String(body.pdfBase64 ?? '')
      const customerId = String(body.customerId ?? '')
      if (!pdfBase64) return NextResponse.json({ error: 'pdfBase64 saknas' }, { status: 400 })
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } } as any,
            { type: 'text', text: 'Analysera denna offert-PDF för ett ytrengöringsföretag. Extrahera: 1) ALLA materialposter, 2) Totalpris exkl moms. Returnera ENBART giltig JSON: {"material_items":[{"name":"Materialnamn","qty":1,"unit_price":100}],"total_price_excl_vat":12500}. För material: inkludera ENBART produkter/material, INTE arbete/tjänster. För priset: leta efter "totalt exkl moms", "nettopris", "pris exkl moms" eller liknande. Om inget pris hittas sätt total_price_excl_vat till 0.' }
          ]
        }],
      })
      const tb = response.content.find((b: any) => b.type === 'text') as any
      if (!tb) return NextResponse.json({ material_items: [] })
      const match = tb.text.match(/\{[\s\S]*"material_items"[\s\S]*\}/)
      if (!match) return NextResponse.json({ material_items: [] })
      const parsed = JSON.parse(match[0])
      const material_items = (parsed.material_items ?? []).map((i: any) => ({
        name: String(i.name ?? ''), qty: Number(i.qty ?? 1), unit_price: Number(i.unit_price ?? 0)
      }))
      const total_price_excl_vat = Number(parsed.total_price_excl_vat ?? 0)
      return NextResponse.json({ material_items, total_price_excl_vat, customer_id: customerId })
    }

    const userMessage = String(body.message ?? body.messages?.[body.messages?.length - 1]?.content ?? '')
    const sessionId = String(body.sessionId ?? 'default')
    const hasImage = Boolean(body.hasImage ?? false)
    const imageUrl = String(body.imageUrl ?? '')

    const [memory, history] = await Promise.all([loadMemory(), loadHistory(sessionId)])

    const systemPrompt = `Du är en kraftfull AI-assistent för HTY Rengöring som kan ALLT som rör företaget.

REGLER:
1. Agera direkt utan att fråga "Vill du att jag ska...?"
2. update_person: skicka personens NAMN som doc_id
3. add_service_to_customer och add_note: skicka personens NAMN som customer_id
4. Kör find_person_by_name INNAN create_customer och add_to_maintenance_contracts
5. "Underhållsavtal/årligt underhåll" → ENDAST add_to_maintenance_contracts
6. Service-nycklar: stentvatt | altantvatt | asfaltstvatt | fasadtvatt | taktvatt
7. Fråga om kvm om det saknas. Fråga om fogsand vid stentvatt
8. save_memory för viktiga fakta om företaget och kunder
9. Tidrapportering → ALLTID log_time (hours som decimal: 10min=0.17, 1h=1.0)
10. "Arbeten 2025" → ALLTID add_to_2025
11. Ta bort kund → delete_customer, bekräfta ALLTID
12. När användaren frågar var en kund är i processen → kör get_customer_status med kundens namn
13. get_stats → kör för att visa omsättning, antal kunder, statistik
14. Svara ALLTID på svenska
15. Vid sök efter kund: kör find_person_by_name FÖRST, visa sedan all info inklusive processteg

TJÄNSTESTEG (visa dessa när du förklarar status):
• stentvatt (med fogsand): Ej påbörjad → Inbokat hembesök → Hembesök → Offert → Bokat → Stentvätt → Impregnering → Fogsand → Fakturerad
• stentvatt (utan fogsand): Ej påbörjad → Inbokat hembesök → Hembesök → Offert → Bokat → Stentvätt → Impregnering → Fakturerad
• altantvatt: Ej påbörjad → Inbokat hembesök → Hembesök → Offert → Bokat → Altantvätt → Efterbehandling → Fakturerad
• asfaltstvatt: Ej påbörjad → Inbokat hembesök → Hembesök → Offert → Bokat → Asfaltstvätt → Fakturerad
${memory}`

    // Build messages for Claude: start with history then current user message
    const claudeMessages: Anthropic.MessageParam[] = [
      ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ]

    // Build current user content (with optional image)
    const userContent: Anthropic.MessageParam['content'] = hasImage && imageUrl
      ? [
          { type: 'image' as const, source: { type: 'url' as const, url: imageUrl } },
          { type: 'text' as const, text: userMessage || 'Läs av bilden.' },
        ]
      : userMessage

    claudeMessages.push({ role: 'user', content: userContent })

    const actions: unknown[] = []
    let totalInput = 0, totalOutput = 0

    // Agentic loop
    for (let round = 0; round < 6; round++) {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 2048,
        system: systemPrompt,
        tools,
        messages: claudeMessages,
      })
      totalInput += response.usage.input_tokens
      totalOutput += response.usage.output_tokens
      claudeMessages.push({ role: 'assistant', content: response.content })
      if (response.stop_reason !== 'tool_use') break

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const result = await executeFunction(block.name, block.input as Record<string, unknown>)
        actions.push({ function: block.name, args: block.input, result })
        toolResultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      }
      claudeMessages.push({ role: 'user', content: toolResultBlocks })
    }

    // Extract reply
    let reply = ''
    const lastA = [...claudeMessages].reverse().find(m => m.role === 'assistant')
    if (lastA && Array.isArray(lastA.content)) {
      const tb = (lastA.content as Anthropic.ContentBlock[]).find(b => b.type === 'text')
      if (tb && tb.type === 'text') reply = tb.text
    } else if (typeof lastA?.content === 'string') {
      reply = lastA.content
    }

    // Save history (text-only messages)
    await saveHistory(sessionId, claudeMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as string,
        content: Array.isArray(m.content)
          ? (m.content as any[]).filter(b => b.type === 'text').map((b: any) => b.text).join(' ')
          : typeof m.content === 'string' ? m.content : '',
      }))
      .filter(m => m.content.trim().length > 0 && m.content.length < 5000)
    )

    return NextResponse.json({ reply, actions, model: 'claude-opus-4-5-20251101', usage: { prompt: totalInput, completion: totalOutput } })
  } catch (err: any) {
    console.error('[AI Route Error]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
