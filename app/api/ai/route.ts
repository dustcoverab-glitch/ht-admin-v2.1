import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

async function findDoc(idOrName: string, preferCol: string) {
  try {
    const snap = await adminDb.collection(preferCol).doc(idOrName).get()
    if (snap.exists) return { ref: snap.ref, data: snap.data()! }
  } catch (_) { /* ogiltigt ID-format */ }

  const s1 = await adminDb.collection(preferCol).get()
  const h1 = s1.docs.find(d =>
    String(d.data().name ?? '').toLowerCase().includes(idOrName.toLowerCase())
  )
  if (h1) return { ref: h1.ref, data: h1.data() }

  const other = preferCol === 'customers' ? 'maintenance_contracts' : 'customers'
  const s2 = await adminDb.collection(other).get()
  const h2 = s2.docs.find(d =>
    String(d.data().name ?? '').toLowerCase().includes(idOrName.toLowerCase())
  )
  if (h2) return { ref: h2.ref, data: h2.data() }

  return null
}

async function loadMemory(): Promise<string> {
  try {
    const snap = await adminDb.collection('ai_memory').doc('global').get()
    if (!snap.exists) return ''
    const data = snap.data() as Record<string, string>
    const lines = Object.entries(data)
      .filter(([k]) => k !== 'updated_at')
      .map(([k, v]) => `${k}: ${v}`)
    return lines.length ? `\n\nKänd information:\n${lines.join('\n')}` : ''
  } catch { return '' }
}

async function saveMemoryFact(key: string, value: string) {
  await adminDb.collection('ai_memory').doc('global').set(
    { [key]: value, updated_at: new Date().toISOString() },
    { merge: true }
  )
}

type Msg = { role: string; content: string }

async function loadHistory(sessionId: string): Promise<Msg[]> {
  try {
    const snap = await adminDb.collection('ai_sessions').doc(sessionId).get()
    if (!snap.exists) return []
    return ((snap.data()?.messages ?? []) as Msg[]).filter(
      m => typeof m.content === 'string' && m.content.length < 5000
    )
  } catch { return [] }
}

async function saveHistory(sessionId: string, msgs: Msg[]) {
  await adminDb.collection('ai_sessions').doc(sessionId).set(
    { messages: msgs.slice(-40), updated_at: new Date().toISOString() },
    { merge: false }
  )
}

function fmtMins(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${h}h ${min}m`
}

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_customers',
      description: 'Hämta kundlista.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['active', 'completed', 'all'] } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_person_by_name',
      description:
        'Sök person i customers och maintenance_contracts. Kör ALLTID innan create_customer och add_to_maintenance_contracts.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_customer',
      description: 'Skapa ny kund. EJ vid underhållsavtal. Kör find_person_by_name FÖRST.',
      parameters: {
        type: 'object',
        properties: {
          name:            { type: 'string' },
          phone:           { type: 'string' },
          email:           { type: 'string' },
          address:         { type: 'string' },
          note:            { type: 'string' },
          price:           { type: 'number' },
          services:        {
            type: 'array',
            items: { type: 'string' },
            description: 'stentvatt|altantvatt|asfaltstvatt|fasadtvatt|taktvatt',
          },
          include_fogsand: { type: 'boolean' },
          kvm:             { type: 'number' },
          service_kvm:     { type: 'object' },
        },
        required: ['name', 'services'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_to_maintenance_contracts',
      description: 'Lägg till i underhållsavtal. ALDRIG create_customer för underhåll.',
      parameters: {
        type: 'object',
        properties: {
          name:    { type: 'string' },
          phone:   { type: 'string' },
          email:   { type: 'string' },
          address: { type: 'string' },
          amount:  { type: 'number' },
          note:    { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_service_to_customer',
      description:
        'Lägg till tjänst på kund. customer_id = personens namn eller Firestore-ID.',
      parameters: {
        type: 'object',
        properties: {
          customer_id:     { type: 'string', description: 'Personens namn eller Firestore-ID' },
          service:         {
            type: 'string',
            description: 'stentvatt|altantvatt|asfaltstvatt|fasadtvatt|taktvatt',
          },
          kvm:             { type: 'number' },
          include_fogsand: { type: 'boolean' },
        },
        required: ['customer_id', 'service', 'kvm'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_person',
      description:
        'Uppdatera en persons uppgifter. doc_id = personens NAMN – systemet hittar rätt dokument automatiskt. Fyll i bara de fält som ska ändras.',
      parameters: {
        type: 'object',
        properties: {
          doc_id:     { type: 'string',  description: 'Personens namn, t.ex. "Herman Lindén"' },
          collection: { type: 'string',  enum: ['customers', 'maintenance_contracts'] },
          address:    { type: 'string',  description: 'Ny adress' },
          phone:      { type: 'string',  description: 'Nytt telefonnummer' },
          email:      { type: 'string',  description: 'Ny e-post' },
          note:       { type: 'string',  description: 'Ny anteckning' },
          price:      { type: 'number',  description: 'Nytt pris i SEK' },
          name:       { type: 'string',  description: 'Nytt namn' },
          kvm:        { type: 'number',  description: 'Ny kvm' },
          amount:     { type: 'number',  description: 'Nytt belopp (underhållsavtal)' },
        },
        required: ['doc_id', 'collection'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description:
        'Lägg till en textanteckning på en kund. Använd INTE för tidloggning – använd log_time för det.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'string', description: 'Personens namn eller Firestore-ID' },
          note:        { type: 'string' },
        },
        required: ['customer_id', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_time',
      description:
        'Logga arbetad tid på en kund. Använd ALLTID denna för tidrapportering – ALDRIG add_note.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: {
            type: 'string',
            description: 'Personens namn eller Firestore-ID',
          },
          hours: {
            type: 'number',
            description: 'Antal timmar som decimal, t.ex. 0.17 för 10 min, 1.5 för 1h 30min',
          },
          moment: {
            type: 'string',
            description:
              'Välj ett av: "Admin" | "Stentvätt - Hembesök" | "Stentvätt - Provtvätt" | "Stentvätt - Offert" | "Stentvätt - Stentvätt" | "Stentvätt - Impregnering" | "Stentvätt - Fogsand" | "Altantvätt - Hembesök" | "Altantvätt - Offert" | "Altantvätt - Altantvätt" | "Altantvätt - Efterbehandling" | "Asfaltstvätt - Hembesök" | "Asfaltstvätt - Offert" | "Asfaltstvätt - Asfaltstvätt". Vid admin-arbete: "Admin".',
          },
          date: {
            type: 'string',
            description: 'Datum YYYY-MM-DD, lämna tomt för dagens datum',
          },
          worker: {
            type: 'string',
            description: 'Vem som utförde jobbet (valfritt)',
          },
        },
        required: ['customer_id', 'hours', 'moment'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stats',
      description: 'Hämta statistik.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Spara ett faktum för framtida samtal.',
      parameters: {
        type: 'object',
        properties: {
          key:   { type: 'string' },
          value: { type: 'string' },
        },
        required: ['key', 'value'],
      },
    },
  },

  // ── NY: add_to_2025 ────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'add_to_2025',
      description:
        'Lägg till ett avslutat jobb i Arbeten 2025 (customers_2025). Används när användaren säger "lägg till i 2025", "spara i arbeten 2025" eller liknande. Skapa INTE en vanlig kund för detta.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Kundens namn',
          },
          service: {
            type: 'string',
            description: 'Tjänstens nyckel: stentvatt | altantvatt | asfaltstvatt | fasadtvatt | taktvatt | ovrigt',
          },
          kvm: {
            type: 'number',
            description: 'Antal kvadratmeter',
          },
          hours: {
            type: 'number',
            description: 'Antal timmar som decimal, t.ex. 1.5 för 1h 30min',
          },
          pris: {
            type: 'number',
            description: 'Pris i SEK (exkl. moms)',
          },
        },
        required: ['name', 'service', 'kvm', 'hours', 'pris'],
      },
    },
  },

  // ── NY: delete_customer ────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'delete_customer',
      description:
        'Ta bort en kund permanent från customers-kollektionen. Används när användaren explicit ber om att radera/ta bort en kund. Kräver bekräftelse – om användaren inte redan bekräftat, fråga "Är du säker på att du vill ta bort [namn] permanent?".',
      parameters: {
        type: 'object',
        properties: {
          customer_id: {
            type: 'string',
            description: 'Personens namn eller Firestore-ID',
          },
          confirmed: {
            type: 'boolean',
            description: 'true = användaren har bekräftat borttagningen',
          },
        },
        required: ['customer_id', 'confirmed'],
      },
    },
  },
]

async function executeFunction(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
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
        const [c, m] = await Promise.all([
          adminDb.collection('customers').get(),
          adminDb.collection('maintenance_contracts').get(),
        ])
        const res = [
          ...c.docs
            .filter(d => String(d.data().name ?? '').toLowerCase().includes(q))
            .map(d => ({ id: d.id, collection: 'customers', ...d.data() })),
          ...m.docs
            .filter(d => String(d.data().name ?? '').toLowerCase().includes(q))
            .map(d => ({ id: d.id, collection: 'maintenance_contracts', ...d.data() })),
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
          name:             String(args.name ?? ''),
          phone:            String(args.phone ?? ''),
          email:            String(args.email ?? ''),
          address:          String(args.address ?? ''),
          note:             String(args.note ?? ''),
          price:            args.price ?? null,
          services,
          include_fogsand:  Boolean(args.include_fogsand ?? false),
          service_kvm,
          service_progress: buildProgress(services),
          status:           'new',
          created_at:       new Date().toISOString(),
          updated_at:       new Date().toISOString(),
        }
        const ref = await adminDb.collection('customers').add(docData)
        await adminDb.collection('activity_logs').add({
          customer_id:   ref.id,
          customer_name: docData.name,
          log_type:      'customer_created',
          content:       `Kund skapad: ${docData.name} – ${services.join(', ')} ${kvm} kvm`,
          timestamp:     new Date().toISOString(),
        })
        return { success: true, customer_id: ref.id, name: docData.name, services }
      }

      case 'add_to_maintenance_contracts': {
        const docData = {
          name:       String(args.name ?? ''),
          phone:      String(args.phone ?? ''),
          email:      String(args.email ?? ''),
          address:    String(args.address ?? ''),
          amount:     Number(args.amount ?? 0),
          note:       String(args.note ?? ''),
          created_at: new Date().toISOString(),
        }
        const ref = await adminDb.collection('maintenance_contracts').add(docData)
        return { success: true, contract_id: ref.id, name: docData.name }
      }

      case 'add_service_to_customer': {
        const svc = normKey(String(args.service ?? ''))
        const kvm = Number(args.kvm ?? 0)
        const include_fogsand = Boolean(args.include_fogsand ?? false)
        const found = await findDoc(String(args.customer_id ?? ''), 'customers')
        if (!found) return { error: `Hittade ingen kund med "${args.customer_id}".` }
        const services: string[] = Array.isArray(found.data.services)
          ? [...found.data.services]
          : []
        if (services.includes(svc)) return { error: `Kunden har redan "${svc}".` }
        const sp: Record<string, number> = found.data.service_progress ?? {}
        const sk: Record<string, number> = found.data.service_kvm ?? {}
        services.push(svc)
        sk[svc] = kvm
        sp[svc] = 0
        await found.ref.update({
          services,
          service_kvm:      sk,
          service_progress: sp,
          include_fogsand:
            svc === 'stentvatt' ? include_fogsand : (found.data.include_fogsand ?? false),
          updated_at: new Date().toISOString(),
        })
        return { success: true, added_service: svc }
      }

      case 'update_person': {
        const rawId = String(args.doc_id ?? '')
        const col   = String(args.collection ?? 'customers')
        const UPDATABLE = ['address', 'phone', 'email', 'note', 'price', 'name', 'kvm', 'amount']
        const fields: Record<string, unknown> = {}
        for (const k of UPDATABLE) {
          if (args[k] !== undefined && args[k] !== null) fields[k] = args[k]
        }
        if (args.updates && typeof args.updates === 'object') {
          for (const [k, v] of Object.entries(args.updates as object)) fields[k] = v
        }
        console.log(`[update_person] doc_id="${rawId}" col="${col}" fields=`, fields)
        if (Object.keys(fields).length === 0) {
          return { error: 'Inga fält skickades. Använd address, phone, email etc. som parametrar direkt.' }
        }
        const found = await findDoc(rawId, col)
        if (!found) return { error: `Hittade ingen person med "${rawId}".` }
        await found.ref.update({ ...fields, updated_at: new Date().toISOString() })
        const after = (await found.ref.get()).data()!
        console.log(`[update_person] ✅ ${after.name} uppdaterad`, fields)
        return {
          success:        true,
          updated_fields: Object.keys(fields),
          now: { name: after.name, address: after.address, phone: after.phone, email: after.email },
        }
      }

      case 'add_note': {
        const note  = String(args.note ?? '')
        const found = await findDoc(String(args.customer_id ?? ''), 'customers')
        if (!found) return { error: `Hittade ingen kund med "${args.customer_id}".` }
        await found.ref.update({ note, updated_at: new Date().toISOString() })
        await adminDb.collection('activity_logs').add({
          customer_id: found.ref.id,
          log_type:    'comment',
          content:     `Anteckning: ${note}`,
          timestamp:   new Date().toISOString(),
        })
        return { success: true }
      }

      case 'log_time': {
        const customerId  = String(args.customer_id ?? '')
        const hours       = Number(args.hours ?? 0)
        const moment      = String(args.moment ?? 'Admin')
        const date        = String(args.date ?? new Date().toISOString().slice(0, 10))
        const worker      = String(args.worker ?? '')
        if (hours <= 0) return { error: 'Antal timmar måste vara större än 0.' }
        const found = await findDoc(customerId, 'customers')
        if (!found) return { error: `Hittade ingen kund med "${customerId}".` }
        const timeSpentMins = Math.round(hours * 60)
        const now = new Date().toISOString()
        await adminDb.collection('activity_logs').add({
          customer_id:   found.ref.id,
          customer_name: String(found.data.name ?? ''),
          log_type:      'time_log',
          moment:        moment,
          time_spent:    timeSpentMins,
          date:          date,
          content:       `${moment}: ${fmtMins(timeSpentMins)}${worker ? ` (${worker})` : ''}`,
          timestamp:     now,
        })
        console.log(`[log_time] ✅ ${timeSpentMins}min loggat på "${found.data.name}" moment="${moment}" datum=${date}`)
        return { success: true, customer_name: found.data.name, time_spent_mins: timeSpentMins, moment, date }
      }

      case 'get_stats': {
        const [c, m] = await Promise.all([
          adminDb.collection('customers').get(),
          adminDb.collection('maintenance_contracts').get(),
        ])
        const custs = c.docs.map(d => d.data())
        const svcCount: Record<string, number> = {}
        for (const cu of custs) {
          for (const s of (cu.services as string[]) ?? []) {
            svcCount[s] = (svcCount[s] ?? 0) + 1
          }
        }
        return {
          total:                 custs.length,
          active:                custs.filter(c => c.status === 'active').length,
          completed:             custs.filter(c => c.status === 'completed').length,
          revenue:               custs.reduce((s, c) => s + (Number(c.price) || 0), 0),
          services:              svcCount,
          maintenance_contracts: m.docs.length,
        }
      }

      case 'save_memory': {
        await saveMemoryFact(String(args.key ?? ''), String(args.value ?? ''))
        return { success: true }
      }

      // ── NY: add_to_2025 ──────────────────────────────────────────────────────
      case 'add_to_2025': {
        const svc     = normKey(String(args.service ?? 'ovrigt'))
        const kvm     = Number(args.kvm ?? 0)
        const hours   = Number(args.hours ?? 0)
        const pris    = Number(args.pris ?? 0)
        const name    = String(args.name ?? '')

        if (!name) return { error: 'Namn saknas.' }
        if (kvm <= 0) return { error: 'Ange giltigt kvm.' }
        if (hours <= 0) return { error: 'Ange giltig tid (timmar > 0).' }
        if (pris < 0) return { error: 'Ange giltigt pris.' }

        // Omvandla timmar → minuter (samma format som AdminShell sparar)
        const tidMins = Math.round(hours * 60)

        const ref = await adminDb.collection('customers_2025').add({
          name,
          service:    svc,
          kvm,
          tid:        tidMins,   // minuter – matchar AdminShell's läsning
          pris,
          created_at: new Date().toISOString(),
        })

        console.log(`[add_to_2025] ✅ "${name}" svc="${svc}" kvm=${kvm} tid=${tidMins}min pris=${pris}`)

        return {
          success: true,
          job_id:  ref.id,
          name,
          service: svc,
          kvm,
          tid_mins: tidMins,
          pris,
        }
      }

      // ── NY: delete_customer ──────────────────────────────────────────────────
      case 'delete_customer': {
        const customerId = String(args.customer_id ?? '')
        const confirmed  = Boolean(args.confirmed ?? false)

        if (!confirmed) {
          // AI-botten ska fråga om bekräftelse – returnera ett tydligt meddelande
          // så att OpenAI-modellen vet att den ska ställa frågan till användaren
          const found = await findDoc(customerId, 'customers')
          const displayName = found?.data.name ?? customerId
          return {
            needs_confirmation: true,
            message: `Vill du verkligen ta bort "${displayName}" permanent? Svara "ja, ta bort" för att bekräfta.`,
          }
        }

        const found = await findDoc(customerId, 'customers')
        if (!found) return { error: `Hittade ingen kund med "${customerId}".` }

        const customerName = String(found.data.name ?? customerId)

        // Ta bort kund-dokumentet
        await found.ref.delete()

        // Ta bort tillhörande activity_logs
        const logsSnap = await adminDb
          .collection('activity_logs')
          .where('customer_id', '==', found.ref.id)
          .get()
        const deleteBatch = adminDb.batch()
        logsSnap.docs.forEach(d => deleteBatch.delete(d.ref))
        if (logsSnap.docs.length > 0) await deleteBatch.commit()

        console.log(`[delete_customer] ✅ "${customerName}" (${found.ref.id}) borttagen + ${logsSnap.docs.length} loggar`)

        return {
          success:        true,
          deleted_name:   customerName,
          deleted_id:     found.ref.id,
          logs_deleted:   logsSnap.docs.length,
        }
      }

      default:
        return { error: `Okänd funktion: ${name}` }
    }
  } catch (err: any) {
    console.error(`[ERROR] ${name}:`, err.message)
    return { error: `Fel: ${err.message}` }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body        = await req.json()
    const userMessage = String(body.message ?? '')
    const sessionId   = String(body.sessionId ?? 'default')
    const hasImage    = Boolean(body.hasImage ?? false)
    const imageUrl    = String(body.imageUrl ?? '')
    const model       = hasImage ? 'gpt-4o' : 'gpt-4o-mini'

    const [memory, history] = await Promise.all([
      loadMemory(),
      loadHistory(sessionId),
    ])

    const systemPrompt = `Du är en effektiv AI-assistent för HTY Rengöring.
Agera direkt – fråga aldrig "Vill du att jag ska...?".

REGLER:
1. update_person: skicka personens NAMN som doc_id. Skicka fält att ändra DIREKT som parametrar (address, phone, email, etc.) – INTE nästlade under "updates".
2. add_service_to_customer och add_note: skicka personens NAMN som customer_id.
3. Kör find_person_by_name INNAN create_customer och add_to_maintenance_contracts.
4. "Underhållsavtal/årligt underhåll" → ENDAST add_to_maintenance_contracts.
5. Service-nycklar: stentvatt | altantvatt | asfaltstvatt | fasadtvatt | taktvatt
6. Fråga om kvm om det saknas. Fråga om fogsand vid stentvatt.
7. save_memory för viktiga fakta. Bildanalys: extrahera ALL text.
8. Tidrapportering → ALLTID log_time, ALDRIG add_note.
   - hours: antal timmar som decimal (10 min = 0.17, 30 min = 0.5, 1h = 1.0)
   - moment: "Admin" för adminarbete, annars t.ex. "Stentvätt - Hembesök"
9. "Arbeten 2025" / "lägg till i 2025" → ALLTID add_to_2025, ALDRIG create_customer.
   - Fråga efter kvm, timmar och pris om de saknas.
   - service-nycklar: stentvatt | altantvatt | asfaltstvatt | fasadtvatt | taktvatt | ovrigt
10. Ta bort kund → delete_customer. Bekräfta ALLTID med användaren innan borttagning (confirmed: false först, sedan confirmed: true när användaren sagt ja).

EXEMPEL – lägg till jobb i Arbeten 2025:
add_to_2025: name="Anna Ek", service="stentvatt", kvm=40, hours=3, pris=4500

EXEMPEL – logga 10 min admin:
customer_id: "Herman Lindén", hours: 0.17, moment: "Admin"

EXEMPEL – logga 2h stentvätt:
customer_id: "Herman Lindén", hours: 2, moment: "Stentvätt - Stentvätt"

EXEMPEL – uppdatera adress:
doc_id: "Herman Lindén", collection: "customers", address: "Majsbollsvägen 22"

EXEMPEL – ta bort kund (steg 1, invänta bekräftelse):
delete_customer: customer_id="Herman Lindén", confirmed=false

EXEMPEL – ta bort kund (steg 2, efter att användaren sagt ja):
delete_customer: customer_id="Herman Lindén", confirmed=true

TJÄNSTESTEG:
• stentvatt (fogsand): Hembesök→Provtvätt→Offert→Stentvätt→Impregnering→Fogsand→Faktura
• stentvatt (utan): Hembesök→Provtvätt→Offert→Stentvätt→Impregnering→Faktura
• altantvatt: Hembesök→Offert→Altantvätt→Behandling→Målning→Faktura
• asfaltstvatt: Hembesök→Offert→Asfaltstvätt→Fogning→Faktura
• fasadtvatt: Hembesök→Offert→Fasadtvätt→Impregnering→Faktura
• taktvatt: Hembesök→Offert→Taktvätt→Behandling→Faktura
${memory}`

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] =
      hasImage && imageUrl
        ? [
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            { type: 'text', text: userMessage || 'Läs av bilden.' },
          ]
        : [{ type: 'text', text: userMessage }]

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({
        role:    m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userContent },
    ]

    const actions: unknown[] = []
    let totalPrompt = 0, totalCompletion = 0

    for (let round = 0; round < 6; round++) {
      const res = await openai.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
      })
      totalPrompt     += res.usage?.prompt_tokens ?? 0
      totalCompletion += res.usage?.completion_tokens ?? 0
      const msg = res.choices[0].message
      messages.push(msg as OpenAI.Chat.ChatCompletionMessageParam)
      if (!msg.tool_calls?.length) break
      for (const tc of msg.tool_calls) {
        let fnArgs: Record<string, unknown> = {}
        try { fnArgs = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
        const result = await executeFunction(tc.function.name, fnArgs)
        actions.push({ function: tc.function.name, args: fnArgs, result })
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          content:      JSON.stringify(result),
        } as OpenAI.Chat.ChatCompletionMessageParam)
      }
    }

    let reply = ''
    const lastA = [...messages].reverse().find(m => m.role === 'assistant')
    if (typeof lastA?.content === 'string' && lastA.content.trim()) {
      reply = lastA.content
    } else {
      const fallback = await openai.chat.completions.create({
        model,
        messages,
        temperature: 0.2,
      })
      const fm = fallback.choices[0].message
      messages.push(fm as OpenAI.Chat.ChatCompletionMessageParam)
      reply = typeof fm.content === 'string' ? fm.content : ''
      totalPrompt     += fallback.usage?.prompt_tokens ?? 0
      totalCompletion += fallback.usage?.completion_tokens ?? 0
    }

    await saveHistory(
      sessionId,
      messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role:    m.role as string,
          content:
            typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
              ? (m.content as OpenAI.Chat.ChatCompletionContentPart[])
                  .filter(
                    (p): p is OpenAI.Chat.ChatCompletionContentPartText =>
                      p.type === 'text'
                  )
                  .map(p => p.text)
                  .join(' ')
              : '',
        }))
        .filter(m => m.content.trim().length > 0 && m.content.length < 5000)
    )

    return NextResponse.json({
      reply,
      actions,
      model,
      usage: { prompt: totalPrompt, completion: totalCompletion },
    })

  } catch (err: any) {
    console.error('[AI Route Error]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
