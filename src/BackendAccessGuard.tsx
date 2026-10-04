"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

interface PageAccessDecision {
  allowed: boolean;
  redirectTo: string | null;
}

type GuardState = "checking" | "allowed" | "unavailable";

const INTERNAL_REDIRECTS = new Set(["/acceso", "/dashboard", "/repartidor"]);

export default function BackendAccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [state, setState] = useState<GuardState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const verifyAccess = useCallback(async (signal: AbortSignal): Promise<void> => {
    setState("checking");
    setError(null);

    try {
      const response = await fetch(
        `/api/auth/access?path=${encodeURIComponent(pathname)}`,
        { cache: "no-store", signal },
      );
      if (!response.ok) {
        throw new Error("El servicio de acceso no respondió.");
      }

      const decision = (await response.json()) as PageAccessDecision;
      if (decision.allowed === true) {
        setState("allowed");
        return;
      }
      const redirectTo = decision.redirectTo;
      if (typeof redirectTo !== "string" || !INTERNAL_REDIRECTS.has(redirectTo)) {
        throw new Error("El backend devolvió una decisión de acceso inválida.");
      }

      if (redirectTo === "/acceso") {
        const accessUrl = new URL("/acceso", window.location.origin);
        accessUrl.searchParams.set("retorno", `${pathname}${window.location.search}`);
        router.replace(`${accessUrl.pathname}${accessUrl.search}`);
        return;
      }

      router.replace(redirectTo);
    } catch (requestError) {
      if (signal.aborted) return;
      setState("unavailable");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo verificar el acceso.",
      );
    }
  }, [pathname, router]);

  useEffect(() => {
    const controller = new AbortController();
    void verifyAccess(controller.signal);
    return () => controller.abort();
  }, [retryCount, verifyAccess]);

  if (state === "allowed") return children;

  return (
    <main
      aria-busy={state === "checking"}
      className="grid min-h-[70vh] place-items-center bg-[var(--background)] px-4 py-12"
    >
      <section
        aria-live="polite"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)] sm:p-8"
        role={state === "unavailable" ? "alert" : "status"}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#122522] text-sm font-black text-emerald-200">
            RP
          </span>
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              {state === "checking" ? "Verificando acceso" : "No se pudo validar tu sesión"}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {state === "checking"
                ? "Consultando permisos de forma segura…"
                : error ?? "Intenta nuevamente en unos segundos."}
            </p>
          </div>
        </div>
        {state === "checking" ? (
          <div className="mt-6 space-y-2" aria-hidden="true">
            <div className="h-2 w-full animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none" />
            <div className="h-2 w-2/3 animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none" />
          </div>
        ) : (
          <button
            className="rp-button rp-button-primary mt-6 w-full"
            onClick={() => setRetryCount((count) => count + 1)}
            type="button"
          >
            Reintentar
          </button>
        )}
      </section>
    </main>
  );
}
