"use client";

export default function LogoutButton() {
  const logout = async (): Promise<void> => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      try {
        for (const key of Object.keys(window.localStorage)) {
          if (key.startsWith("rutas-pasto:assigned-route:") || key === "rutas-pasto:courier-id") {
            window.localStorage.removeItem(key);
          }
        }
        if ("caches" in window) {
          await Promise.all(
            (await window.caches.keys())
              .filter((key) => key.startsWith("rutas-pasto-routes"))
              .map((key) => window.caches.delete(key)),
          );
        }
      } catch {
        // El service worker nuevo también elimina la caché privada heredada al activarse.
      }
      window.location.replace("/");
    }
  };

  return (
    <button
      className="min-h-11 min-w-11 whitespace-nowrap rounded-xl border border-white/15 px-2 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white sm:min-h-0 sm:min-w-0 sm:px-3"
      onClick={() => void logout()}
      type="button"
    >
      Salir
    </button>
  );
}
