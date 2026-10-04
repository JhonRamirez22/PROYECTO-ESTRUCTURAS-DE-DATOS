import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// TODO: incorporar una fuente self-hosted en /public si el diseño requiere una tipografía específica.
export const metadata: Metadata = {
  title: "Rutas Pasto · Centro de despacho",
  description: "Optimización y seguimiento de rutas de entrega en Pasto, Nariño.",
  appleWebApp: {
    capable: true,
    title: "Rutas Pasto",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="es"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
