import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const tools: Anthropic.Tool[] = [
  {
    name: "get_customers",
    description: "Hämta alla kunder eller filtrera",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["all", "new", "in_progress", "completed", "rejected"] },
        search: { type: "string" }
      },
      required: []
    }
  },
  {
    name: "create_customer",
    description: "Skapa en ny kund",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        services: { type: "array", items: { type: "string" } },
        include_fogsand: { type: "boolean" },
        note: { type: "string" },
        price_excl_vat: { type: "number" }
      },
      required: ["name", "phone", "address"]
    }
  },
  {
    name: "get_stats",
    description: "Hämta statistik",
    input_schema: { type: "object" as const, properties: {}, required: [] }
  }
]

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json()
    const systemPrompt = "Du är en AI-assistent för HT Ytrengöring AB. Du hjälper ägaren hantera adminportalen. Svara alltid på svenska."

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages
    })

    const textContent = response.content.find(b => b.type === "text")
    return NextResponse.json({ reply: textContent?.text || "Klar.", actions: [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
