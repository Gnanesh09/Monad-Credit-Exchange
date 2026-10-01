import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const devDomain = process.env.REPLIT_DEV_DOMAIN;

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@workspace/api-client-react", "@workspace/contracts"],
  // The Replit preview is served from a proxied domain; 127.0.0.1 is the local preview proxy.
  // Next 16 drops the dev websocket for other origins, and pages never hydrate without it.
  allowedDevOrigins: [devDomain, "*.replit.dev", "*.*.replit.dev", "*.repl.co", "127.0.0.1"].filter(Boolean),
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  // On Replit a path router sends /api to the API server. Elsewhere, set API_PROXY_TARGET
  // (for example http://localhost:8080) to forward /api from this app instead.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/$/, "");
    return target ? [{ source: "/api/:path*", destination: `${target}/api/:path*` }] : [];
  },
};

export default nextConfig;
