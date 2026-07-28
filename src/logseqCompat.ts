export type GraphKind = "db" | "file";

export type LogseqEntity = Record<string, unknown>;

type AppLike = {
  checkCurrentIsDbGraph?: () => Promise<unknown>;
};

type EditorLike = {
  getPage?: (identity: any) => Promise<unknown>;
};

type BlockEditorLike = {
  insertAtEditingCursor?: (content: string) => Promise<unknown>;
  getCurrentBlock?: () => Promise<unknown>;
  getBlock?: (identity: any) => Promise<unknown>;
  updateBlock?: (identity: any, content: string) => Promise<unknown>;
  insertBlock?: (
    identity: any,
    content: string,
    options: { sibling: boolean },
  ) => Promise<unknown>;
};

export async function detectGraphKind(app: AppLike): Promise<GraphKind> {
  if (typeof app.checkCurrentIsDbGraph !== "function") return "file";

  try {
    return (await app.checkCurrentIsDbGraph()) ? "db" : "file";
  } catch {
    // Older file-graph releases may expose the method before implementing it
    // completely. Treating those releases as file graphs is the safe default.
    return "file";
  }
}

export function getBlockText(block: unknown): string {
  if (!isEntity(block)) return "";

  // DB graphs store block content in `title`. File graphs traditionally expose
  // the same value as `content`.
  if (typeof block.title === "string") return block.title;
  if (typeof block.content === "string") return block.content;
  return "";
}

export function getEntityUuid(entity: unknown): string | null {
  if (!isEntity(entity)) return null;
  return typeof entity.uuid === "string" && entity.uuid.length > 0
    ? entity.uuid
    : null;
}

export async function insertMarkdownAtCursor(
  editor: BlockEditorLike,
  markdown: string,
  commandBlockUuid?: string,
): Promise<void> {
  if (typeof editor.insertAtEditingCursor === "function") {
    try {
      await editor.insertAtEditingCursor(markdown);
      return;
    } catch (error) {
      console.debug(
        "[logseq-worktime-table] cursor insertion failed; using block fallback",
        error,
      );
    }
  }

  const current =
    typeof editor.getCurrentBlock === "function"
      ? await editor.getCurrentBlock()
      : null;
  const uuid = getEntityUuid(current) ?? commandBlockUuid ?? null;
  if (!uuid) throw new Error("No active block/cursor found.");

  const targetBlock =
    getEntityUuid(current) === uuid
      ? current
      : typeof editor.getBlock === "function"
        ? await editor.getBlock(uuid)
        : null;

  if (getBlockText(targetBlock).trim().length === 0) {
    if (typeof editor.updateBlock !== "function") {
      throw new Error("Logseq API updateBlock is not available.");
    }
    await editor.updateBlock(uuid, markdown);
    return;
  }

  if (typeof editor.insertBlock !== "function") {
    throw new Error("Logseq API insertBlock is not available.");
  }
  await editor.insertBlock(uuid, markdown, { sibling: true });
}

export async function getPageForBlock(
  editor: EditorLike,
  block: unknown,
): Promise<LogseqEntity | null> {
  if (!isEntity(block)) return null;

  const pageRef = block.page;
  const candidates = getPageIdentityCandidates(pageRef);

  if (typeof editor.getPage === "function") {
    for (const candidate of candidates) {
      try {
        const page = await editor.getPage(candidate);
        if (isEntity(page)) return page;
      } catch {
        // Try the next identity shape. File and DB graph releases accept
        // slightly different page identifiers.
      }
    }
  }

  // Some DB graph calls return an expanded page object directly.
  return looksLikePage(pageRef) ? pageRef : null;
}

export function getJournalDayIso(page: unknown): string | null {
  if (!isEntity(page)) return null;

  const isJournal =
    page["journal?"] === true ||
    page.type === "journal" ||
    hasJournalTag(page) ||
    page.journalDay !== undefined;
  if (!isJournal) return null;

  const rawDay = page.journalDay;
  const day =
    typeof rawDay === "number" && Number.isFinite(rawDay)
      ? String(Math.floor(rawDay))
      : typeof rawDay === "string"
        ? rawDay.trim()
        : "";

  if (!/^\d{8}$/.test(day)) return null;
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

export function getPageDisplayName(page: unknown): string {
  if (!isEntity(page)) return "";

  for (const key of ["originalName", "title", "fullTitle", "name"]) {
    const value = page[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }

  return "";
}

function isEntity(value: unknown): value is LogseqEntity {
  return typeof value === "object" && value !== null;
}

function getPageIdentityCandidates(pageRef: unknown): unknown[] {
  if (
    typeof pageRef === "number" ||
    (typeof pageRef === "string" && pageRef.length > 0)
  ) {
    return [pageRef];
  }
  if (!isEntity(pageRef)) return [];

  const candidates: unknown[] = [];
  for (const key of ["uuid", "id", "name"]) {
    const value = pageRef[key];
    if (
      typeof value === "number" ||
      (typeof value === "string" && value.length > 0)
    ) {
      candidates.push(value);
    }
  }
  return candidates;
}

function looksLikePage(value: unknown): value is LogseqEntity {
  if (!isEntity(value)) return false;
  return (
    typeof value.name === "string" ||
    typeof value.title === "string" ||
    value.type === "page" ||
    value.type === "journal" ||
    value["journal?"] === true
  );
}

function hasJournalTag(page: LogseqEntity): boolean {
  const tags = page.tags ?? page[":block/tags"];
  if (!Array.isArray(tags)) return false;

  return tags.some((tag) => {
    if (typeof tag === "string") {
      return tag === ":logseq.class/Journal" || tag === "Journal";
    }
    if (!isEntity(tag)) return false;
    return (
      tag.ident === ":logseq.class/Journal" ||
      tag.name === "Journal" ||
      tag.title === "Journal"
    );
  });
}
