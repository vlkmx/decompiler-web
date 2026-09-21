import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@local/ton-decompiler"],
  outputFileTracingIncludes: {
    "/api/decompile": [
      "./engine/dist/**/*",
      "./engine/package.json",
      "./node_modules/@ton-community/**/*",
      "./node_modules/@ton/**/*",
      "./node_modules/@tonstudio/**/*",
      "./node_modules/ton-source-map/**/*",
      "./node_modules/arg/**/*",
      "./node_modules/fflate/**/*",
      "./node_modules/jssha/**/*",
      "./node_modules/tweetnacl/**/*",
      "./node_modules/cac/**/*",
    ],
  },
};
export default nextConfig;
