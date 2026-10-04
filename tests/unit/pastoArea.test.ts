import { describe, expect, it } from "vitest";
import {
  containsForeignCityReference,
  isWithinPastoServiceArea,
  normalizePastoAddress,
} from "@/lib/pastoArea";

describe("pastoArea", () => {
  it("normaliza abreviaturas comunes de direcciones colombianas", () => {
    expect(normalizePastoAddress("cra. 27 #18-09")).toBe("Carrera 27 # 18-09");
    expect(normalizePastoAddress("cll 18 no. 24-12")).toBe(
      "Calle 18 # 24-12",
    );
    expect(normalizePastoAddress("carrera 25 num 4 sur 65")).toBe(
      "Carrera 25 # 4 sur 65",
    );
  });

  it("acepta coordenadas dentro de la zona de servicio de Pasto", () => {
    expect(isWithinPastoServiceArea(1.2136, -77.2811)).toBe(true);
  });

  it("rechaza coordenadas claramente fuera de Pasto", () => {
    expect(isWithinPastoServiceArea(4.711, -74.0721)).toBe(false);
  });

  it("detecta una ciudad extranjera escrita explícitamente", () => {
    expect(containsForeignCityReference("Calle 10, Bogotá")).toBe(true);
    expect(containsForeignCityReference("Carrera 25 # 4 sur 65, Quito, Ecuador")).toBe(true);
    expect(containsForeignCityReference("Carrera 27 #18-09")).toBe(false);
  });
});
