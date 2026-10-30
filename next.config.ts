import { execSync } from "node:child_process";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Names the build, so the service worker (public/sw.js) keeps one offline copy per deploy. Vercel names the commit;
  // a Cloudflare deploy runs from a checkout here, so git does.
  env: { KTRACK_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? execSync("git rev-parse HEAD").toString().trim() },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    }, {
      // The browser checks for a new service worker on every visit instead of trusting its HTTP cache.
      source: "/sw.js",
      headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" }],
    }];
  },
};

export default nextConfig;
