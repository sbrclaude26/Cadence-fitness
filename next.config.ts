import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow images from Open Food Facts CDN
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.openfoodfacts.org" },
      { protocol: "https", hostname: "**.openfoodfacts.net" },
    ],
  },
};

export default nextConfig;
