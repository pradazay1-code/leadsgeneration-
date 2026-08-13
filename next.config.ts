import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Places client and storage layer are server-only; keep them out of the
  // client bundle even if something imports them transitively.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
