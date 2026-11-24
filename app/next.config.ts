import type { NextConfig } from "next"
import path from "node:path"

// The app lives in an npm workspace; Turbopack and file tracing need the
// repository root to resolve hoisted dependencies.
const repoRoot = path.join(import.meta.dirname, "..")

const nextConfig: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // The provider app moved from app.402reviews.xyz; every old link and an
  // app's cached sign-in address keep working.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "app.402reviews.xyz" }],
        destination: "https://providers.402reviews.xyz/:path*",
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      { source: "/", headers: [{ key: "Vary", value: "Accept" }] },
      { source: "/leaderboard", headers: [{ key: "Vary", value: "Accept" }] },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ]
  },
}

export default nextConfig
