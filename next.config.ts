import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Las imágenes de productos y sorteos son URLs que pega el admin, así que
    // no se puede acotar el host: solo https. El optimizador (/_next/image)
    // queda detrás de la sesión de admin en src/proxy.ts.
    remotePatterns: [{ protocol: "https", hostname: "**", pathname: "/**" }],
  },
};

export default nextConfig;
