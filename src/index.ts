import "@logseq/libs";

import type { InputRow } from "./time";
import type { OffsetPreset } from "./modal";

const SLASH_COMMAND_WORKTIME = "Worktime Table: Create table";
const EDIT_COMMAND_LABEL = "Worktime Table: Edit";
const EXPORT_CSV_LABEL = "Worktime Table: Export as CSV";

const INIT_GUARD_KEY = "__logseq_worktime_table_initialized__";
const TOP_GUARD_KEY = "__logseq_worktime_table_top_guard__";

const WORKTIME_TABLE_RENDERER = "worktime-table";
const WORKTIME_TABLE_RENDERER_MACRO = `{{renderer :${WORKTIME_TABLE_RENDERER}}}`;
const WORKTIME_TABLE_EDIT_MODEL_FN = "wtEditWorktimeTable";

const SETTINGS_DIALOG_PREFILL_JSON = "dialogPrefillJson";
const SETTINGS_USE_12_HOUR_CLOCK = "use12HourClock";
const SETTINGS_DISABLE_TOTAL_ROW_TIME_RANGE = "disableTotalRowTimeRange";

let rendererRegistered = false;

type TopGuard = {
  activeToken: string;
  handlers?: {
    worktime?: () => Promise<void>;
    edit?: (uuid?: string) => Promise<void>;
    exportCsv?: (uuid?: string) => Promise<void>;
  };
  contextMenuRegistered?: boolean;
  contextMenuExportRegistered?: boolean;
};

function getTopGuard(): TopGuard | null {
  try {
    const topWin = window.top as any;
    if (!topWin) return null;
    if (!topWin[TOP_GUARD_KEY]) {
      topWin[TOP_GUARD_KEY] = {
        activeToken: "",
        handlers: {},
      } satisfies TopGuard;
    }
    return topWin[TOP_GUARD_KEY] as TopGuard;
  } catch {
    return null;
  }
}

const instanceToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function isActiveInstance(): boolean {
  const guard = getTopGuard();
  if (!guard) return true;
  return guard.activeToken === instanceToken;
}

function activateThisInstance(): void {
  const guard = getTopGuard();
  if (!guard) return;
  guard.activeToken = instanceToken;
}

async function delegateToActiveInstance(
  kind: "worktime" | "edit" | "exportCsv",
  uuid?: string,
): Promise<boolean> {
  const guard = getTopGuard();
  const handler = guard?.handlers?.[kind];
  if (typeof handler !== "function") return false;
  if (kind === "edit" || kind === "exportCsv") await handler(uuid);
  else await handler();
  return true;
}

function sanitizeFilenamePart(value: string): string {
  const s = (value ?? "").trim();
  if (s.length === 0) return "untitled";
  return s
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function journalDayToISO(journalDay: number): string | null {
  const s = String(Math.floor(journalDay));
  if (!/^\d{8}$/.test(s)) return null;
  const yyyy = s.slice(0, 4);
  const mm = s.slice(4, 6);
  const dd = s.slice(6, 8);
  return `${yyyy}-${mm}-${dd}`;
}

async function suggestCsvFilenameFromBlock(uuid: string): Promise<string> {
  try {
    const block = await logseq.Editor.getBlock(uuid);
    const pageId = (block as any)?.page?.id;
    if (typeof pageId === "number") {
      const page = await logseq.Editor.getPage(pageId);
      const isJournal = Boolean((page as any)?.["journal?"]);
      const journalDay = (page as any)?.journalDay;
      if (isJournal && typeof journalDay === "number") {
        const iso = journalDayToISO(journalDay);
        if (iso) return `worktime-table_${iso}.csv`;
      }

      const name =
        typeof (page as any)?.originalName === "string"
          ? ((page as any).originalName as string)
          : typeof (page as any)?.name === "string"
            ? ((page as any).name as string)
            : "";
      const safe = sanitizeFilenamePart(name);
      return `worktime-table_${safe}.csv`;
    }
  } catch {}
  return "worktime-table.csv";
}

function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/csv;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

function showMsg(
  message: string,
  type: "success" | "error" | "warning" = "success",
): void {
  void logseq.UI.showMsg(message, type);
}

function normalizeRows(rows: InputRow[]): InputRow[] {
  return rows.map((r) => ({
    task: r.task ?? "",
    start: r.start ?? "",
    end: r.end ?? "",
  }));
}

function isFullyEmptyRow(row: InputRow): boolean {
  return (
    (row.task ?? "").trim().length === 0 &&
    (row.start ?? "").trim().length === 0 &&
    (row.end ?? "").trim().length === 0
  );
}

function trimOuterEmptyRows(rows: InputRow[]): InputRow[] {
  let startIndex = 0;
  let endIndex = rows.length;

  while (startIndex < endIndex && isFullyEmptyRow(rows[startIndex]!)) {
    startIndex++;
  }
  while (endIndex > startIndex && isFullyEmptyRow(rows[endIndex - 1]!)) {
    endIndex--;
  }

  return rows.slice(startIndex, endIndex);
}

type DialogPrefill = {
  rows?: InputRow[];
  offsets?: OffsetPreset[];
};

function readDialogPrefillFromSettings(): DialogPrefill {
  const s = (logseq as any).settings as Record<string, unknown> | undefined;
  const raw =
    typeof s?.[SETTINGS_DIALOG_PREFILL_JSON] === "string"
      ? (s[SETTINGS_DIALOG_PREFILL_JSON] as string).trim()
      : "";

  if (raw.length === 0) return {};

  try {
    const parsed = JSON.parse(raw) as any;
    const result: DialogPrefill = {};

    if (Array.isArray(parsed?.rows)) {
      result.rows = parsed.rows.map((r: any) => ({
        task: typeof r?.task === "string" ? r.task : "",
        start: typeof r?.start === "string" ? r.start : "",
        end: typeof r?.end === "string" ? r.end : "",
      }));
    }

    if (Array.isArray(parsed?.offsets)) {
      const offsets: OffsetPreset[] = parsed.offsets
        .map((o: any) => ({
          hours:
            typeof o?.hours === "number"
              ? o.hours
              : typeof o?.hours === "string"
                ? Number(String(o.hours).trim().replace(",", "."))
                : 0,
          task: typeof o?.task === "string" ? o.task : "",
        }))
        .filter((o: OffsetPreset) => Number.isFinite(o.hours));
      result.offsets = offsets;
    }

    return result;
  } catch {
    return {};
  }
}

function readUse12HourClockFromSettings(): boolean {
  const s = (logseq as any).settings as Record<string, unknown> | undefined;
  return Boolean(s?.[SETTINGS_USE_12_HOUR_CLOCK]);
}

function readDisableTotalRowTimeRangeFromSettings(): boolean {
  const s = (logseq as any).settings as Record<string, unknown> | undefined;
  return Boolean(s?.[SETTINGS_DISABLE_TOTAL_ROW_TIME_RANGE]);
}

function withInlineEditButton(tableMarkdown: string): string {
  return `${WORKTIME_TABLE_RENDERER_MACRO}\n${tableMarkdown}`;
}

function registerInlineEditButton(): void {
  if (rendererRegistered) return;
  rendererRegistered = true;

  logseq.provideStyle(`
    .wt-inline-actions { margin: 4px 0; }
  `);

  logseq.provideModel({
    [WORKTIME_TABLE_EDIT_MODEL_FN]: async (e: any) => {
      if (!isActiveInstance()) return;
      const uuid =
        typeof e?.dataset?.uuid === "string"
          ? (e.dataset.uuid as string)
          : typeof e?.uuid === "string"
            ? (e.uuid as string)
            : undefined;
      await commandEditTable(uuid);
    },
  });

  logseq.App.onMacroRendererSlotted(({ slot, payload }: any) => {
    if (!isActiveInstance()) return;
    const args: unknown = payload?.arguments;
    const type = Array.isArray(args) ? String(args[0] ?? "") : "";
    if (type !== WORKTIME_TABLE_RENDERER) return;

    const uuid = typeof payload?.uuid === "string" ? payload.uuid : "";

    try {
      logseq.provideUI({
        key: slot,
        slot,
        template: `
          <div class="wt-inline-actions">
            <button class="ui__button" data-on-click="${WORKTIME_TABLE_EDIT_MODEL_FN}" data-uuid="${uuid}">
              Edit table
            </button>
          </div>
        `,
      });
    } catch (e) {
      // When blocks rerender quickly (navigation, graph refresh, etc.) the slot
      // can disappear between the event and UI injection, causing NotFoundError.
      console.debug("[logseq-worktime-table] provideUI failed", e);
    }
  });
}

async function insertAtCursor(markdown: string): Promise<void> {
  const editorAny = logseq.Editor as any;
  if (typeof editorAny.insertAtEditingCursor === "function") {
    await editorAny.insertAtEditingCursor(markdown);
    return;
  }

  const current = (await editorAny.getCurrentBlock?.()) as any;
  const uuid =
    typeof current?.uuid === "string" ? (current.uuid as string) : null;
  if (!uuid) throw new Error("No active block/cursor found.");

  await logseq.Editor.insertBlock(uuid, markdown, { sibling: true });
}

async function getTargetBlockUuid(contextUuid?: string): Promise<string> {
  if (contextUuid) return contextUuid;

  const editorAny = logseq.Editor as any;
  const current = (await editorAny.getCurrentBlock?.()) as any;
  const uuid =
    typeof current?.uuid === "string" ? (current.uuid as string) : null;
  if (!uuid) throw new Error("No active block found.");
  return uuid;
}

async function updateBlockContent(
  uuid: string,
  content: string,
): Promise<void> {
  const editorAny = logseq.Editor as any;
  if (typeof editorAny.updateBlock === "function") {
    await editorAny.updateBlock(uuid, content);
    return;
  }
  throw new Error("Logseq API updateBlock is not available.");
}

async function commandWorktime(): Promise<void> {
  if (!isActiveInstance()) {
    await delegateToActiveInstance("worktime");
    return;
  }
  const { getModalController } = await import("./modal");
  const { calculateRows, buildMarkdownTable } = await import("./markdown");
  const { formatIndustrialHours, formatMinutesToHHMM } = await import("./time");

  const modal = getModalController();

  logseq.showMainUI({ autoFocus: true });
  try {
    const prefill = readDialogPrefillFromSettings();
    const initialRows: InputRow[] =
      prefill.rows && prefill.rows.length > 0
        ? prefill.rows
        : [
            {
              task: "",
              start: "",
              end: "",
            },
          ];

    const openOptions = {
      initialRows,
      ...(prefill.offsets && prefill.offsets.length > 0
        ? { initialOffsets: prefill.offsets }
        : {}),
    };

    const result = await modal.open(openOptions);
    if (!result) return;

    const rows = trimOuterEmptyRows(normalizeRows(result.rows));
    const offsets = result.offsets;

    const calculated = calculateRows(rows);

    for (const o of offsets) {
      const minutes = Math.round((o.hours ?? 0) * 60);
      if (!Number.isFinite(minutes) || minutes === 0) continue;
      const task = o.task.trim().length > 0 ? o.task.trim() : "-";
      calculated.push({
        task,
        start: "",
        end: "",
        durationMinutes: minutes,
        durationHHMM: formatMinutesToHHMM(minutes),
        industrialHours: formatIndustrialHours(minutes),
      });
    }

    const md = withInlineEditButton(
      buildMarkdownTable(calculated, {
        use12HourClock: readUse12HourClockFromSettings(),
        showTotalRowTimeRange: !readDisableTotalRowTimeRangeFromSettings(),
      }),
    );
    await insertAtCursor(md);
    showMsg("Worktime table inserted.", "success");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    showMsg(msg, "error");
  } finally {
    logseq.hideMainUI({ restoreEditingCursor: true });
  }
}

async function commandEditTable(contextUuid?: string): Promise<void> {
  if (!isActiveInstance()) {
    await delegateToActiveInstance("edit", contextUuid);
    return;
  }
  const { getModalController } = await import("./modal");
  const { calculateRows, buildMarkdownTable, parseWorktimeTableFromMarkdown } =
    await import("./markdown");
  const { formatIndustrialHours, formatMinutesToHHMM } = await import("./time");

  let uuid: string;
  let content: string;
  try {
    uuid = await getTargetBlockUuid(contextUuid);
    const block = await logseq.Editor.getBlock(uuid);
    content =
      typeof (block as any)?.content === "string"
        ? ((block as any).content as string)
        : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    showMsg(msg, "error");
    return;
  }

  const parsed = parseWorktimeTableFromMarkdown(content, 500);
  if (!parsed.ok) {
    showMsg(parsed.message, "error");
    return;
  }

  const modal = getModalController();

  logseq.showMainUI({ autoFocus: true });
  try {
    const parsedOffsets = parsed.offsets ?? [];

    const initialOffsets: OffsetPreset[] =
      parsedOffsets.length > 0
        ? parsedOffsets.map((o) => ({
            hours: Math.round((o.minutes / 60) * 100) / 100,
            task: o.task,
          }))
        : [];

    const result = await modal.open({
      initialRows: parsed.rows,
      initialOffsets,
    });
    if (!result) return;

    const rows = trimOuterEmptyRows(normalizeRows(result.rows));
    const offsets = result.offsets;
    const calculated = calculateRows(rows);

    for (const o of offsets) {
      const minutes = Math.round((o.hours ?? 0) * 60);
      if (!Number.isFinite(minutes) || minutes === 0) continue;
      const task = o.task.trim().length > 0 ? o.task.trim() : "-";
      calculated.push({
        task,
        start: "",
        end: "",
        durationMinutes: minutes,
        durationHHMM: formatMinutesToHHMM(minutes),
        industrialHours: formatIndustrialHours(minutes),
      });
    }
    const md = withInlineEditButton(
      buildMarkdownTable(calculated, {
        use12HourClock: readUse12HourClockFromSettings(),
        showTotalRowTimeRange: !readDisableTotalRowTimeRangeFromSettings(),
      }),
    );

    await updateBlockContent(uuid, md);
    showMsg("Worktime table updated.", "success");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    showMsg(msg, "error");
  } finally {
    logseq.hideMainUI({ restoreEditingCursor: true });
  }
}

async function commandExportCsv(contextUuid?: string): Promise<void> {
  if (!isActiveInstance()) {
    await delegateToActiveInstance("exportCsv", contextUuid);
    return;
  }

  const { calculateRows, buildCsvTable, parseWorktimeTableFromMarkdown } =
    await import("./markdown");
  const { formatIndustrialHours, formatMinutesToHHMM } = await import("./time");

  let uuid: string;
  let content: string;
  try {
    uuid = await getTargetBlockUuid(contextUuid);
    const block = await logseq.Editor.getBlock(uuid);
    content =
      typeof (block as any)?.content === "string"
        ? ((block as any).content as string)
        : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    showMsg(msg, "error");
    return;
  }

  const parsed = parseWorktimeTableFromMarkdown(content, 500);
  if (!parsed.ok) {
    showMsg(parsed.message, "warning");
    return;
  }

  const rows = normalizeRows(parsed.rows);
  const calculated = calculateRows(rows);

  for (const o of parsed.offsets ?? []) {
    const minutes = Math.round(o.minutes ?? 0);
    if (!Number.isFinite(minutes) || minutes === 0) continue;
    const task = o.task.trim().length > 0 ? o.task.trim() : "-";
    calculated.push({
      task,
      start: "",
      end: "",
      durationMinutes: minutes,
      durationHHMM: formatMinutesToHHMM(minutes),
      industrialHours: formatIndustrialHours(minutes),
    });
  }

  const csv = buildCsvTable(calculated, {
    use12HourClock: readUse12HourClockFromSettings(),
    showTotalRowTimeRange: !readDisableTotalRowTimeRangeFromSettings(),
  });
  const filename = await suggestCsvFilenameFromBlock(uuid);
  downloadTextFile(filename, csv);
  showMsg(`Exported CSV: ${filename}`, "success");
}

function registerCommands(): void {
  const g = globalThis as any;
  const alreadyInit = Boolean(g[INIT_GUARD_KEY]);
  if (!alreadyInit) g[INIT_GUARD_KEY] = true;

  logseq.useSettingsSchema([
    {
      key: SETTINGS_DIALOG_PREFILL_JSON,
      type: "string",
      default: "",
      title: "Dialog prefill (JSON)",
      description:
        'Advanced: JSON object to prefill the dialog, e.g. {"rows":[{"start":"08:00","end":"","task":""}],"offsets":[{"hours":1,"task":"Break"}]}',
    },
    {
      key: SETTINGS_USE_12_HOUR_CLOCK,
      type: "boolean",
      default: false,
      title: "Use 12-hour clock (AM/PM)",
      description:
        "If enabled, Start/End times are displayed as h:mm AM/PM. Input accepts both 24h and 12h formats.",
    },
    {
      key: SETTINGS_DISABLE_TOTAL_ROW_TIME_RANGE,
      type: "boolean",
      default: false,
      title: "Disable Start/End in Total row",
      description:
        "If enabled, the Total row hides Start and End and only shows duration totals. If disabled, the Total row shows the earliest visible Start and a derived End computed as earliest Start plus total duration.",
    },
  ]);

  activateThisInstance();

  {
    const guard = getTopGuard();
    if (guard) {
      guard.handlers = guard.handlers ?? {};
      guard.handlers.worktime = commandWorktime;
      guard.handlers.edit = commandEditTable;
      guard.handlers.exportCsv = commandExportCsv;
    }
  }

  logseq.beforeunload(async () => {
    const guard = getTopGuard();
    if (guard?.activeToken === instanceToken) {
      guard.activeToken = "";
      guard.contextMenuRegistered = false;
      guard.contextMenuExportRegistered = false;
      if (guard.handlers) {
        delete guard.handlers.worktime;
        delete guard.handlers.edit;
        delete guard.handlers.exportCsv;
      }
    }
  });

  // Some Logseq versions duplicate context menu items if registered twice.
  const registerContextMenuEdit = (): boolean => {
    try {
      logseq.Editor.registerBlockContextMenuItem(
        EDIT_COMMAND_LABEL,
        async (e: any) => {
          const uuid =
            typeof e?.uuid === "string" ? (e.uuid as string) : undefined;
          await commandEditTable(uuid);
        },
      );
      return true;
    } catch (e) {
      console.warn(
        "[logseq-worktime-table] registerBlockContextMenuItem failed",
        e,
      );
      return false;
    }
  };

  const registerContextMenuExportCsv = (): boolean => {
    try {
      logseq.Editor.registerBlockContextMenuItem(
        EXPORT_CSV_LABEL,
        async (e: any) => {
          const uuid =
            typeof e?.uuid === "string" ? (e.uuid as string) : undefined;
          await commandExportCsv(uuid);
        },
      );
      return true;
    } catch (e) {
      console.warn(
        "[logseq-worktime-table] registerBlockContextMenuItem (export) failed",
        e,
      );
      return false;
    }
  };

  {
    const guard = getTopGuard();
    if (!guard?.contextMenuRegistered) {
      const ok = registerContextMenuEdit();
      if (guard) guard.contextMenuRegistered = ok;

      if (!ok) {
        setTimeout(() => {
          const g2 = getTopGuard();
          if (g2?.contextMenuRegistered) return;
          const ok2 = registerContextMenuEdit();
          if (g2) g2.contextMenuRegistered = ok2;
        }, 1500);
      }
    }

    if (!guard?.contextMenuExportRegistered) {
      const ok = registerContextMenuExportCsv();
      if (guard) guard.contextMenuExportRegistered = ok;
      if (!ok) {
        setTimeout(() => {
          const g2 = getTopGuard();
          if (g2?.contextMenuExportRegistered) return;
          const ok2 = registerContextMenuExportCsv();
          if (g2) g2.contextMenuExportRegistered = ok2;
        }, 1500);
      }
    }
  }

  if (alreadyInit) return;

  registerInlineEditButton();

  logseq.Editor.registerSlashCommand(SLASH_COMMAND_WORKTIME, () =>
    commandWorktime(),
  );
}

logseq.ready(registerCommands).catch((e) => {
  console.error("[logseq-worktime-table] init failed", e);
  showMsg("Plugin failed to start. See console.", "error");
});
