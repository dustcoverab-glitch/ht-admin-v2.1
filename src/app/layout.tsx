import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HT Ytrengöring — Admin',
  description: 'Adminportal för HT Ytrengöring AB',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  )
}
