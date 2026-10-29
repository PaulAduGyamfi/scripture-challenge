import { describe, it, expect, vi } from "vitest";

// Without a time zone, day and week keys follow the process's, as the bot always has
vi.hoisted(() => {
  process.env.TZ = "America/New_York";
});

import { dayKey, weekKey } from "../src/domain/calendar";

// Tuesday 4 March 2026, 03:30 UTC: still Monday evening in New York, Tuesday midday in Tokyo
const TUESDAY_0330_UTC = Date.UTC(2026, 2, 4, 3, 30);
// Monday 2 March 2026, 03:00 UTC: still Sunday evening in New York, Monday midday in Tokyo
const MONDAY_0300_UTC = Date.UTC(2026, 2, 2, 3, 0);

describe("dayKey", () => {
  it("uses the process time zone by default", () => {
    expect(dayKey(TUESDAY_0330_UTC)).toBe("2026-03-03");
  });

  it("uses the given time zone", () => {
    expect(dayKey(TUESDAY_0330_UTC, "America/New_York")).toBe("2026-03-03");
    expect(dayKey(TUESDAY_0330_UTC, "Asia/Tokyo")).toBe("2026-03-04");
  });
});

describe("weekKey", () => {
  it("uses the process time zone by default", () => {
    expect(weekKey(MONDAY_0300_UTC)).toBe("2026-02-23");
    expect(weekKey(TUESDAY_0330_UTC)).toBe("2026-03-02");
  });

  it("uses the given time zone's week, in the same key format as the default", () => {
    expect(weekKey(MONDAY_0300_UTC, "America/New_York")).toBe("2026-02-23");
    // Tokyo is already in Monday 2 March; its Monday midnight is 1 March 15:00 UTC
    expect(weekKey(MONDAY_0300_UTC, "Asia/Tokyo")).toBe("2026-03-01");
  });

  // A key built with a time zone must equal the one the bot would save running in that zone,
  // or players' weekly points would reset mid-week. Covers a DST change (8 March in New York).
  it.each(["America/New_York", "Asia/Tokyo", "Europe/Berlin", "UTC"])(
    "matches the default when the process runs in %s",
    zone => {
      const original = process.env.TZ;
      process.env.TZ = zone;
      try {
        for (let h = 0; h < 24 * 14; h += 5) {
          const ms = MONDAY_0300_UTC + h * 3_600_000;
          expect(weekKey(ms, zone)).toBe(weekKey(ms));
          expect(dayKey(ms, zone)).toBe(dayKey(ms));
        }
      } finally {
        process.env.TZ = original;
      }
    }
  );
});
