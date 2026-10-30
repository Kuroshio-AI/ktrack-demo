import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Names the build, so the service worker (public/sw.js) keeps one offline copy per deploy.
  env: { KTRACK_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? "local" },
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
