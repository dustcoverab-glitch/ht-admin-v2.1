import { NextRequest, NextResponse } from 'next/server'
import { adminDb as db } from '@/lib/firebase-admin'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_customers',
      description: 'Hämta alla kunder eller filtrera',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['all', 'new', 'in_progress', 'completed', 'rejected'] },
          search: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_customer',
      description: 'Skapa en ny kund',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          address: { type: 'string' },
          services: { type: 'array', items: { type: 'string' } },
          include_fogsand: { type: 'boolean' },
          note: { type: 'string' },
          price_excl_vat: { type: 'number' },
        },
        required: ['name', 'phone', 'address'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_customer',
      description: 'Uppdatera en kunds uppgifter',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          address: { type: 'string' },
          note: { type: 'string' },
          price_excl_vat: { type: 'number' },
        },
        required: ['customer_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_customer_by_name',
      description: 'Hitta kund på namn',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Lägg till anteckning på kund',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['customer_id', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stats',
      description: 'Hämta statistik',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

async function executeFunction(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'get_customers': {
      const snap = await adminDb.collection('customers').orderBy('created_at', 'desc').get()
      let customers = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
      if (args.search) {
        const q = (args.search as string).toLowerCase()
        customers = customers.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.address?.toLowerCase().includes(q))
      }
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
      const prog: Record<string, number> = {}
      services.forEach(s => { prog[s] = 0 })
      const data = {
        name: args.name, phone: args.phone, email: args.email || '',
        address: args.address, services: JSON.stringify(services),
        service_kvm: '{}', service_progress: JSON.stringify(prog),
        skipped_steps: '{}', include_fogsand: args.include_fogsand || false,
        note: args.note || '', price_excl_vat: args.price_excl_vat || 0,
        status: 'new', rejected: false, created_at: new Date().toISOString(),
      }
      const ref = await adminDb.collection('customers').add(data)
      return { success: true, customer_id: ref.id, name: args.name }
    }
    case 'update_customer': {
      const { customer_id, ...updates } = args
      const clean: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (updates.name) clean.name = updates.name
      if (updates.phone) clean.phone = updates.phone
      if (updates.email !== undefined) clean.email = updates.email
      if (updates.address) clean.address = updates.address
      if (updates.note !== undefined) clean.note = updates.note
      if (updates.price_excl_vat !== undefined) clean.price_excl_vat = updates.price_excl_vat
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
      const total = customers.length
      const rejected = customers.filter(c => c.rejected).length
      const totalRevenue = customers.filter(c => !c.rejected && c.price_excl_vat > 0).reduce((s, c) => s + (c.price_excl_vat || 0), 0)
      return { total_customers: total, rejected, active: total - rejected, total_revenue: totalRevenue }
    }
    default:
      return { error: 'Okänd funktion' }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { messages, hasImage } = await req.json()
    const model = hasImage ? 'gpt-4o' : 'gpt-4o-mini'
    let totalPromptTokens = 0
    let totalCompletionTokens = 0

    const systemPrompt = `Du är en AI-assistent för HT Ytrengöring AB – ett professionellt ytrengöringsföretag i Sverige. Du hjälper ägaren att hantera sin adminportal. Du kan hämta, skapa och uppdatera kunder, lägga till anteckningar och hämta statistik. När du får en bild, extrahera ALL synlig information och kolla alltid befintliga kunder innan du skapar ny. Svar alltid på svenska.`

    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      tools,
      tool_choice: 'auto',
      max_tokens: 1000,
    })

    totalPromptTokens += response.usage?.prompt_tokens || 0
    totalCompletionTokens += response.usage?.completion_tokens || 0
    let message = response.choices[0].message
    const toolResults: any[] = []
    let iterations = 0

    while (message.tool_calls && message.tool_calls.length > 0 && iterations < 5) {
      iterations++
      const results = await Promise.all(
        message.tool_calls.map(async call => {
          const args = JSON.parse(call.function.arguments)
          const result = await executeFunction(call.function.name, args)
          toolResults.push({ function: call.function.name, result })
          return { role: 'tool' as const, tool_call_id: call.id, content: JSON.stringify(result) }
        })
      )
      const followUp = await openai.chat.completions.create({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages, message, ...results],
        tools,
        tool_choice: 'auto',
        max_tokens: 1000,
      })
      totalPromptTokens += followUp.usage?.prompt_tokens || 0
      totalCompletionTokens += followUp.usage?.completion_tokens || 0
      message = followUp.choices[0].message
    }

    return NextResponse.json({
      reply: message.content,
      actions: toolResults,
      model,
      usage: { prompt_tokens: totalPromptTokens, completion_tokens: totalCompletionTokens },
    })
  } catch (error: any) {
    console.error('AI error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
