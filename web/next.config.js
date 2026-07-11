/** Proxy /api/* to the FastAPI demo backend so the browser hits one origin. */
const API = process.env.PRISM_API || "http://localhost:8001";
module.exports = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
