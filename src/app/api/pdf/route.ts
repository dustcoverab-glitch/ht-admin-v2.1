import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const pdfBase64: string = String(body.pdfBase64 ?? '')
    const customerId: string = String(body.customerId ?? '')

    if (!pdfBase64) {
      return NextResponse.json({ error: 'pdfBase64 saknas' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY saknas i Vercel environment variables' }, { status: 500 })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
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
              },
              {
                type: 'text',
                text: 'Analysera denna offert-PDF. Extrahera ALLA materialposter med namn, antal och styckpris (exkl. moms). Returnera ENBART giltig JSON: {"material_items":[{"name":"Materialnamn","qty":1,"unit_price":100}]}. Inkludera ENBART material/produkter, INTE arbete eller tjänster. Om inga materialposter hittas, returnera {"material_items":[]}.',
              },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return NextResponse.json({ error: `Anthropic API fel: ${response.status} ${errText}` }, { status: 500 })
    }

    const data = await response.json()
    const textContent = data.content?.find((b: any) => b.type === 'text')
    if (!textContent) return NextResponse.json({ material_items: [] })

    const match = textContent.text.match(/\{[\s\S]*"material_items"[\s\S]*\}/)
    if (!match) return NextResponse.json({ material_items: [] })

    const parsed = JSON.parse(match[0])
    const material_items = (parsed.material_items ?? []).map((i: any) => ({
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
