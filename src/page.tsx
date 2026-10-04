"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";

export default function AccessPage() {
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const requested = new URLSearchParams(window.location.search).get("retorno");
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode, returnTo: requested }),
      });
      const payload = (await response.json()) as {
        error?: string;
        authenticated?: boolean;
        redirectTo?: string;
      };
      if (!response.ok || payload.authenticated !== true || !payload.redirectTo) {
        throw new Error(payload.error ?? "No se pudo iniciar sesión.");
      }

      window.location.assign(payload.redirectTo);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell active="home">
      <main className="px-5 py-12 sm:px-8">
        <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
          <Link className="text-xs font-semibold text-teal-700 hover:text-teal-900" href="/">
            ← Inicio
          </Link>
          <h1 className="mt-8 text-3xl font-bold tracking-tight text-slate-950">Ingresar al sistema</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            El acceso usa códigos privados; los datos operativos no están disponibles sin sesión.
          </p>

          <form className="mt-6 space-y-4" onSubmit={(event) => void signIn(event)}>
            <label className="block text-sm font-semibold text-slate-700" htmlFor="access-code">
              Código de acceso
              <input
                autoComplete="current-password"
                className="rp-input mt-1.5 px-3 py-3 font-mono text-sm"
                id="access-code"
                onChange={(event) => setAccessCode(event.target.value.trim())}
                required
                type="password"
                value={accessCode}
              />
            </label>
            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
                {error}
              </p>
            ) : null}
            <button className="rp-button rp-button-primary w-full" disabled={loading} type="submit">
              {loading ? "Verificando…" : "Ingresar"}
            </button>
          </form>
        </section>
      </main>
    </AppShell>
  );
}
