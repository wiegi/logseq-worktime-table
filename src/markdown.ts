import {
  formatIndustrialHours,
  formatMinutesToHHMM,
  getDurationMinutes,
  type InputRow,
} from "./time";

const TIME_24H_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TIME_12H_RE = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*([AaPp][Mm])$/;

function parseTimeToMinutesLocal(value: string): number | null {
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

function formatMinutesToClock24(totalMinutes: number): string {
  const safe = Math.floor(totalMinutes);
  const hh = String(Math.floor((((safe % 1440) + 1440) % 1440) / 60)).padStart(
    2,
    "0",
  );
  const mm = String((((safe % 1440) + 1440) % 1440) % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatMinutesToClock12(totalMinutes: number): string {
  const safe = Math.floor(totalMinutes);
  const normalized = ((safe % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const isPm = hours24 >= 12;
  const hours12 = ((hours24 + 11) % 12) + 1;
  const mm = String(minutes).padStart(2, "0");
  return `${hours12}:${mm} ${isPm ? "PM" : "AM"}`;
}

function formatClockCell(value: string, use12HourClock: boolean): string {
  const minutes = parseTimeToMinutesLocal(value);
  if (minutes === null) return value;
  return use12HourClock
    ? formatMinutesToClock12(minutes)
    : formatMinutesToClock24(minutes);
}

function formatBoldCell(value: string): string {
  return value.length > 0 ? `**${value}**` : "";
}

export interface OffsetRow {
  task: string;
  minutes: number;
}

export const WORKTIME_TABLE_HEADER =
  "| Task | Start | End | Duration | Duration (dec.) |";
export const WORKTIME_TABLE_SEPARATOR = "|---|---:|---:|---:|---:|";
export const WORKTIME_TABLE_SUM_LABEL = "Total";

export interface CalculatedRow {
  task: string;
  start: string;
  end: string;
  durationHHMM: string;
  industrialHours: string;
  durationMinutes: number | null;
}

export function calculateRows(rows: InputRow[]): CalculatedRow[] {
  const calculated: CalculatedRow[] = [];
  for (const row of rows) {
    const start = row.start.trim();
    const end = row.end.trim();
    const taskTrimmed = row.task.trim();
    const isFullyEmpty =
      taskTrimmed.length === 0 && start.length === 0 && end.length === 0;
    const task = isFullyEmpty ? "" : taskTrimmed.length > 0 ? taskTrimmed : "-";

    const durationMinutes =
      start.length > 0 && end.length > 0
        ? getDurationMinutes(start, end)
        : null;

    calculated.push({
      task,
      start,
      end,
      durationMinutes,
      durationHHMM:
        durationMinutes === null ? "" : formatMinutesToHHMM(durationMinutes),
      industrialHours:
        durationMinutes === null ? "" : formatIndustrialHours(durationMinutes),
    });
  }
  return calculated;
}

export function buildMarkdownTable(
  calculatedRows: CalculatedRow[],
  options?: {
    use12HourClock?: boolean;
    showTotalRowTimeRange?: boolean;
  },
): string {
  const header = `${WORKTIME_TABLE_HEADER}\n${WORKTIME_TABLE_SEPARATOR}\n`;

  let totalMinutes = 0;
  let totalIndustrial = 0;
  let earliestStartMinutes: number | null = null;

  const body = calculatedRows
    .map((r) => {
      if (typeof r.durationMinutes === "number") {
        totalMinutes += r.durationMinutes;
        totalIndustrial += r.durationMinutes / 60;
      }

      const startMin = parseTimeToMinutesLocal(r.start);
      if (startMin !== null) {
        earliestStartMinutes =
          earliestStartMinutes === null
            ? startMin
            : Math.min(earliestStartMinutes, startMin);
      }

      const use12HourClock = Boolean(options?.use12HourClock);
      const startCell = formatClockCell(r.start, use12HourClock);
      const endCell = formatClockCell(r.end, use12HourClock);
      return `| ${escapeCell(r.task)} | ${startCell} | ${endCell} | ${r.durationHHMM} | ${r.industrialHours} |`;
    })
    .join("\n");

  const totalHHMM = formatMinutesToHHMM(totalMinutes);
  const totalIndustrialStr = totalIndustrial.toFixed(2);
  const showTotalRowTimeRange = Boolean(options?.showTotalRowTimeRange);

  const totalStart =
    !showTotalRowTimeRange || earliestStartMinutes === null
      ? ""
      : Boolean(options?.use12HourClock)
        ? formatMinutesToClock12(earliestStartMinutes)
        : formatMinutesToClock24(earliestStartMinutes);

  const totalEnd =
    !showTotalRowTimeRange || earliestStartMinutes === null
      ? ""
      : Boolean(options?.use12HourClock)
        ? formatMinutesToClock12(earliestStartMinutes + totalMinutes)
        : formatMinutesToClock24(earliestStartMinutes + totalMinutes);

  const footer =
    "| **Total** | " +
    formatBoldCell(totalStart) +
    " | " +
    formatBoldCell(totalEnd) +
    " | " +
    formatBoldCell(totalHHMM) +
    " | " +
    formatBoldCell(totalIndustrialStr) +
    " |\n";

  return header + (body ? body + "\n" : "") + footer;
}

function escapeCsvCell(value: string): string {
  const s = value ?? "";
  if (/[\r\n",]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsvTable(
  calculatedRows: CalculatedRow[],
  options?: {
    use12HourClock?: boolean;
    showTotalRowTimeRange?: boolean;
  },
): string {
  const use12HourClock = Boolean(options?.use12HourClock);
  const showTotalRowTimeRange = Boolean(options?.showTotalRowTimeRange);

  let totalMinutes = 0;
  let totalIndustrial = 0;
  let earliestStartMinutes: number | null = null;

  const lines: string[] = [];
  lines.push("Task,Start,End,Duration,Duration (dec.)");

  for (const r of calculatedRows) {
    if (typeof r.durationMinutes === "number") {
      totalMinutes += r.durationMinutes;
      totalIndustrial += r.durationMinutes / 60;
    }

    const startMin = parseTimeToMinutesLocal(r.start);
    if (startMin !== null) {
      earliestStartMinutes =
        earliestStartMinutes === null
          ? startMin
          : Math.min(earliestStartMinutes, startMin);
    }

    const startCell = formatClockCell(r.start, use12HourClock);
    const endCell = formatClockCell(r.end, use12HourClock);

    lines.push(
      [
        escapeCsvCell(r.task),
        escapeCsvCell(startCell),
        escapeCsvCell(endCell),
        escapeCsvCell(r.durationHHMM),
        escapeCsvCell(r.industrialHours),
      ].join(","),
    );
  }

  const totalHHMM = formatMinutesToHHMM(totalMinutes);
  const totalIndustrialStr = totalIndustrial.toFixed(2);

  const totalStart =
    !showTotalRowTimeRange || earliestStartMinutes === null
      ? ""
      : use12HourClock
        ? formatMinutesToClock12(earliestStartMinutes)
        : formatMinutesToClock24(earliestStartMinutes);

  const totalEnd =
    !showTotalRowTimeRange || earliestStartMinutes === null
      ? ""
      : use12HourClock
        ? formatMinutesToClock12(earliestStartMinutes + totalMinutes)
        : formatMinutesToClock24(earliestStartMinutes + totalMinutes);

  lines.push(
    [
      escapeCsvCell(WORKTIME_TABLE_SUM_LABEL),
      escapeCsvCell(totalStart),
      escapeCsvCell(totalEnd),
      escapeCsvCell(totalHHMM),
      escapeCsvCell(totalIndustrialStr),
    ].join(","),
  );

  return lines.join("\r\n") + "\r\n";
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function unescapeCell(value: string): string {
  return value.replace(/\\\|/g, "|").trim();
}

function stripBold(value: string): string {
  return value.replace(/^\*\*(.*)\*\*$/, "$1").trim();
}

function parsePipeRowCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const normalized = trimmed.endsWith("|") ? trimmed : `${trimmed}|`;
  const cells = normalized
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
  return cells.length > 0 ? cells : null;
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  if (!/^\|[\s:\-|]+\|?$/.test(trimmed)) return false;
  const dashSegments = trimmed.split("|").filter((seg) => /-{3,}/.test(seg));
  return dashSegments.length >= 3;
}

function isHeaderRow(cells: string[]): boolean {
  const c1 = stripBold(cells[1] ?? "").toLowerCase();
  const c2 = stripBold(cells[2] ?? "").toLowerCase();

  const startOk = c1 === "start";
  const endOk = c2.startsWith("end");

  return startOk && endOk;
}

function isTotalRow(cells: string[]): boolean {
  const first = stripBold(cells[0] ?? "")
    .trim()
    .toLowerCase();
  if (first === WORKTIME_TABLE_SUM_LABEL.toLowerCase()) return true;
  const start = (cells[1] ?? "").trim();
  const end = (cells[2] ?? "").trim();
  if (start.length > 0 || end.length > 0) return false;

  const rest = cells.slice(3).join("|");
  return rest.includes("**");
}

export type ParseTableResult =
  | { ok: true; rows: InputRow[]; offsets: OffsetRow[] }
  | { ok: false; message: string };

function parseSignedHHMM(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const m = /^(-)?(\d+):(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const sign = m[1] ? -1 : 1;
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (mm < 0 || mm > 59) return null;
  return sign * (hh * 60 + mm);
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function parseWorktimeTableFromMarkdown(
  markdown: string,
  maxRows = 500,
): ParseTableResult {
  const lines = markdown.split(/\r?\n/);

  const normalizedHeader = WORKTIME_TABLE_HEADER.trim();
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (line === normalizedHeader) {
      headerIndex = i;
      break;
    }

    const cells = parsePipeRowCells(line);
    if (!cells) continue;
    if (cells.length < 3) continue;
    if (isHeaderRow(cells)) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return {
      ok: false,
      message:
        "No worktime table found (header row is missing or was changed too much).",
    };
  }

  const sepLine = lines[headerIndex + 1] ?? "";
  if (
    !isSeparatorRow(sepLine) &&
    sepLine.trim() !== WORKTIME_TABLE_SEPARATOR.trim()
  ) {
    return {
      ok: false,
      message:
        "Worktime table detected, but the separator row (---) is missing or invalid.",
    };
  }

  const rows: InputRow[] = [];
  const offsets: OffsetRow[] = [];
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0) break;
    if (!line.startsWith("|")) break;

    const cells = parsePipeRowCells(line);
    if (!cells) continue;
    if (cells.length < 3) continue;

    const cellTask = unescapeCell(cells[0] ?? "");
    const cellStart = (cells[1] ?? "").trim();
    const cellEnd = (cells[2] ?? "").trim();

    if (isTotalRow(cells)) break;

    if (cellStart.length === 0 && cellEnd.length === 0) {
      const durCell = (cells[3] ?? "").trim();
      const indCell = (cells[4] ?? "").trim();

      const minutesFromHHMM = parseSignedHHMM(durCell);
      const industrial = parseNumber(indCell);
      const minutesFromIndustrial =
        industrial === null ? null : Math.round(industrial * 60);

      const minutes = minutesFromHHMM ?? minutesFromIndustrial;
      if (minutes !== null) {
        offsets.push({
          task: cellTask === "-" ? "" : cellTask,
          minutes,
        });
        continue;
      }
    }

    rows.push({
      task: cellTask === "-" ? "" : cellTask,
      start: cellStart,
      end: cellEnd,
    });

    if (rows.length > maxRows) {
      return {
        ok: false,
        message: `Table contains more than ${maxRows} rows.`,
      };
    }
  }

  return { ok: true, rows, offsets };
}
