import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const pdfBase64: string = String(body.pdfBase64 ?? '')
    const customerId: string = String(body.customerId ?? '')

    if (!pdfBase64) {
      return NextResponse.json({ error: 'pdfBase64 saknas' }, { status: 400 })
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            } as any,
            {
              type: 'text',
              text: `Analysera denna offert-PDF för ett ytrengöringsföretag. Extrahera ALLA materialposter med namn, antal och styckpris (exkl. moms). Returnera ENBART giltig JSON i detta exakta format utan förklaring:
{"material_items":[{"name":"Materialnamn","qty":1,"unit_price":100}]}
Inkludera ENBART material och produkter – INTE arbete, tjänster eller moms. Om ingen materialpost hittas, returnera {"material_items":[]}.`,
            },
          ],
        },
      ],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ material_items: [] })
    }

    // Extract JSON from reply
    const match = textBlock.text.match(/\{[\s\S]*"material_items"[\s\S]*\}/)
    if (!match) {
      return NextResponse.json({ material_items: [] })
    }

    const parsed = JSON.parse(match[0])
    const material_items: { name: string; qty: number; unit_price: number }[] =
      (parsed.material_items ?? []).map((i: any) => ({
        name: String(i.name ?? ''),
        qty: Number(i.qty ?? 1),
        unit_price: Number(i.unit_price ?? 0),
      }))

    return NextResponse.json({ material_items, customer_id: customerId })
  } catch (err: any) {
    console.error('[PDF Extract Error]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
