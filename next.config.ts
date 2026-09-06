import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ hostname: "cdn.discordapp.com" }, { hostname: "media.discordapp.net" }, { hostname: "cdn.discordapp.net" }] },
};

export default nextConfig;
