/** Proxy /api/* to the FastAPI demo backend so the browser hits one origin. */
const API = process.env.PRISM_API || "http://localhost:8001";
module.exports = {
  // long clips legitimately take 1-2 min through the pipeline; the dev proxy's
  // default ~30s timeout was dropping those requests mid-flight
  experimental: { proxyTimeout: 300000 },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
