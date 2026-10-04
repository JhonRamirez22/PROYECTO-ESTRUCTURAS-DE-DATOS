"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import LogoutButton from "@/components/LogoutButton";

interface AppShellProps {
  children: ReactNode;
  active?: "home" | "orders" | "dispatch" | "courier" | "tracking";
}

const navigationBySurface = {
  home: [
    { href: "/acceso", label: "Personal", key: "staff" },
    { href: "/cliente", label: "Seguimiento", key: "tracking" },
  ],
  tracking: [{ href: "/cliente", label: "Seguimiento", key: "tracking" }],
  courier: [{ href: "/repartidor", label: "Mi ruta", key: "courier" }],
  dispatcher: [
    { href: "/pedidos", label: "Pedidos", key: "orders" },
    { href: "/dashboard", label: "Despacho", key: "dispatch" },
  ],
} as const;

export default function AppShell({ children, active }: AppShellProps) {
  const pathname = usePathname();
  const navigation = active === "tracking"
    ? navigationBySurface.tracking
    : active === "courier"
      ? navigationBySurface.courier
      : active === "orders" || active === "dispatch"
        ? navigationBySurface.dispatcher
        : navigationBySurface.home;

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // La navegación online sigue funcionando si el navegador rechaza la PWA.
    });
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#122522] text-white shadow-[0_8px_24px_rgba(15,23,42,0.14)]">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 sm:flex sm:justify-between sm:gap-4 sm:px-8 sm:py-3.5 lg:px-10">
          <Link className="flex min-w-0 items-center gap-2 sm:gap-3" href="/">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-300 text-sm font-black text-[#122522] shadow-[0_6px_16px_rgba(16,185,129,0.18)]">
              RP
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold tracking-tight text-white">
                Rutas Pasto
              </span>
              <span className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-white/[0.45] sm:block">
                Operación de entregas
              </span>
            </span>
          </Link>

          <nav aria-label="Navegación principal" className="col-span-2 row-start-2 flex w-full min-w-0 items-center gap-1 overflow-x-auto pb-0.5 sm:order-2 sm:col-span-1 sm:row-auto sm:ml-auto sm:w-auto sm:max-w-[70vw]">
            {navigation.map((item) => {
              const isActive = active === item.key || (!active && pathname === item.href);

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-2 py-2 text-xs font-semibold transition-colors duration-200 sm:min-h-0 sm:px-3 sm:text-sm ${
                    isActive
                      ? "bg-white/[0.12] text-emerald-200 shadow-sm"
                      : "text-white/60 hover:bg-white/[0.08] hover:text-white"
                  }`}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 sm:order-3 sm:col-start-auto sm:row-start-auto sm:gap-3">
            {active === "orders" || active === "dispatch" || active === "courier" ? (
              <LogoutButton />
            ) : null}
            <span className="hidden shrink-0 items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200 xl:inline-flex">
              <span className="rp-status-dot" />
              Pasto activo
            </span>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
