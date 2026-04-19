import {
  calculateDuration,
  formatIndustrialHours,
  formatMinutesToHHMM,
  minutesToDecimalDuration,
  parseOffsetHours,
  parseTimeToMinutes,
  type InputRow,
} from "./time";

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
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) return value;
  return use12HourClock
    ? formatMinutesToClock12(minutes)
    : formatMinutesToClock24(minutes);
}

function formatClockCellOrPlaceholder(
  value: string,
  use12HourClock: boolean,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return EMPTY_TIME_PLACEHOLDER;
  return formatClockCell(trimmed, use12HourClock);
}

function formatBoldCell(value: string): string {
  return value.length > 0 ? `**${value}**` : "";
}

export const WORKTIME_TABLE_HEADER =
  "| Task | Start | End | Duration | Duration (dec.) |";
export const WORKTIME_TABLE_SEPARATOR = "|---|---:|---:|---:|---:|";
export const WORKTIME_TABLE_SUM_LABEL = "Total";
const EMPTY_TIME_PLACEHOLDER = "--:--";
const OFFSET_ROW_MARKER = "<!--wt:offset-->";

export interface CalculatedRow {
  kind?: "subtotal" | "offset";
  task: string;
  start: string;
  end: string;
  durationHHMM: string;
  industrialHours: string;
  durationMinutes: number | null;
}

export interface SummarySection {
  label: string;
  minutes: number;
  earliestStartMinutes: number | null;
}

export interface WorktimeSummary {
  totalMinutes: number;
  earliestStartMinutes: number | null;
  sections: SummarySection[];
}

export function calculateRows(rows: InputRow[]): CalculatedRow[] {
  const calculated: CalculatedRow[] = [];
  for (const row of rows) {
    if (row.kind === "subtotal") {
      calculated.push({
        kind: "subtotal",
        task: row.task.trim().length > 0 ? row.task.trim() : "Subtotal",
        start: "",
        end: "",
        durationMinutes: null,
        durationHHMM: "",
        industrialHours: "",
      });
      continue;
    }

    if (row.kind === "offset") {
      const hours = parseOffsetHours(row.start);
      const minutes = hours === null ? null : Math.round(hours * 60);
      calculated.push({
        kind: "offset",
        task: row.task.trim(),
        start: "",
        end: "",
        durationMinutes: minutes,
        durationHHMM: minutes === null ? "" : formatMinutesToHHMM(minutes),
        industrialHours:
          minutes === null ? "" : minutesToDecimalDuration(minutes),
      });
      continue;
    }

    const start = row.start.trim();
    const end = row.end.trim();
    const task = row.task.trim();

    const durationMinutes =
      start.length > 0 && end.length > 0 ? calculateDuration(start, end) : null;

    calculated.push({
      task,
      start,
      end,
      durationMinutes,
      durationHHMM:
        durationMinutes === null ? "" : formatMinutesToHHMM(durationMinutes),
      industrialHours:
        durationMinutes === null
          ? ""
          : minutesToDecimalDuration(durationMinutes),
    });
  }
  return calculated;
}

export function summarizeCalculatedRows(
  calculatedRows: CalculatedRow[],
): WorktimeSummary {
  let totalMinutes = 0;
  let earliestStartMinutes: number | null = null;
  let sectionMinutes = 0;
  let sectionStartMinutes: number | null = null;
  const sections: SummarySection[] = [];

  for (const row of calculatedRows) {
    if (row.kind === "subtotal") {
      sections.push({
        label: row.task.trim().length > 0 ? row.task.trim() : "Subtotal",
        minutes: sectionMinutes,
        earliestStartMinutes: sectionStartMinutes,
      });
      sectionMinutes = 0;
      sectionStartMinutes = null;
      continue;
    }

    if (typeof row.durationMinutes === "number") {
      totalMinutes += row.durationMinutes;
      sectionMinutes += row.durationMinutes;
    }

    const startMin = parseTimeToMinutes(row.start);
    if (startMin !== null) {
      earliestStartMinutes =
        earliestStartMinutes === null
          ? startMin
          : Math.min(earliestStartMinutes, startMin);
      sectionStartMinutes =
        sectionStartMinutes === null
          ? startMin
          : Math.min(sectionStartMinutes, startMin);
    }
  }

  return {
    totalMinutes,
    earliestStartMinutes,
    sections,
  };
}

function formatSummaryRowMarkdown(
  label: string,
  minutes: number,
  earliestStartMinutes: number | null,
  use12HourClock: boolean,
  showTimeRange: boolean,
): string {
  const startCell = showTimeRange
    ? earliestStartMinutes !== null
      ? use12HourClock
        ? formatMinutesToClock12(earliestStartMinutes)
        : formatMinutesToClock24(earliestStartMinutes)
      : EMPTY_TIME_PLACEHOLDER
    : "";

  const endCell = showTimeRange
    ? earliestStartMinutes !== null
      ? use12HourClock
        ? formatMinutesToClock12(earliestStartMinutes + minutes)
        : formatMinutesToClock24(earliestStartMinutes + minutes)
      : EMPTY_TIME_PLACEHOLDER
    : "";

  return (
    "| **" +
    escapeCell(label) +
    "** | " +
    formatBoldCell(startCell) +
    " | " +
    formatBoldCell(endCell) +
    " | " +
    formatBoldCell(formatMinutesToHHMM(minutes)) +
    " | " +
    formatBoldCell(formatIndustrialHours(minutes)) +
    " |"
  );
}

function formatSummaryRowCsv(
  label: string,
  minutes: number,
  earliestStartMinutes: number | null,
  use12HourClock: boolean,
  showTimeRange: boolean,
): string[] {
  const startCell =
    showTimeRange && earliestStartMinutes !== null
      ? use12HourClock
        ? formatMinutesToClock12(earliestStartMinutes)
        : formatMinutesToClock24(earliestStartMinutes)
      : "";

  const endCell =
    showTimeRange && earliestStartMinutes !== null
      ? use12HourClock
        ? formatMinutesToClock12(earliestStartMinutes + minutes)
        : formatMinutesToClock24(earliestStartMinutes + minutes)
      : "";

  return [
    escapeCsvCell(label),
    escapeCsvCell(startCell),
    escapeCsvCell(endCell),
    escapeCsvCell(formatMinutesToHHMM(minutes)),
    escapeCsvCell(formatIndustrialHours(minutes)),
  ];
}

function formatTaskCellMarkdown(task: string, isOffset = false): string {
  const escaped = escapeCell(task);
  return isOffset ? `${OFFSET_ROW_MARKER}${escaped}` : escaped;
}

function formatRowTaskMarkdown(row: CalculatedRow): string {
  if (row.kind === "offset") {
    return formatTaskCellMarkdown(row.task, true);
  }

  return formatTaskCellMarkdown(row.task);
}

function stripLegacyTaskIndent(value: string): string {
  return value.replace(/^(?:&nbsp;|\u00a0|\s)+/gi, "");
}

function hasOffsetRowMarker(value: string): boolean {
  return value.includes(OFFSET_ROW_MARKER);
}

function stripOffsetRowMarker(value: string): string {
  return value.split(OFFSET_ROW_MARKER).join("").trim();
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

function normalizeParsedCell(
  value: string,
  options?: { stripIndent?: boolean; stripOffsetMarker?: boolean },
): string {
  let result = unescapeCell(value ?? "");
  if (options?.stripOffsetMarker) {
    result = stripOffsetRowMarker(result);
  }
  if (options?.stripIndent) {
    result = stripLegacyTaskIndent(result);
  }
  result = stripBold(result);
  return result.trim();
}

function normalizeParsedTimeCell(value: string): string {
  const result = normalizeParsedCell(value);
  const plain = stripHtmlTags(result);
  return plain === EMPTY_TIME_PLACEHOLDER || plain === "—:—" ? "" : result;
}

export function buildMarkdownTable(
  calculatedRows: CalculatedRow[],
  options?: {
    use12HourClock?: boolean;
    showTotalRowTimeRange?: boolean;
  },
): string {
  const header = `${WORKTIME_TABLE_HEADER}\n${WORKTIME_TABLE_SEPARATOR}\n`;
  const use12HourClock = Boolean(options?.use12HourClock);
  const showTotalRowTimeRange = Boolean(options?.showTotalRowTimeRange);
  const summary = summarizeCalculatedRows(calculatedRows);

  let sectionIndex = 0;
  const body = calculatedRows
    .map((row) => {
      if (row.kind === "subtotal") {
        const section = summary.sections[sectionIndex++];
        return formatSummaryRowMarkdown(
          section?.label ?? "Subtotal",
          section?.minutes ?? 0,
          section?.earliestStartMinutes ?? null,
          use12HourClock,
          showTotalRowTimeRange,
        );
      }

      const startCell =
        row.kind === "offset"
          ? ""
          : formatClockCellOrPlaceholder(row.start, use12HourClock);
      const endCell =
        row.kind === "offset"
          ? ""
          : formatClockCellOrPlaceholder(row.end, use12HourClock);
      return `| ${formatRowTaskMarkdown(row)} | ${startCell} | ${endCell} | ${row.durationHHMM} | ${row.industrialHours} |`;
    })
    .join("\n");

  const footer =
    formatSummaryRowMarkdown(
      WORKTIME_TABLE_SUM_LABEL,
      summary.totalMinutes,
      summary.earliestStartMinutes,
      use12HourClock,
      showTotalRowTimeRange,
    ) + "\n";

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
  const summary = summarizeCalculatedRows(calculatedRows);

  let sectionIndex = 0;
  const lines: string[] = [];
  lines.push("Task,Start,End,Duration,Duration (dec.)");

  for (const row of calculatedRows) {
    if (row.kind === "subtotal") {
      const section = summary.sections[sectionIndex++];
      lines.push(
        formatSummaryRowCsv(
          section?.label ?? "Subtotal",
          section?.minutes ?? 0,
          section?.earliestStartMinutes ?? null,
          use12HourClock,
          showTotalRowTimeRange,
        ).join(","),
      );
      continue;
    }

    const startCell = formatClockCell(row.start, use12HourClock);
    const endCell = formatClockCell(row.end, use12HourClock);

    lines.push(
      [
        escapeCsvCell(row.task),
        escapeCsvCell(startCell),
        escapeCsvCell(endCell),
        escapeCsvCell(row.durationHHMM),
        escapeCsvCell(row.industrialHours),
      ].join(","),
    );
  }

  lines.push(
    formatSummaryRowCsv(
      WORKTIME_TABLE_SUM_LABEL,
      summary.totalMinutes,
      summary.earliestStartMinutes,
      use12HourClock,
      showTotalRowTimeRange,
    ).join(","),
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
    .map((cell) => cell.trim());
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
  if (first.length > 0) return false;

  const start = (cells[1] ?? "").trim();
  const end = (cells[2] ?? "").trim();
  if (start.length > 0 || end.length > 0) return false;

  const rest = cells.slice(3).join("|");
  return rest.includes("**");
}

function isSubtotalRow(cells: string[]): boolean {
  const first = stripBold(cells[0] ?? "")
    .trim()
    .toLowerCase();
  if (first.length === 0 || first === WORKTIME_TABLE_SUM_LABEL.toLowerCase()) {
    return false;
  }

  const durCell = (cells[3] ?? "").trim();
  const indCell = (cells[4] ?? "").trim();
  const isBoldSummary =
    /^\*\*.*\*\*$/.test(durCell) || /^\*\*.*\*\*$/.test(indCell);
  if (!isBoldSummary) return false;

  return (
    parseSignedHHMM(stripBold(durCell)) !== null ||
    parseNumber(stripBold(indCell)) !== null
  );
}

export type ParseTableResult =
  | { ok: true; rows: InputRow[] }
  | { ok: false; message: string };

function parseSignedHHMM(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const match = /^(-)?(\d+):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const sign = match[1] ? -1 : 1;
  const hh = Number(match[2]);
  const mm = Number(match[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (mm < 0 || mm > 59) return null;
  return sign * (hh * 60 + mm);
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
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
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0) break;
    if (!line.startsWith("|")) break;

    const cells = parsePipeRowCells(line);
    if (!cells) continue;
    if (cells.length < 3) continue;

    const rawTaskCell = unescapeCell(cells[0] ?? "");
    const hasMarkedOffsetRow = hasOffsetRowMarker(rawTaskCell);
    const cellTask = normalizeParsedCell(cells[0] ?? "", {
      stripIndent: true,
      stripOffsetMarker: true,
    });
    const cellStart = normalizeParsedTimeCell(cells[1] ?? "");
    const cellEnd = normalizeParsedTimeCell(cells[2] ?? "");

    if (isSubtotalRow(cells)) {
      rows.push({
        kind: "subtotal",
        task: cellTask.trim() || "Subtotal",
        start: "",
        end: "",
      });
      continue;
    }

    if (isTotalRow(cells)) break;

    if (cellStart.length === 0 && cellEnd.length === 0) {
      const durCell = normalizeParsedCell(cells[3] ?? "");
      const indCell = normalizeParsedCell(cells[4] ?? "");

      const minutesFromHHMM = parseSignedHHMM(durCell);
      const industrial = parseNumber(indCell);
      const minutesFromIndustrial =
        industrial === null ? null : Math.round(industrial * 60);

      const minutes = minutesFromHHMM ?? minutesFromIndustrial;
      if (minutes !== null || hasMarkedOffsetRow) {
        rows.push({
          kind: "offset",
          task: cellTask === "-" ? "" : cellTask,
          start:
            industrial !== null
              ? String(industrial)
              : minutes !== null
                ? (minutes / 60).toFixed(2)
                : "",
          end: "",
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

  return { ok: true, rows };
}
