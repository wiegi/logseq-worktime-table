import "./styles.css";
import {
  isRowEmpty,
  parseTimeToMinutes,
  validateRow,
  type InputRow,
} from "./time";

export interface ModalResult {
  rows: InputRow[];
}

export interface ModalOpenOptions {
  initialRows?: InputRow[];
}

type TimeRowKind = "work" | "subtotal" | "offset";

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
        <button type="button" id="wt-add-row">+ Add time range</button>
        <button type="button" id="wt-add-offset">+ Add offset</button>
        <button type="button" id="wt-add-subtotal">+ Add subtotal</button>
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
  const form = modal.querySelector<HTMLFormElement>("#wt-form");
  const error = modal.querySelector<HTMLDivElement>("#wt-error");
  const cancel = modal.querySelector<HTMLButtonElement>("#wt-cancel");
  const addRow = modal.querySelector<HTMLButtonElement>("#wt-add-row");
  const addSubtotal =
    modal.querySelector<HTMLButtonElement>("#wt-add-subtotal");
  const addOffset = modal.querySelector<HTMLButtonElement>("#wt-add-offset");
  const help = modal.querySelector<HTMLParagraphElement>("#wt-help");

  if (
    !grid ||
    !form ||
    !error ||
    !cancel ||
    !addRow ||
    !addSubtotal ||
    !addOffset ||
    !help
  ) {
    throw new Error("Modal DOM init failed.");
  }

  const addRowBtn = addRow;

  const gridEl = grid;

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

  function normalizeDialogValue(
    value: string,
    options?: { stripLeadingWhitespace?: boolean },
  ): string {
    const sanitized = String(value ?? "").replace(/<!--wt:offset-->/g, "");

    return options?.stripLeadingWhitespace
      ? sanitized.trimStart()
      : sanitized.trim();
  }

  function applyHelpText(use12HourClock: boolean): void {
    const mode = use12HourClock ? "12h (AM/PM)" : "24h (HH:mm)";
    helpEl.textContent =
      `Times can be entered as H:mm or HH:mm (24h) or h:mm AM/PM (12h). ` +
      `Current display mode: ${mode}. ` +
      (use12HourClock
        ? `Tip: In 12h mode you can type "8:00" and pick AM/PM in the dropdown. `
        : `Tip: In 24h mode you can type "8:00" and it will be normalized to "08:00". `) +
      `Use "+ Add subtotal" to insert a section summary row such as "Day subtotal". ` +
      `Use "+ Add offset" to insert an adjustment row such as "Break". ` +
      `If both Start and End are present, End must be after Start. ` +
      `Incomplete rows are allowed but don't affect totals. ` +
      `Task is optional. Empty rows must be removed or filled before confirming. ` +
      `Offsets add/subtract hours (use negative values to subtract).`;
  }

  const taskInputs: HTMLInputElement[] = [];
  const startInputs: HTMLInputElement[] = [];
  const endInputs: HTMLInputElement[] = [];

  const startCellEls: HTMLElement[] = [];
  const endCellEls: HTMLElement[] = [];
  const actionCellEls: HTMLElement[] = [];
  const deleteButtons: HTMLButtonElement[] = [];
  const dragButtons: HTMLButtonElement[] = [];

  const startAmPmSelects: Array<HTMLSelectElement | null> = [];
  const endAmPmSelects: Array<HTMLSelectElement | null> = [];
  const rowKinds: TimeRowKind[] = [];

  let draggingTimeRowIndex: number | null = null;

  const GRID_HEADER_CELLS = 4;

  function removeTimeRowByIndex(index: number): void {
    const startCell = startCellEls[index];
    const endCell = endCellEls[index];
    const task = taskInputs[index];
    const actionCell = actionCellEls[index];

    const removeEl = (el: Element | undefined): void => {
      if (!el) return;
      if (el.parentElement === gridEl) gridEl.removeChild(el);
    };

    removeEl(startCell);
    removeEl(endCell);
    removeEl(task);
    removeEl(actionCell);

    taskInputs.splice(index, 1);
    startInputs.splice(index, 1);
    endInputs.splice(index, 1);
    startAmPmSelects.splice(index, 1);
    endAmPmSelects.splice(index, 1);
    rowKinds.splice(index, 1);
    startCellEls.splice(index, 1);
    endCellEls.splice(index, 1);
    actionCellEls.splice(index, 1);
    deleteButtons.splice(index, 1);
    dragButtons.splice(index, 1);

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

  function moveArrayItem<T>(
    items: T[],
    fromIndex: number,
    toIndex: number,
  ): void {
    if (fromIndex === toIndex) return;
    const [item] = items.splice(fromIndex, 1);
    if (item === undefined) return;
    items.splice(toIndex, 0, item);
  }

  function syncTimeRowDomOrder(): void {
    for (let i = 0; i < startInputs.length; i++) {
      gridEl.appendChild(startCellEls[i]!);
      gridEl.appendChild(endCellEls[i]!);
      gridEl.appendChild(taskInputs[i]!);
      gridEl.appendChild(actionCellEls[i]!);
    }
  }

  function setTimeRowDraggingState(index: number, active: boolean): void {
    startCellEls[index]?.classList.toggle("wt-row-dragging", active);
    endCellEls[index]?.classList.toggle("wt-row-dragging", active);
    taskInputs[index]?.classList.toggle("wt-row-dragging", active);
    actionCellEls[index]?.classList.toggle("wt-row-dragging", active);
  }

  function getTimeRowIndexFromTarget(target: EventTarget | null): number {
    if (!(target instanceof Node)) return -1;
    for (let i = 0; i < startInputs.length; i++) {
      const elements = [
        startCellEls[i],
        endCellEls[i],
        taskInputs[i],
        actionCellEls[i],
      ];
      if (elements.some((el) => el === target || el?.contains(target))) {
        return i;
      }
    }
    return -1;
  }

  function moveTimeRow(fromIndex: number, insertIndex: number): number {
    const rowCount = startInputs.length;
    if (fromIndex < 0 || fromIndex >= rowCount) return fromIndex;

    const boundedInsertIndex = Math.max(0, Math.min(insertIndex, rowCount));
    let targetIndex = boundedInsertIndex;
    if (targetIndex > fromIndex) targetIndex--;
    if (targetIndex === fromIndex) return fromIndex;

    setTimeRowDraggingState(fromIndex, false);

    moveArrayItem(taskInputs, fromIndex, targetIndex);
    moveArrayItem(startInputs, fromIndex, targetIndex);
    moveArrayItem(endInputs, fromIndex, targetIndex);
    moveArrayItem(startAmPmSelects, fromIndex, targetIndex);
    moveArrayItem(endAmPmSelects, fromIndex, targetIndex);
    moveArrayItem(rowKinds, fromIndex, targetIndex);
    moveArrayItem(startCellEls, fromIndex, targetIndex);
    moveArrayItem(endCellEls, fromIndex, targetIndex);
    moveArrayItem(actionCellEls, fromIndex, targetIndex);
    moveArrayItem(deleteButtons, fromIndex, targetIndex);
    moveArrayItem(dragButtons, fromIndex, targetIndex);

    syncTimeRowDomOrder();
    setTimeRowDraggingState(targetIndex, true);
    return targetIndex;
  }

  function addTimeRow(
    use12HourClock: boolean,
    rowKind: TimeRowKind = "work",
  ): void {
    const task = document.createElement("input");
    task.type = "text";
    task.placeholder =
      rowKind === "subtotal"
        ? "Subtotal"
        : rowKind === "offset"
          ? "Break"
          : "optional";
    task.autocomplete = "on";
    task.className =
      rowKind === "subtotal"
        ? "wt-task wt-task-subtotal"
        : rowKind === "offset"
          ? "wt-task wt-task-offset"
          : "wt-task wt-task-work";
    if (rowKind === "subtotal") task.value = "Subtotal";

    const start = document.createElement("input");
    start.type = "text";
    start.placeholder =
      rowKind === "subtotal"
        ? "subtotal"
        : rowKind === "offset"
          ? "+1.00"
          : use12HourClock
            ? "8:00"
            : "08:00";
    start.inputMode =
      rowKind === "subtotal"
        ? "text"
        : rowKind === "offset"
          ? "decimal"
          : use12HourClock
            ? "numeric"
            : "text";
    start.autocomplete = rowKind === "offset" ? "off" : "on";

    const end = document.createElement("input");
    end.type = "text";
    end.placeholder =
      rowKind === "subtotal"
        ? "section total"
        : rowKind === "offset"
          ? "offset"
          : use12HourClock
            ? "5:00"
            : "17:00";
    end.inputMode =
      rowKind === "subtotal"
        ? "text"
        : rowKind === "offset"
          ? "text"
          : use12HourClock
            ? "numeric"
            : "text";
    end.autocomplete = rowKind === "offset" ? "off" : "on";

    if (rowKind === "subtotal" || rowKind === "offset") {
      start.disabled = true;
      end.disabled = true;
      start.classList.add(
        rowKind === "offset" ? "wt-offset-input" : "wt-subtotal-input",
      );
      end.classList.add(
        rowKind === "offset" ? "wt-offset-input" : "wt-subtotal-input",
      );
    }

    if (rowKind === "offset") {
      start.disabled = false;
      start.value = "";
    }

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
    rowKinds.push(rowKind);

    const actionCell = document.createElement("div");
    actionCell.className = "wt-row-controls";

    const drag = document.createElement("button");
    drag.type = "button";
    drag.className = "wt-row-drag";
    drag.title = "Drag to reorder row";
    drag.draggable = true;
    drag.setAttribute("aria-label", `Drag row ${startInputs.length}`);
    const dragGrip = document.createElement("span");
    dragGrip.className = "wt-row-drag-grip";
    dragGrip.setAttribute("aria-hidden", "true");
    for (let dotIndex = 0; dotIndex < 6; dotIndex++) {
      const dot = document.createElement("span");
      dot.className = "wt-row-drag-dot";
      dragGrip.appendChild(dot);
    }
    drag.appendChild(dragGrip);
    drag.addEventListener("dragstart", (event) => {
      draggingTimeRowIndex = dragButtons.indexOf(drag);
      if (draggingTimeRowIndex < 0) return;
      event.dataTransfer?.setData("text/plain", String(draggingTimeRowIndex));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      setTimeRowDraggingState(draggingTimeRowIndex, true);
    });
    drag.addEventListener("dragend", () => {
      if (draggingTimeRowIndex !== null) {
        setTimeRowDraggingState(draggingTimeRowIndex, false);
      }
      draggingTimeRowIndex = null;
    });
    dragButtons.push(drag);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "wt-row-delete";
    del.textContent = "×";
    del.title = "Delete row";
    del.setAttribute("aria-label", `Delete row ${startInputs.length}`);
    del.addEventListener("click", () => removeTimeRowByButton(del));
    deleteButtons.push(del);

    actionCell.appendChild(del);
    actionCellEls.push(actionCell);

    if (rowKind === "subtotal" || rowKind === "offset") {
      startAmPmSelects.push(null);
      endAmPmSelects.push(null);

      const startWrap = document.createElement("div");
      startWrap.className =
        rowKind === "offset"
          ? "wt-time-combo wt-time-combo-offset wt-time-combo-offset-wide"
          : "wt-time-combo wt-time-combo-subtotal";

      const endWrap = document.createElement("div");
      endWrap.className =
        rowKind === "offset"
          ? "wt-time-combo wt-time-combo-offset wt-time-combo-offset-hidden"
          : "wt-time-combo wt-time-combo-subtotal";

      if (rowKind === "offset") {
        startWrap.appendChild(drag);
        startWrap.appendChild(start);
        endWrap.appendChild(end);
      } else {
        startWrap.appendChild(drag);
      }

      gridEl.appendChild(startWrap);
      gridEl.appendChild(endWrap);

      startCellEls.push(startWrap);
      endCellEls.push(endWrap);
    } else if (use12HourClock) {
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
      startWrap.appendChild(drag);
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
      startWrap.appendChild(drag);
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
    gridEl.appendChild(actionCell);
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
    rowKinds.length = 0;
    startCellEls.length = 0;
    endCellEls.length = 0;
    actionCellEls.length = 0;
    deleteButtons.length = 0;
    dragButtons.length = 0;
  }

  function ensureTimeRowCount(count: number): void {
    const target = Math.max(1, Math.floor(count));
    const use12HourClock = readUse12HourClockFromSettings();
    while (startInputs.length < target) addTimeRow(use12HourClock, "work");
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
      const rowKind = rowKinds[i] ?? "work";
      if (rowKind === "subtotal") {
        rows.push({
          kind: "subtotal",
          task: normalizeDialogValue(taskInputs[i]?.value ?? "Subtotal", {
            stripLeadingWhitespace: true,
          }),
          start: "",
          end: "",
        });
        continue;
      }

      const startRaw = startInputs[i]?.value ?? "";
      const endRaw = endInputs[i]?.value ?? "";

      if (rowKind === "offset") {
        rows.push({
          kind: "offset",
          task: normalizeDialogValue(taskInputs[i]?.value ?? "", {
            stripLeadingWhitespace: true,
          }),
          start: normalizeDialogValue(startRaw),
          end: "",
        });
        continue;
      }

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
        task: normalizeDialogValue(taskInputs[i]?.value ?? "", {
          stripLeadingWhitespace: true,
        }),
        start: normalizeDialogValue(start),
        end: normalizeDialogValue(end),
        kind: "work",
      });
    }
    return rows;
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
      task.value = normalizeDialogValue(
        row?.task ?? (row?.kind === "subtotal" ? "Subtotal" : ""),
        { stripLeadingWhitespace: true },
      );

      if (row?.kind === "subtotal") {
        start.value = "";
        end.value = "";
        continue;
      }

      if (row?.kind === "offset") {
        start.value = normalizeDialogValue(row?.start ?? "");
        end.value = "";
        continue;
      }

      if (use12HourClock) {
        const startSel = startAmPmSelects[i];
        const endSel = endAmPmSelects[i];

        const normalizedStart = normalizeDialogValue(row?.start ?? "");
        const startMinutes = parseTimeToMinutes(normalizedStart);
        if (startMinutes !== null) {
          const p = minutesTo12hParts(startMinutes);
          start.value = p.time;
          if (startSel) startSel.value = p.ampm;
        } else {
          start.value = normalizedStart;
          if (startSel) startSel.value = "AM";
        }

        const normalizedEnd = normalizeDialogValue(row?.end ?? "");
        const endMinutes = parseTimeToMinutes(normalizedEnd);
        if (endMinutes !== null) {
          const p = minutesTo12hParts(endMinutes);
          end.value = p.time;
          if (endSel) endSel.value = p.ampm;
        } else {
          end.value = normalizedEnd;
          if (endSel) endSel.value = "PM";
        }
      } else {
        start.value = normalizeTimeDisplay(
          normalizeDialogValue(row?.start ?? ""),
          false,
        );
        end.value = normalizeTimeDisplay(
          normalizeDialogValue(row?.end ?? ""),
          false,
        );
      }
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
    addTimeRow(readUse12HourClockFromSettings(), "work");
    startInputs[startInputs.length - 1]?.focus();
  });

  addSubtotal.addEventListener("click", () => {
    addTimeRow(readUse12HourClockFromSettings(), "subtotal");
    taskInputs[taskInputs.length - 1]?.focus();
  });

  addOffset.addEventListener("click", () => {
    addTimeRow(readUse12HourClockFromSettings(), "offset");
    startInputs[startInputs.length - 1]?.focus();
  });

  gridEl.addEventListener("dragover", (event) => {
    if (draggingTimeRowIndex === null) return;
    event.preventDefault();
    const rowIndex = getTimeRowIndexFromTarget(event.target);
    if (rowIndex < 0) return;

    const anchorEl = taskInputs[rowIndex] ?? startCellEls[rowIndex];
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const insertIndex =
      event.clientY > rect.top + rect.height / 2 ? rowIndex + 1 : rowIndex;
    draggingTimeRowIndex = moveTimeRow(draggingTimeRowIndex, insertIndex);
  });

  gridEl.addEventListener("drop", (event) => {
    if (draggingTimeRowIndex === null) return;
    event.preventDefault();
    setTimeRowDraggingState(draggingTimeRowIndex, false);
    draggingTimeRowIndex = null;
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
      if (initialRows.length > 0) {
        for (const row of initialRows) {
          addTimeRow(
            use12HourClock,
            row.kind === "subtotal"
              ? "subtotal"
              : row.kind === "offset"
                ? "offset"
                : "work",
          );
        }
      } else {
        ensureTimeRowCount(1);
      }
      setInputsFromRows(initialRows, use12HourClock);

      (logseq as any).setMainUIInlineStyle?.({
        position: "fixed",
        inset: "0",
        zIndex: "9999",
      });

      setOpen(true);
      if (rowKinds[0] === "subtotal") taskInputs[0]?.focus();
      else if (rowKinds[0] === "offset") startInputs[0]?.focus();
      else startInputs[0]?.focus();

      return new Promise<ModalResult | null>((resolve) => {
        resolvePromise = resolve;

        if (currentSubmitHandler) {
          formEl.removeEventListener("submit", currentSubmitHandler);
          currentSubmitHandler = null;
        }

        const onSubmit = (ev: Event) => {
          ev.preventDefault();

          const rows = readRows();

          clearError();
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            if (isRowEmpty(row)) {
              showError(
                `Row ${i + 1} is empty. Remove it or fill in a value before confirming.`,
              );
              if (row.kind === "offset") {
                startInputs[i]?.focus();
              } else {
                startInputs[i]?.focus();
              }
              return;
            }

            const v = validateRow(row);
            if (!v.ok) {
              showError(`Row ${i + 1}: ${v.message}`);
              if (row.kind === "subtotal") {
                taskInputs[i]?.focus();
              } else if (row.kind === "offset") {
                startInputs[i]?.focus();
              } else if (
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

          closeWith({ rows });
        };

        currentSubmitHandler = onSubmit;
        formEl.addEventListener("submit", onSubmit);
      });
    },
  };

  return controller;
}
