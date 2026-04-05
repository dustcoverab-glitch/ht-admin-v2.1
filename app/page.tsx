'use client'
import { useState, useEffect } from 'react'
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import AdminShell from '@/components/dashboard/AdminShell'

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const token = await user.getIdToken()
          await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) })
        } catch (e) {}
        setAuthed(true)
      } else {
        setAuthed(false)
      }
    })
    return () => unsub()
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err: any) {
      const msgs: Record<string, string> = {
        'auth/invalid-email': 'Ogiltig e-postadress',
        'auth/user-not-found': 'Ingen användare med denna e-post',
        'auth/wrong-password': 'Fel lösenord',
        'auth/too-many-requests': 'För många försök — vänta en stund',
        'auth/invalid-credential': 'Felaktig e-post eller lösenord',
      }
      setError(msgs[err.code] || 'Inloggning misslyckades')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    try { await fetch('/api/auth', { method: 'DELETE' }) } catch (e) {}
    await signOut(auth)
  }

  if (authed === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0B1120' }}>
        <div style={{ width: 24, height: 24, border: '2px solid rgba(201,168,76,0.3)', borderTopColor: '#C9A84C', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'linear-gradient(135deg, #0B1120 0%, #0F1829 50%, #0B1120 100%)' }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#E8E8F0', marginBottom: 4 }}>HT Ytrengöring</h1>
            <p style={{ fontSize: 13, color: '#4A5568' }}>Adminportal</p>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 28 }}>
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4A5568', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>E‑post</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Mail" required
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px', color: '#E8E8F0', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#4A5568', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Lösenord</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px', color: '#E8E8F0', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 12px', color: '#FC8181', fontSize: 13 }}>{error}</div>
              )}
              <button type="submit" disabled={loading}
                style={{ width: '100%', padding: '11px 16px', background: loading ? 'rgba(201,168,76,0.5)' : 'linear-gradient(135deg, #C9A84C, #E8C94A)', border: 'none', borderRadius: 8, color: '#0B1120', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? 'Loggar in...' : 'Logga in'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return <AdminShell onLogout={handleLogout} />
}
