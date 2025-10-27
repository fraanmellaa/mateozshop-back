import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "locowin.net",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "community.fastly.steamstatic.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
