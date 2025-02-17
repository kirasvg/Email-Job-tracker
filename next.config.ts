import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.fallback = {
      "child_process": false,
      "fs": false,
      "net": false,
      "tls": false,
    };
    return config;
  },
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
};

export default nextConfig;
