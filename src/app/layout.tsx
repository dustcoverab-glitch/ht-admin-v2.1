import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HT Ytrengöring — Admin',
  description: 'Adminportal för HT Ytrengöring AB',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
      </head>
      <body>{children}</body>
    </html>
  )
}
