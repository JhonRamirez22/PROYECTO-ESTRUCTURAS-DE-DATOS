import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rutas Pasto",
    short_name: "Rutas Pasto",
    description: "Seguimiento y operación de entregas en Pasto, Nariño.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f7f8",
    theme_color: "#0f766e",
    lang: "es-CO",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
