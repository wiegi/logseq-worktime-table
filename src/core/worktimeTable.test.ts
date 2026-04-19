import { describe, expect, it } from "vitest";

import type { InputRow } from "./time";
import {
  buildCsvTable,
  buildMarkdownTable,
  calculateRows,
  parseWorktimeTableFromMarkdown,
  summarizeCalculatedRows,
} from "./worktimeTable";

const exampleRows: InputRow[] = [
  { task: "Deep work", start: "08:00", end: "10:30" },
  { task: "", start: "", end: "" },
  { kind: "offset", task: "Break", start: "-0.50", end: "" },
  { kind: "subtotal", task: "Morning subtotal", start: "", end: "" },
  { task: "Support", start: "11:00", end: "13:15" },
];

describe("worktime table logic", () => {
  it("calculates row durations including offsets", () => {
    const calculated = calculateRows(exampleRows);

    expect(calculated).toMatchObject([
      {
        task: "Deep work",
        durationMinutes: 150,
        durationHHMM: "02:30",
        industrialHours: "2.50",
      },
      {
        task: "",
        durationMinutes: null,
        durationHHMM: "",
        industrialHours: "",
      },
      {
        kind: "offset",
        task: "Break",
        durationMinutes: -30,
        durationHHMM: "-00:30",
        industrialHours: "0.00",
      },
      {
        kind: "subtotal",
        task: "Morning subtotal",
      },
      {
        task: "Support",
        durationMinutes: 135,
        durationHHMM: "02:15",
        industrialHours: "2.25",
      },
    ]);
  });

  it("computes subtotal and total values while ignoring empty rows", () => {
    const summary = summarizeCalculatedRows(calculateRows(exampleRows));

    expect(summary.sections).toEqual([
      {
        label: "Morning subtotal",
        minutes: 120,
        earliestStartMinutes: 8 * 60,
      },
    ]);
    expect(summary.totalMinutes).toBe(255);
    expect(summary.earliestStartMinutes).toBe(8 * 60);
  });

  it("builds stable markdown output for work, subtotal, and total rows", () => {
    const markdown = buildMarkdownTable(calculateRows(exampleRows));

    expect(markdown).toBe(
      [
        "| Task | Start | End | Duration | Duration (dec.) |",
        "|---|---:|---:|---:|---:|",
        "| Deep work | 08:00 | 10:30 | 02:30 | 2.50 |",
        "|  | --:-- | --:-- |  |  |",
        "| <!--wt:offset-->Break |  |  | -00:30 | 0.00 |",
        "| **Morning subtotal** |  |  | **02:00** | **2.00** |",
        "| Support | 11:00 | 13:15 | 02:15 | 2.25 |",
        "| **Total** |  |  | **04:15** | **4.25** |",
        "",
      ].join("\n"),
    );
  });

  it("builds stable CSV output for work, subtotal, and total rows", () => {
    const csv = buildCsvTable(calculateRows(exampleRows));

    expect(csv).toBe(
      [
        "Task,Start,End,Duration,Duration (dec.)",
        "Deep work,08:00,10:30,02:30,2.50",
        ",,,,",
        "Break,,,-00:30,0.00",
        "Morning subtotal,,,02:00,2.00",
        "Support,11:00,13:15,02:15,2.25",
        "Total,,,04:15,4.25",
        "",
      ].join("\r\n"),
    );
  });

  it("escapes CSV cells and applies 12-hour summary time ranges", () => {
    const csv = buildCsvTable(
      calculateRows([
        { task: 'Planning, "alpha"', start: "08:00", end: "09:30" },
        { kind: "subtotal", task: "AM subtotal", start: "", end: "" },
        { task: "Review", start: "10:00", end: "12:30" },
      ]),
      {
        use12HourClock: true,
        showTotalRowTimeRange: true,
      },
    );

    expect(csv).toBe(
      [
        "Task,Start,End,Duration,Duration (dec.)",
        '"Planning, ""alpha""",8:00 AM,9:30 AM,01:30,1.50',
        "AM subtotal,8:00 AM,9:30 AM,01:30,1.50",
        "Review,10:00 AM,12:30 PM,02:30,2.50",
        "Total,8:00 AM,12:00 PM,04:00,4.00",
        "",
      ].join("\r\n"),
    );
  });

  it("parses generated markdown back into editable input rows", () => {
    const markdown = buildMarkdownTable(calculateRows(exampleRows));
    const parsed = parseWorktimeTableFromMarkdown(markdown);

    expect(parsed).toEqual({
      ok: true,
      rows: [
        { task: "Deep work", start: "08:00", end: "10:30" },
        { task: "", start: "", end: "" },
        { kind: "offset", task: "Break", start: "0", end: "" },
        {
          kind: "subtotal",
          task: "Morning subtotal",
          start: "",
          end: "",
        },
        { task: "Support", start: "11:00", end: "13:15" },
      ],
    });
  });

  it("preserves offset rows when markdown uses signed HH:MM values", () => {
    const parsed = parseWorktimeTableFromMarkdown(
      [
        "| Task | Start | End | Duration | Duration (dec.) |",
        "|---|---:|---:|---:|---:|",
        "| <!--wt:offset-->Adjustment |  |  | -01:15 |  |",
        "| **Total** |  |  | **-01:15** | **0.00** |",
      ].join("\n"),
    );

    expect(parsed).toEqual({
      ok: true,
      rows: [{ kind: "offset", task: "Adjustment", start: "-1.25", end: "" }],
    });
  });
});
