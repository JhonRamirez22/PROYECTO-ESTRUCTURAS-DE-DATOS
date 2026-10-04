import { describe, expect, it } from "vitest";
import { isRoadGeometryProvider } from "@/lib/roadGeometry";

describe("isRoadGeometryProvider", () => {
  it.each(["OSRM", "ORS"])("accepts verified provider %s", (value) => {
    expect(isRoadGeometryProvider(value)).toBe(true);
  });

  it.each([null, undefined, "", "straight-line", "unknown"])(
    "rejects unverified provider %s",
    (value) => {
      expect(isRoadGeometryProvider(value)).toBe(false);
    },
  );
});
