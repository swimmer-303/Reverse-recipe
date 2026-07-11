import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `ws` (used by the free Edge TTS client) ships optional native addons and
  // doesn't survive Next's server bundling — keep it external so it loads and
  // falls back to its pure-JS masker at runtime.
  serverExternalPackages: ["ws"],
};

export default nextConfig;
