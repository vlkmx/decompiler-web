import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      "node:fs": { browser: "./src/lib/browserFs.ts" },
    },
  },
};
export default nextConfig;
