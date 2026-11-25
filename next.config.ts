import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Las imágenes de productos y sorteos son URLs que pega el admin, así que
    // no se puede acotar el host: solo https. El optimizador (/_next/image)
    // queda detrás de la sesión de admin en src/proxy.ts.
    remotePatterns: [{ protocol: "https", hostname: "**", pathname: "/**" }],
  },
  poweredByHeader: false,
  // Cabeceras de seguridad del panel y de la API: nadie puede meter el panel en
  // un marco de otra web, y el navegador no adivina tipos de archivo.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
