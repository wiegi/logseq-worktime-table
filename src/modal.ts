import "./styles.css";
import {
  isRowEmpty,
  parseTimeToMinutes,
  validateRow,
  type InputRow,
} from "./time";

export interface OffsetPreset {
  hours: number;
  task: string;
}

export interface ModalResult {
  rows: InputRow[];
  offsets: OffsetPreset[];
}

export interface ModalOpenOptions {
  initialRows?: InputRow[];
  initialOffsets?: OffsetPreset[];
}

type ModalController = {
  open: (options?: ModalOpenOptions) => Promise<ModalResult | null>;
  close: () => void;
  isOpen: () => boolean;
};

let controller: ModalController | null = null;

export function getModalController(): ModalController {
  if (controller) return controller;

  const overlay = document.createElement("div");
  overlay.id = "wt-overlay";
  overlay.className = "hidden";
  overlay.setAttribute("aria-hidden", "true");

  const modal = document.createElement("div");
  modal.id = "wt-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Track work time");

  modal.innerHTML = `
    <h2>Track work time</h2>
    <p class="wt-help" id="wt-help">Times can be entered as H:mm or HH:mm (24h) or h:mm AM/PM (12h). If both Start and End are present, End must be after Start. Incomplete rows are allowed but don't affect totals. Task is optional. Offsets add/subtract hours (use negative values to subtract).</p>

    <form id="wt-form">
      <div class="wt-section-title">Worktime table</div>
      <div class="wt-grid" id="wt-grid">
        <div class="hdr">Start</div>
        <div class="hdr">End</div>
        <div class="hdr">Task (optional)</div>
        <div class="hdr wt-hdr-action"></div>
      </div>

      <div class="wt-row-actions">
        <button type="button" id="wt-add-row">+ Add row</button>
      </div>

      <div class="wt-offsets">
        <div class="wt-section-title">Worktime offsets</div>
        <div class="wt-offset-grid" id="wt-offset-grid">
          <div class="hdr">Hours (dec.)</div>
          <div class="hdr">Task (optional)</div>
          <div class="hdr wt-hdr-action"></div>
        </div>

        <div class="wt-row-actions">
          <button type="button" id="wt-add-offset">+ Add offset</button>
        </div>
      </div>

      <div class="wt-error" id="wt-error" role="alert" aria-live="polite"></div>

      <div class="wt-actions">
        <button type="button" id="wt-cancel">Cancel</button>
        <button type="submit" data-variant="primary">Confirm</button>
      </div>
    </form>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const grid = modal.querySelector<HTMLDivElement>("#wt-grid");
  const offsetGrid = modal.querySelector<HTMLDivElement>("#wt-offset-grid");
  const form = modal.querySelector<HTMLFormElement>("#wt-form");
  const error = modal.querySelector<HTMLDivElement>("#wt-error");
  const cancel = modal.querySelector<HTMLButtonElement>("#wt-cancel");
  const addRow = modal.querySelector<HTMLButtonElement>("#wt-add-row");
  const addOffset = modal.querySelector<HTMLButtonElement>("#wt-add-offset");
  const help = modal.querySelector<HTMLParagraphElement>("#wt-help");

  if (
    !grid ||
    !offsetGrid ||
    !form ||
    !error ||
    !cancel ||
    !addRow ||
    !addOffset ||
    !help
  ) {
    throw new Error("Modal DOM init failed.");
  }

  const addRowBtn = addRow;
  const addOffsetBtn = addOffset;

  const gridEl = grid;
  const offsetGridEl = offsetGrid;

  const errorEl = error;
  const formEl = form;
  const helpEl = help;

  let themeObserver: MutationObserver | null = null;

  const THEME_VARS = [
    "--ls-primary-background-color",
    "--ls-secondary-background-color",
    "--ls-primary-text-color",
    "--ls-border-color",
    "--ls-link-text-color",
    "--ls-error-text-color",
  ] as const;

  function syncThemeCssVarsFromTopWindow(): void {
    try {
      const topWin = window.top;
      const topDocEl = topWin?.document?.documentElement;
      if (!topWin || !topDocEl) return;

      const cs = topWin.getComputedStyle(topDocEl);
      for (const name of THEME_VARS) {
        const value = cs.getPropertyValue(name).trim();
        if (value.length > 0) overlay.style.setProperty(name, value);
      }
    } catch {}
  }

  function guessIsDarkFromColor(value: string): boolean | null {
    const v = value.trim();
    if (v.length === 0) return null;

    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    if (m) {
      const r = Number(m[1]);
      const g = Number(m[2]);
      const b = Number(m[3]);
      if (![r, g, b].every((n) => Number.isFinite(n))) return null;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return lum < 128;
    }

    const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (h) {
      const hex = (h[1] ?? "").toLowerCase();
      if (hex.length === 0) return null;
      const full =
        hex.length === 3
          ? hex
              .split("")
              .map((c) => c + c)
              .join("")
          : hex;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      if (![r, g, b].every((n) => Number.isFinite(n))) return null;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return lum < 128;
    }

    return null;
  }

  async function determineLogseqThemeMode(): Promise<"light" | "dark" | null> {
    try {
      const cfg = (await (logseq.App as any)?.getUserConfigs?.()) as any;
      const preferred =
        typeof cfg?.preferredThemeMode === "string"
          ? cfg.preferredThemeMode
          : typeof cfg?.themeMode === "string"
            ? cfg.themeMode
            : null;
      if (preferred) {
        const t = String(preferred).toLowerCase();
        if (t.includes("dark")) return "dark";
        if (t.includes("light")) return "light";
      }
    } catch {}

    try {
      const topDocEl = window.top?.document?.documentElement;
      if (topDocEl) {
        const cls = Array.from(topDocEl.classList).join(" ").toLowerCase();
        if (/(^|\s)(dark|theme-dark|is-dark)(\s|$)/.test(cls)) return "dark";
        if (/(^|\s)(light|theme-light|is-light)(\s|$)/.test(cls))
          return "light";

        const bg =
          window.top
            ?.getComputedStyle(topDocEl)
            .getPropertyValue("--ls-primary-background-color") ?? "";
        const guess = guessIsDarkFromColor(bg);
        if (guess === true) return "dark";
        if (guess === false) return "light";
      }
    } catch {}

    return null;
  }

  async function applyThemeFromLogseq(): Promise<void> {
    syncThemeCssVarsFromTopWindow();
    const mode = await determineLogseqThemeMode();
    if (mode) {
      overlay.style.colorScheme = mode;
      overlay.dataset.theme = mode;
    } else {
      overlay.style.colorScheme = "light dark";
      delete overlay.dataset.theme;
    }
  }

  function startThemeObserver(): void {
    if (themeObserver) return;
    try {
      const topDocEl = window.top?.document?.documentElement;
      if (!topDocEl) return;
      themeObserver = new MutationObserver(() => {
        if (!controller?.isOpen()) return;
        void applyThemeFromLogseq();
      });
      themeObserver.observe(topDocEl, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    } catch {}
  }

  function stopThemeObserver(): void {
    themeObserver?.disconnect();
    themeObserver = null;
  }

  const SETTINGS_USE_12_HOUR_CLOCK = "use12HourClock";

  function readUse12HourClockFromSettings(): boolean {
    const s = (logseq as any).settings as Record<string, unknown> | undefined;
    return Boolean(s?.[SETTINGS_USE_12_HOUR_CLOCK]);
  }

  function formatMinutesToClock24(totalMinutes: number): string {
    const safe = Math.floor(totalMinutes);
    const normalized = ((safe % 1440) + 1440) % 1440;
    const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
    const mm = String(normalized % 60).padStart(2, "0");
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

  function getNowMinutes(): number {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function normalizeTimeDisplay(
    value: string,
    use12HourClock: boolean,
  ): string {
    const raw = value ?? "";
    const trimmed = raw.trim();
    if (trimmed.length === 0) return "";
    const minutes = parseTimeToMinutes(trimmed);
    if (minutes === null) return raw;
    return use12HourClock
      ? formatMinutesToClock12(minutes)
      : formatMinutesToClock24(minutes);
  }

  function applyHelpText(use12HourClock: boolean): void {
    const mode = use12HourClock ? "12h (AM/PM)" : "24h (HH:mm)";
    helpEl.textContent =
      `Times can be entered as H:mm or HH:mm (24h) or h:mm AM/PM (12h). ` +
      `Current display mode: ${mode}. ` +
      (use12HourClock
        ? `Tip: In 12h mode you can type "8:00" and pick AM/PM in the dropdown. `
        : `Tip: In 24h mode you can type "8:00" and it will be normalized to "08:00". `) +
      `If both Start and End are present, End must be after Start. ` +
      `Incomplete rows are allowed but don't affect totals. ` +
      `Task is optional. Empty rows are kept (template). ` +
      `Offsets add/subtract hours (use negative values to subtract).`;
  }

  const taskInputs: HTMLInputElement[] = [];
  const startInputs: HTMLInputElement[] = [];
  const endInputs: HTMLInputElement[] = [];

  const startCellEls: HTMLElement[] = [];
  const endCellEls: HTMLElement[] = [];
  const deleteButtons: HTMLButtonElement[] = [];

  const startAmPmSelects: Array<HTMLSelectElement | null> = [];
  const endAmPmSelects: Array<HTMLSelectElement | null> = [];

  const offsetHoursInputs: HTMLInputElement[] = [];
  const offsetTaskInputs: HTMLInputElement[] = [];
  const offsetDeleteButtons: HTMLButtonElement[] = [];

  const OFFSET_GRID_HEADER_CELLS = 3;

  function removeOffsetRowByIndex(index: number): void {
    const hours = offsetHoursInputs[index];
    const task = offsetTaskInputs[index];
    const del = offsetDeleteButtons[index];

    const removeEl = (el: Element | undefined): void => {
      if (!el) return;
      if (el.parentElement === offsetGridEl) offsetGridEl.removeChild(el);
    };

    removeEl(hours);
    removeEl(task);
    removeEl(del);

    offsetHoursInputs.splice(index, 1);
    offsetTaskInputs.splice(index, 1);
    offsetDeleteButtons.splice(index, 1);

    if (offsetHoursInputs.length > 0) {
      offsetHoursInputs[Math.min(index, offsetHoursInputs.length - 1)]?.focus();
    } else {
      addOffsetBtn.focus();
    }
  }

  function removeOffsetRowByButton(btn: HTMLButtonElement): void {
    const index = offsetDeleteButtons.indexOf(btn);
    if (index < 0) return;
    removeOffsetRowByIndex(index);
  }

  function addOffsetRow(): void {
    const hours = document.createElement("input");
    hours.type = "text";
    hours.placeholder = "+1.00";
    hours.inputMode = "decimal";
    hours.autocomplete = "off";
    hours.className = "wt-offset-hours";

    const task = document.createElement("input");
    task.type = "text";
    task.placeholder = "optional";
    task.autocomplete = "off";
    task.className = "wt-offset-task";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "wt-row-delete";
    del.textContent = "×";
    del.title = "Delete offset";
    del.setAttribute(
      "aria-label",
      `Delete offset ${offsetHoursInputs.length + 1}`,
    );
    del.addEventListener("click", () => removeOffsetRowByButton(del));

    offsetHoursInputs.push(hours);
    offsetTaskInputs.push(task);
    offsetDeleteButtons.push(del);

    offsetGridEl.appendChild(hours);
    offsetGridEl.appendChild(task);
    offsetGridEl.appendChild(del);
  }

  function resetOffsetRows(): void {
    while (offsetGridEl.children.length > OFFSET_GRID_HEADER_CELLS) {
      offsetGridEl.removeChild(offsetGridEl.lastElementChild as Element);
    }
    offsetHoursInputs.length = 0;
    offsetTaskInputs.length = 0;
    offsetDeleteButtons.length = 0;
  }

  function ensureOffsetRowCount(count: number): void {
    const target = Math.max(0, Math.floor(count));
    while (offsetHoursInputs.length > target) {
      removeOffsetRowByIndex(offsetHoursInputs.length - 1);
    }
    while (offsetHoursInputs.length < target) addOffsetRow();
  }

  const GRID_HEADER_CELLS = 4;

  function removeTimeRowByIndex(index: number): void {
    const startCell = startCellEls[index];
    const endCell = endCellEls[index];
    const task = taskInputs[index];
    const del = deleteButtons[index];

    const removeEl = (el: Element | undefined): void => {
      if (!el) return;
      if (el.parentElement === gridEl) gridEl.removeChild(el);
    };

    removeEl(startCell);
    removeEl(endCell);
    removeEl(task);
    removeEl(del);

    taskInputs.splice(index, 1);
    startInputs.splice(index, 1);
    endInputs.splice(index, 1);
    startAmPmSelects.splice(index, 1);
    endAmPmSelects.splice(index, 1);
    startCellEls.splice(index, 1);
    endCellEls.splice(index, 1);
    deleteButtons.splice(index, 1);

    if (startInputs.length > 0) {
      startInputs[Math.min(index, startInputs.length - 1)]?.focus();
    } else {
      addRowBtn.focus();
    }
  }

  function removeTimeRowByButton(btn: HTMLButtonElement): void {
    const index = deleteButtons.indexOf(btn);
    if (index < 0) return;
    removeTimeRowByIndex(index);
  }

  function createAmPmSelect(ariaLabel: string): HTMLSelectElement {
    const sel = document.createElement("select");
    sel.className = "wt-ampm";
    sel.setAttribute("aria-label", ariaLabel);

    const am = document.createElement("option");
    am.value = "AM";
    am.textContent = "AM";
    const pm = document.createElement("option");
    pm.value = "PM";
    pm.textContent = "PM";
    sel.appendChild(am);
    sel.appendChild(pm);
    sel.value = "AM";
    return sel;
  }

  function minutesTo12hParts(minutes: number): {
    time: string;
    ampm: "AM" | "PM";
  } {
    const normalized = ((Math.floor(minutes) % 1440) + 1440) % 1440;
    const hours24 = Math.floor(normalized / 60);
    const minutesPart = normalized % 60;
    const isPm = hours24 >= 12;
    const hours12 = ((hours24 + 11) % 12) + 1;
    const mm = String(minutesPart).padStart(2, "0");
    return { time: `${hours12}:${mm}`, ampm: isPm ? "PM" : "AM" };
  }

  function addTimeRow(use12HourClock: boolean): void {
    const task = document.createElement("input");
    task.type = "text";
    task.placeholder = "optional";
    task.autocomplete = "on";
    task.className = "wt-task";

    const start = document.createElement("input");
    start.type = "text";
    start.placeholder = use12HourClock ? "8:00" : "08:00";
    start.inputMode = use12HourClock ? "numeric" : "text";
    start.autocomplete = "on";

    const end = document.createElement("input");
    end.type = "text";
    end.placeholder = use12HourClock ? "5:00" : "17:00";
    end.inputMode = use12HourClock ? "numeric" : "text";
    end.autocomplete = "on";

    const startNow = document.createElement("button");
    startNow.type = "button";
    startNow.className = "wt-now";
    startNow.textContent = "Now";
    startNow.title = "Set Start to current time";
    startNow.setAttribute(
      "aria-label",
      `Set Start to current time (row ${startInputs.length + 1})`,
    );

    const endNow = document.createElement("button");
    endNow.type = "button";
    endNow.className = "wt-now";
    endNow.textContent = "Now";
    endNow.title = "Set End to current time";
    endNow.setAttribute(
      "aria-label",
      `Set End to current time (row ${endInputs.length + 1})`,
    );

    taskInputs.push(task);
    startInputs.push(start);
    endInputs.push(end);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "wt-row-delete";
    del.textContent = "×";
    del.title = "Delete row";
    del.setAttribute("aria-label", `Delete row ${startInputs.length}`);
    del.addEventListener("click", () => removeTimeRowByButton(del));
    deleteButtons.push(del);

    if (use12HourClock) {
      const startWrap = document.createElement("div");
      startWrap.className = "wt-time-combo";
      const startAmPm = createAmPmSelect(
        `Start AM/PM row ${startInputs.length}`,
      );
      startAmPmSelects.push(startAmPm);
      startNow.addEventListener("click", () => {
        clearError();
        const p = minutesTo12hParts(getNowMinutes());
        start.value = p.time;
        startAmPm.value = p.ampm;
        start.focus();
      });
      startWrap.appendChild(start);
      startWrap.appendChild(startAmPm);
      startWrap.appendChild(startNow);

      const endWrap = document.createElement("div");
      endWrap.className = "wt-time-combo";
      const endAmPm = createAmPmSelect(`End AM/PM row ${endInputs.length}`);
      endAmPmSelects.push(endAmPm);
      endNow.addEventListener("click", () => {
        clearError();
        const p = minutesTo12hParts(getNowMinutes());
        end.value = p.time;
        endAmPm.value = p.ampm;
        end.focus();
      });
      endWrap.appendChild(end);
      endWrap.appendChild(endAmPm);
      endWrap.appendChild(endNow);

      gridEl.appendChild(startWrap);
      gridEl.appendChild(endWrap);

      startCellEls.push(startWrap);
      endCellEls.push(endWrap);
    } else {
      startAmPmSelects.push(null);
      endAmPmSelects.push(null);

      const startWrap = document.createElement("div");
      startWrap.className = "wt-time-combo";
      startNow.addEventListener("click", () => {
        clearError();
        start.value = formatMinutesToClock24(getNowMinutes());
        start.focus();
      });
      startWrap.appendChild(start);
      startWrap.appendChild(startNow);

      const endWrap = document.createElement("div");
      endWrap.className = "wt-time-combo";
      endNow.addEventListener("click", () => {
        clearError();
        end.value = formatMinutesToClock24(getNowMinutes());
        end.focus();
      });
      endWrap.appendChild(end);
      endWrap.appendChild(endNow);

      gridEl.appendChild(startWrap);
      gridEl.appendChild(endWrap);

      startCellEls.push(startWrap);
      endCellEls.push(endWrap);
    }
    gridEl.appendChild(task);
    gridEl.appendChild(del);
  }

  function resetTimeRows(): void {
    while (gridEl.children.length > GRID_HEADER_CELLS) {
      gridEl.removeChild(gridEl.lastElementChild as Element);
    }
    taskInputs.length = 0;
    startInputs.length = 0;
    endInputs.length = 0;
    startAmPmSelects.length = 0;
    endAmPmSelects.length = 0;
    startCellEls.length = 0;
    endCellEls.length = 0;
    deleteButtons.length = 0;
  }

  function ensureTimeRowCount(count: number): void {
    const target = Math.max(1, Math.floor(count));
    const use12HourClock = readUse12HourClockFromSettings();
    while (startInputs.length < target) addTimeRow(use12HourClock);
  }

  let resolvePromise: ((v: ModalResult | null) => void) | null = null;
  let currentSubmitHandler: ((ev: Event) => void) | null = null;

  function setOpen(open: boolean): void {
    overlay.classList.toggle("hidden", !open);
    overlay.setAttribute("aria-hidden", open ? "false" : "true");

    if (open) {
      void applyThemeFromLogseq();
      startThemeObserver();
    } else {
      stopThemeObserver();
    }
  }

  function clearError(): void {
    errorEl.textContent = "";
  }

  function showError(message: string): void {
    errorEl.textContent = message;
  }

  function readRows(): InputRow[] {
    const rows: InputRow[] = [];
    for (let i = 0; i < startInputs.length; i++) {
      const startRaw = startInputs[i]?.value ?? "";
      const endRaw = endInputs[i]?.value ?? "";

      const startSel = startAmPmSelects[i];
      const endSel = endAmPmSelects[i];

      const hasAmPm = (v: string): boolean => /\b([AaPp][Mm])$/.test(v.trim());

      const start =
        startSel && startRaw.trim().length > 0 && !hasAmPm(startRaw)
          ? `${startRaw.trim()} ${startSel.value}`
          : startRaw;

      const end =
        endSel && endRaw.trim().length > 0 && !hasAmPm(endRaw)
          ? `${endRaw.trim()} ${endSel.value}`
          : endRaw;

      rows.push({
        task: taskInputs[i]?.value ?? "",
        start,
        end,
      });
    }
    return rows;
  }

  function readOffsets(): OffsetPreset[] {
    const presets: OffsetPreset[] = [];
    for (let i = 0; i < offsetHoursInputs.length; i++) {
      const hoursRaw = String(offsetHoursInputs[i]?.value ?? "").trim();
      const task = String(offsetTaskInputs[i]?.value ?? "");

      const normalized = hoursRaw.replace(",", ".");
      const hours = normalized.length === 0 ? 0 : Number(normalized);
      presets.push({
        hours: Number.isFinite(hours) ? hours : NaN,
        task,
      });
    }
    return presets;
  }

  function closeWith(result: ModalResult | null): void {
    if (currentSubmitHandler) {
      formEl.removeEventListener("submit", currentSubmitHandler);
      currentSubmitHandler = null;
    }
    setOpen(false);
    const r = resolvePromise;
    resolvePromise = null;
    if (r) r(result);
  }

  function setInputsFromRows(rows: InputRow[], use12HourClock: boolean): void {
    for (let i = 0; i < startInputs.length; i++) {
      const row = rows[i];
      const task = taskInputs[i];
      const start = startInputs[i];
      const end = endInputs[i];
      if (!task || !start || !end) continue;
      task.value = row?.task ?? "";

      if (use12HourClock) {
        const startSel = startAmPmSelects[i];
        const endSel = endAmPmSelects[i];

        const startMinutes = parseTimeToMinutes((row?.start ?? "").trim());
        if (startMinutes !== null) {
          const p = minutesTo12hParts(startMinutes);
          start.value = p.time;
          if (startSel) startSel.value = p.ampm;
        } else {
          start.value = (row?.start ?? "").trim();
          if (startSel) startSel.value = "AM";
        }

        const endMinutes = parseTimeToMinutes((row?.end ?? "").trim());
        if (endMinutes !== null) {
          const p = minutesTo12hParts(endMinutes);
          end.value = p.time;
          if (endSel) endSel.value = p.ampm;
        } else {
          end.value = (row?.end ?? "").trim();
          if (endSel) endSel.value = "PM";
        }
      } else {
        start.value = normalizeTimeDisplay(row?.start ?? "", false);
        end.value = normalizeTimeDisplay(row?.end ?? "", false);
      }
    }
  }

  function readOffsetsFromSettings(): OffsetPreset[] {
    const s = (logseq as any).settings as Record<string, unknown> | undefined;
    const readHours = (value: unknown): number => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const normalized = value.trim().replace(",", ".");
        if (normalized.length === 0) return 0;
        const n = Number(normalized);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    };

    const rawPrefill =
      typeof s?.dialogPrefillJson === "string"
        ? (s.dialogPrefillJson as string)
        : "";

    if (rawPrefill.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawPrefill) as any;
        const offsetsCandidate = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.offsets)
            ? parsed.offsets
            : null;

        if (Array.isArray(offsetsCandidate)) {
          const presets: OffsetPreset[] = offsetsCandidate.map((p: any) => ({
            hours: readHours(p?.hours),
            task: typeof p?.task === "string" ? p.task : "",
          }));
          if (presets.length > 0) return presets;
        }
      } catch {}
    }

    return [];
  }

  function setInputsFromOffsets(offsets: OffsetPreset[]): void {
    for (let i = 0; i < offsetHoursInputs.length; i++) {
      const o = offsets[i];
      const hours = offsetHoursInputs[i];
      const task = offsetTaskInputs[i];
      if (!hours || !task) continue;
      hours.value =
        typeof o?.hours === "number" && Number.isFinite(o.hours)
          ? String(o.hours)
          : "";
      task.value = o?.task ?? "";
    }
  }

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeWith(null);
  });

  window.addEventListener("keydown", (e) => {
    if (!controller?.isOpen()) return;
    if (e.key === "Escape") closeWith(null);
  });

  cancel.addEventListener("click", () => closeWith(null));

  addRow.addEventListener("click", () => {
    addTimeRow(readUse12HourClockFromSettings());
    startInputs[startInputs.length - 1]?.focus();
  });

  addOffset.addEventListener("click", () => {
    addOffsetRow();
    offsetHoursInputs[offsetHoursInputs.length - 1]?.focus();
  });

  controller = {
    isOpen: () => !overlay.classList.contains("hidden"),
    close: () => closeWith(null),
    open: async (options) => {
      clearError();

      const use12HourClock = readUse12HourClockFromSettings();
      applyHelpText(use12HourClock);

      resetTimeRows();
      const initialRows = options?.initialRows ?? [];
      ensureTimeRowCount(initialRows.length > 0 ? initialRows.length : 1);
      setInputsFromRows(initialRows, use12HourClock);

      resetOffsetRows();
      const initialOffsets =
        options?.initialOffsets ?? readOffsetsFromSettings();
      ensureOffsetRowCount(initialOffsets.length);
      setInputsFromOffsets(initialOffsets);

      (logseq as any).setMainUIInlineStyle?.({
        position: "fixed",
        inset: "0",
        zIndex: "9999",
      });

      setOpen(true);
      startInputs[0]?.focus();

      return new Promise<ModalResult | null>((resolve) => {
        resolvePromise = resolve;

        if (currentSubmitHandler) {
          formEl.removeEventListener("submit", currentSubmitHandler);
          currentSubmitHandler = null;
        }

        const onSubmit = (ev: Event) => {
          ev.preventDefault();

          const rows = readRows();
          const offsets = readOffsets();

          let hasAny = false;
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            if (isRowEmpty(row)) continue;
            hasAny = true;

            const v = validateRow(row);
            if (!v.ok) {
              showError(`Row ${i + 1}: ${v.message}`);
              if (
                row.start.trim().length > 0 &&
                parseTimeToMinutes(row.start) === null
              ) {
                startInputs[i]?.focus();
              } else if (
                row.end.trim().length > 0 &&
                parseTimeToMinutes(row.end) === null
              ) {
                endInputs[i]?.focus();
              } else {
                startInputs[i]?.focus();
              }
              return;
            }
          }

          for (let i = 0; i < offsets.length; i++) {
            const o = offsets[i];
            if (!o) continue;
            if (!Number.isFinite(o.hours)) {
              showError(`Offset ${i + 1}: Hours must be a number.`);
              offsetHoursInputs[i]?.focus();
              return;
            }
            const minutes = Math.round(o.hours * 60);
            if (minutes !== 0) hasAny = true;
          }
          closeWith({ rows, offsets });
        };

        currentSubmitHandler = onSubmit;
        formEl.addEventListener("submit", onSubmit);
      });
    },
  };

  return controller;
}
