import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackendAccessGuard from "@/components/BackendAccessGuard";

const { replace, pathname, mockFetch, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    replace,
    pathname: { value: "/dashboard" },
    mockFetch: vi.fn(),
    router: { replace },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => router,
}));

describe("BackendAccessGuard", () => {
  beforeEach(() => {
    replace.mockReset();
    mockFetch.mockReset();
    pathname.value = "/dashboard";
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("monta el contenido solo después de que FastAPI autoriza la página", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ allowed: true, redirectTo: null }), { status: 200 }),
    );
    render(<BackendAccessGuard><p>Contenido privado</p></BackendAccessGuard>);

    expect(screen.queryByText("Contenido privado")).toBeNull();
    await screen.findByText("Contenido privado");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/auth/access?path=%2Fdashboard",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("envía a acceso y preserva la ruta solicitada si falta sesión", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ allowed: false, redirectTo: "/acceso" }), { status: 200 }),
    );
    render(<BackendAccessGuard><p>Contenido privado</p></BackendAccessGuard>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      "/acceso?retorno=%2Fdashboard",
    ));
    expect(screen.queryByText("Contenido privado")).toBeNull();
  });

  it("respeta el destino de rol que devuelve FastAPI", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ allowed: false, redirectTo: "/repartidor" }), { status: 200 }),
    );
    render(<BackendAccessGuard><p>Contenido privado</p></BackendAccessGuard>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/repartidor"));
  });

  it("muestra recuperación y permite reintentar si la API no responde", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ allowed: true, redirectTo: null }), { status: 200 }),
      );
    render(<BackendAccessGuard><p>Contenido privado</p></BackendAccessGuard>);

    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    await screen.findByText("Contenido privado");
  });
});
