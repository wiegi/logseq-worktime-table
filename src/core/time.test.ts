import { describe, expect, it } from "vitest";

import {
  calculateDuration,
  formatMinutesToHHMM,
  minutesToDecimalDuration,
  normalizeTime,
  parseOffsetHours,
  parseTimeToMinutes,
  parseTimeValue,
  validateRow,
} from "./time";

describe("time utilities", () => {
  it("normalizes 24-hour time values", () => {
    expect(normalizeTime("8:30")).toBe("08:30");
    expect(normalizeTime("08:30")).toBe("08:30");
  });

  it("parses valid 24-hour and 12-hour times", () => {
    expect(parseTimeToMinutes("08:30")).toBe(510);
    expect(parseTimeToMinutes("8:30 PM")).toBe(20 * 60 + 30);
    expect(parseTimeValue("12:05 am")).toEqual({
      minutes: 5,
      normalized: "00:05",
    });
  });

  it("rejects invalid time values", () => {
    expect(normalizeTime("24:00")).toBeNull();
    expect(parseTimeToMinutes("8:75")).toBeNull();
    expect(parseTimeValue("nope")).toBeNull();
  });

  it("validates rows with time errors and ordering problems", () => {
    expect(
      validateRow({
        task: "Focus",
        start: "08:00",
        end: "09:30",
      }),
    ).toEqual({ ok: true });

    expect(
      validateRow({
        task: "Focus",
        start: "25:00",
        end: "09:30",
      }),
    ).toEqual({
      ok: false,
      message: "Start time must be in H:mm/HH:mm or h:mm AM/PM format.",
    });

    expect(
      validateRow({
        task: "Focus",
        start: "10:00",
        end: "09:30",
      }),
    ).toEqual({
      ok: false,
      message: "End must be after Start (no overnight shifts in the MVP).",
    });
  });

  it("calculates duration in minutes", () => {
    expect(calculateDuration("08:15", "12:45")).toBe(270);
    expect(calculateDuration("13:00", "11:00")).toBeNull();
    expect(calculateDuration("invalid", "11:00")).toBeNull();
  });

  it("converts durations to stable HH:MM and decimal values", () => {
    expect(formatMinutesToHHMM(270)).toBe("04:30");
    expect(formatMinutesToHHMM(-30)).toBe("-00:30");
    expect(minutesToDecimalDuration(270)).toBe("4.50");
    expect(minutesToDecimalDuration(-30)).toBe("0.00");
  });

  it("parses offset hour values", () => {
    expect(parseOffsetHours("1.25")).toBe(1.25);
    expect(parseOffsetHours("-0,5")).toBe(-0.5);
    expect(parseOffsetHours("oops")).toBeNull();
  });
});
