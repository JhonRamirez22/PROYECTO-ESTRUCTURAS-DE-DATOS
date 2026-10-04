import { describe, expect, it } from "vitest";
import {
  COURIER_LOCATION_MAX_AGE_MS,
  isCourierLocationFresh,
} from "@/lib/courierLocation";

describe("freshness of courier GPS", () => {
  const now = new Date("2026-09-23T15:00:00.000Z");

  it("accepts a recent position at the configured boundary", () => {
    expect(
      isCourierLocationFresh(
        new Date(now.getTime() - COURIER_LOCATION_MAX_AGE_MS),
        now,
      ),
    ).toBe(true);
  });

  it("rejects missing, expired, and future positions", () => {
    expect(isCourierLocationFresh(null, now)).toBe(false);
    expect(
      isCourierLocationFresh(
        new Date(now.getTime() - COURIER_LOCATION_MAX_AGE_MS - 1),
        now,
      ),
    ).toBe(false);
    expect(isCourierLocationFresh(new Date(now.getTime() + 1), now)).toBe(false);
  });
});
