/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Använd webpack istället för Turbopack för att alla API-routes inkluderas korrekt
  experimental: {
    turbo: undefined,
  },
}
module.exports = nextConfig
