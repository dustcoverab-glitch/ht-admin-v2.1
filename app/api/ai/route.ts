import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function fmtMins(m: number): string { return `${Math.floor(m / 60)}h ${m % 60}m` }

const tools: Anthropic.Tool[] = [
  {
    name: 'get_customers',
    description: 'Hämta alla kunder eller filtrera',
    input_schema: { type: 'object' as const, properties: { status: { type: 'string', enum: ['all', 'new', 'in_progress', 'completed', 'rejected'] }, search: { type: 'string' } }, required: [] },
  },
  {
    name: 'create_customer',
    description: 'Skapa en ny kund',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' }, services: { type: 'array', items: { type: 'string' } }, include_fogsand: { type: 'boolean' }, note: { type: 'string' }, price_excl_vat: { type: 'number' } },
      required: ['name', 'phone', 'address'],
    },
  },
  {
    name: 'update_customer',
    description: 'Uppdatera en kunds uppgifter',
    input_schema: {
      type: 'object' as const,
      properties: { customer_id: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' }, note: { type: 'string' }, price_excl_vat: { type: 'number' } },
      required: ['customer_id'],
    },
  },
  {
    name: 'find_customer_by_name',
    description: 'Hitta kund på namn',
    input_schema: { type: 'object' as const, properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'add_note',
    description: 'Lägg till anteckning på kund',
    input_schema: { type: 'object' as const, properties: { customer_id: { type: 'string' }, note: { type: 'string' } }, required: ['customer_id', 'note'] },
  },
  {
    name: 'get_stats',
    description: 'Hämta statistik',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
]

async function executeFunction(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'get_customers': {
      const snap = await adminDb.collection('customers').orderBy('created_at', 'desc').get()
      let customers = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
      if (args.search) { const q = (args.search as string).toLowerCase(); customers = customers.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.address?.toLowerCase().includes(q)) }
      return { customers: customers.slice(0, 20), total: customers.length }
    }
    case 'find_customer_by_name': {
      const snap = await adminDb.collection('customers').get()
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
      const q = (args.name as string).toLowerCase()
      const matches = all.filter(c => c.name?.toLowerCase().includes(q))
      return { matches, found: matches.length }
    }
    case 'create_customer': {
      const services = (args.services as string[]) || []
      const prog: Record<string, number> = {}; services.forEach(s => { prog[s] = 0 })
      const data = { name: args.name, phone: args.phone, email: args.email || '', address: args.address, services: JSON.stringify(services), service_kvm: '{}', service_progress: JSON.stringify(prog), skipped_steps: '{}', include_fogsand: args.include_fogsand || false, note: args.note || '', price_excl_vat: args.price_excl_vat || 0, status: 'new', rejected: false, created_at: new Date().toISOString() }
      const ref = await adminDb.collection('customers').add(data)
      return { success: true, customer_id: ref.id, name: args.name }
    }
    case 'update_customer': {
      const { customer_id, ...updates } = args
      const clean: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (updates.name) clean.name = updates.name; if (updates.phone) clean.phone = updates.phone
      if (updates.email !== undefined) clean.email = updates.email; if (updates.address) clean.address = updates.address
      if (updates.note !== undefined) clean.note = updates.note; if (updates.price_excl_vat !== undefined) clean.price_excl_vat = updates.price_excl_vat
      await adminDb.collection('customers').doc(customer_id as string).update(clean)
      return { success: true }
    }
    case 'add_note': {
      const { customer_id, note } = args
      await adminDb.collection('customers').doc(customer_id as string).update({ note, updated_at: new Date().toISOString() })
      await adminDb.collection('activity_logs').add({ customer_id, log_type: 'comment', content: note, timestamp: new Date().toISOString() })
      return { success: true }
    }
    case 'get_stats': {
      const snap = await adminDb.collection('customers').get()
      const customers = snap.docs.map(d => d.data()) as any[]
      const total = customers.length; const rejected = customers.filter(c => c.rejected).length
      const totalRevenue = customers.filter(c => !c.rejected && c.price_excl_vat > 0).reduce((s, c) => s + (c.price_excl_vat || 0), 0)
      return { total_customers: total, rejected, active: total - rejected, total_revenue: totalRevenue }
    }
    default: return { error: 'Okänd funktion' }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messages: Anthropic.MessageParam[] = Array.isArray(body.messages)
      ? body.messages.map((m: any) => ({ role: m.role, content: m.content }))
      : [{ role: 'user', content: String(body.message ?? '') }]

    const systemPrompt = `Du är en AI-assistent för HT Ytrengöring AB – ett professionellt ytrengöringsföretag i Sverige. Du hjälper ägaren att hantera sin adminportal. Du kan hämta, skapa och uppdatera kunder, lägga till anteckningar och hämta statistik. När du får en bild, extrahera ALL synlig information och kolla alltid befintliga kunder innan du skapar ny. Svar alltid på svenska.`

    const toolResults: any[] = []
    let totalInput = 0, totalOutput = 0

    for (let round = 0; round < 5; round++) {
      const response = await anthropic.messages.create({ model: 'claude-opus-4-6', max_tokens: 1500, system: systemPrompt, tools, messages })
      totalInput += response.usage.input_tokens; totalOutput += response.usage.output_tokens
      messages.push({ role: 'assistant', content: response.content })
      if (response.stop_reason !== 'tool_use') break
      const resultBlocks: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const result = await executeFunction(block.name, block.input as Record<string, unknown>)
        toolResults.push({ function: block.name, result })
        resultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      }
      messages.push({ role: 'user', content: resultBlocks })
    }

    let reply = ''
    const lastA = [...messages].reverse().find(m => m.role === 'assistant')
    if (lastA && Array.isArray(lastA.content)) {
      const tb = (lastA.content as Anthropic.ContentBlock[]).find(b => b.type === 'text')
      if (tb && tb.type === 'text') reply = tb.text
    }

    return NextResponse.json({ reply, actions: toolResults, model: 'claude-opus-4-6', usage: { prompt_tokens: totalInput, completion_tokens: totalOutput } })
  } catch (error: any) {
    console.error('AI error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
