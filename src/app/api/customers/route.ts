import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'

export async function GET() {
  try {
    const snap = await adminDb.collection('customers').orderBy('created_at', 'desc').get()
    const customers = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    return NextResponse.json({ customers })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const ref = await adminDb.collection('customers').add({
      ...data,
      created_at: new Date().toISOString(),
      status: 'new',
      rejected: false,
    })
    return NextResponse.json({ id: ref.id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
