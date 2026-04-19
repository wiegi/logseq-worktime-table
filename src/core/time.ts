export type ValidationResult = { ok: true } | { ok: false; message: string };
export type InputRowKind = "work" | "subtotal" | "offset";

const TIME_24H_RE = /^(0?\d|1\d|2[0-3]):([0-5]\d)$/;
const TIME_12H_RE = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*([AaPp][Mm])$/;

export interface ParsedTimeValue {
  minutes: number;
  normalized: string;
}

export interface InputRow {
  task: string;
  start: string;
  end: string;
  kind?: InputRowKind;
}

export function parseTimeToMinutes(value: string): number | null {
  const trimmed = value.trim();

  {
    const match = TIME_24H_RE.exec(trimmed);
    if (match) {
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
      return hours * 60 + minutes;
    }
  }

  {
    const match = TIME_12H_RE.exec(trimmed);
    if (match) {
      const hours12 = Number(match[1]);
      const minutes = Number(match[2]);
      const ampm = String(match[3]).toLowerCase();

      if (!Number.isInteger(hours12) || !Number.isInteger(minutes)) return null;
      if (hours12 < 1 || hours12 > 12) return null;

      const isPm = ampm === "pm";
      const baseHours = hours12 % 12;
      const hours24 = isPm ? baseHours + 12 : baseHours;
      return hours24 * 60 + minutes;
    }
  }

  return null;
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const safe = Math.floor(totalMinutes);
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

export function formatIndustrialHours(totalMinutes: number): string {
  const hours = Math.max(0, totalMinutes) / 60;
  return hours.toFixed(2);
}

export function parseOffsetHours(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed.length === 0) return null;
  const hours = Number(trimmed);
  return Number.isFinite(hours) ? hours : null;
}

export function normalizeTime(input: string): string | null {
  const minutes = parseTimeToMinutes(input);
  return minutes === null ? null : formatMinutesToHHMM(minutes);
}

export function parseTimeValue(input: string): ParsedTimeValue | null {
  const minutes = parseTimeToMinutes(input);
  if (minutes === null) return null;

  return {
    minutes,
    normalized: formatMinutesToHHMM(minutes),
  };
}

export function calculateDuration(start: string, end: string): number | null {
  const startMin = parseTimeToMinutes(start);
  if (startMin === null) return null;
  const endMin = parseTimeToMinutes(end);
  if (endMin === null) return null;
  if (endMin < startMin) return null;
  return endMin - startMin;
}

export function getDurationMinutes(start: string, end: string): number | null {
  return calculateDuration(start, end);
}

export function minutesToDecimalDuration(totalMinutes: number): string {
  return formatIndustrialHours(totalMinutes);
}

export function validateRow(row: InputRow): ValidationResult {
  if (row.kind === "subtotal") return { ok: true };
  if (row.kind === "offset") {
    const task = row.task.trim();
    const hoursRaw = row.start.trim();
    const allEmpty = task.length === 0 && hoursRaw.length === 0;
    if (allEmpty) return { ok: true };

    if (hoursRaw.length > 0 && parseOffsetHours(hoursRaw) === null) {
      return {
        ok: false,
        message: "Offset hours must be a number such as -0.5 or 1.25.",
      };
    }

    return { ok: true };
  }

  const task = row.task.trim();
  const start = row.start.trim();
  const end = row.end.trim();

  const allEmpty = task.length === 0 && start.length === 0 && end.length === 0;
  if (allEmpty) return { ok: true };

  if (start.length > 0 && parseTimeToMinutes(start) === null) {
    return {
      ok: false,
      message: "Start time must be in H:mm/HH:mm or h:mm AM/PM format.",
    };
  }
  if (end.length > 0 && parseTimeToMinutes(end) === null) {
    return {
      ok: false,
      message: "End time must be in H:mm/HH:mm or h:mm AM/PM format.",
    };
  }

  if (start.length > 0 && end.length > 0) {
    const duration = calculateDuration(start, end);
    if (duration === null) {
      return {
        ok: false,
        message: "End must be after Start (no overnight shifts in the MVP).",
      };
    }
  }

  return { ok: true };
}

export function isRowEmpty(row: InputRow): boolean {
  if (row.kind === "subtotal") return false;
  if (row.kind === "offset") {
    return row.task.trim().length === 0 && row.start.trim().length === 0;
  }

  return (
    row.task.trim().length === 0 &&
    row.start.trim().length === 0 &&
    row.end.trim().length === 0
  );
}
