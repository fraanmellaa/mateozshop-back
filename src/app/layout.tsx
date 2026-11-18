import { Poppins } from "next/font/google";
import React from "react";
import "./globals.css";
import { PanelShell } from "./login/PanelShell";
import { Metadata } from "next";
import { Toaster } from "sonner";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// El panel lee la BD en cada petición: sin esto Next prerenderiza los listados
// al compilar y serviría datos congelados del momento del build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MateoZ Shop - Admin Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body className={`${poppins.className} antialiased`}>
        <PanelShell>{children}</PanelShell>
        <Toaster position="top-right" theme="dark" />
      </body>
    </html>
  );
}
