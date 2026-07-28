import { describe, expect, it, vi } from "vitest";

import {
  detectGraphKind,
  getBlockText,
  getEntityUuid,
  getJournalDayIso,
  getPageDisplayName,
  getPageForBlock,
  insertMarkdownAtCursor,
} from "./logseqCompat";

describe("Logseq file/DB graph compatibility", () => {
  it("reads block text from file-graph and DB-graph entities", () => {
    expect(getBlockText({ content: "file graph table" })).toBe(
      "file graph table",
    );
    expect(getBlockText({ title: "DB graph table" })).toBe("DB graph table");
    expect(
      getBlockText({ title: "new value", content: "deprecated value" }),
    ).toBe("new value");
  });

  it("detects graph type and safely defaults old Logseq versions to file", async () => {
    await expect(
      detectGraphKind({ checkCurrentIsDbGraph: async () => true }),
    ).resolves.toBe("db");
    await expect(detectGraphKind({})).resolves.toBe("file");
    await expect(
      detectGraphKind({
        checkCurrentIsDbGraph: async () => {
          throw new Error("not implemented");
        },
      }),
    ).resolves.toBe("file");
  });

  it("resolves file-graph numeric page references", async () => {
    const getPage = vi.fn(async (identity: unknown) =>
      identity === 42 ? { id: 42, name: "Projects" } : null,
    );

    await expect(
      getPageForBlock({ getPage }, { page: { id: 42 } }),
    ).resolves.toEqual({ id: 42, name: "Projects" });
    expect(getPage).toHaveBeenCalledWith(42);
  });

  it("resolves DB-graph UUID page references and expanded page objects", async () => {
    const getPage = vi.fn(async (identity: unknown) =>
      identity === "page-uuid"
        ? { uuid: "page-uuid", title: "DB Project", type: "page" }
        : null,
    );

    await expect(
      getPageForBlock({ getPage }, { page: { uuid: "page-uuid" } }),
    ).resolves.toMatchObject({ title: "DB Project" });

    await expect(
      getPageForBlock(
        {},
        {
          page: {
            uuid: "journal-uuid",
            title: "Today",
            type: "journal",
            journalDay: 20260728,
          },
        },
      ),
    ).resolves.toMatchObject({ type: "journal" });
  });

  it("normalizes journal and page metadata from both graph types", () => {
    expect(
      getJournalDayIso({ "journal?": true, journalDay: 20260728 }),
    ).toBe("2026-07-28");
    expect(
      getJournalDayIso({
        type: "journal",
        journalDay: "20260728",
      }),
    ).toBe("2026-07-28");
    expect(
      getJournalDayIso({
        tags: [{ ident: ":logseq.class/Journal" }],
        journalDay: 20260728,
      }),
    ).toBe("2026-07-28");
    expect(getJournalDayIso({ type: "page", journalDay: undefined })).toBeNull();

    expect(getPageDisplayName({ originalName: "File Page" })).toBe("File Page");
    expect(getPageDisplayName({ title: "DB Page" })).toBe("DB Page");
    expect(getEntityUuid({ uuid: "block-uuid" })).toBe("block-uuid");
  });

  it("uses the shared cursor API when it is available", async () => {
    const insertAtEditingCursor = vi.fn(async () => undefined);

    await insertMarkdownAtCursor(
      { insertAtEditingCursor },
      "| Worktime table |",
      "command-block",
    );

    expect(insertAtEditingCursor).toHaveBeenCalledWith("| Worktime table |");
  });

  it("updates an empty slash-command block when cursor insertion is unavailable", async () => {
    const updateBlock = vi.fn(async () => undefined);

    await insertMarkdownAtCursor(
      {
        getBlock: async () => ({ uuid: "db-block", title: "" }),
        updateBlock,
      },
      "| DB table |",
      "db-block",
    );

    expect(updateBlock).toHaveBeenCalledWith("db-block", "| DB table |");
  });

  it("inserts a sibling when the fallback target already contains text", async () => {
    const insertBlock = vi.fn(async () => undefined);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    try {
      await insertMarkdownAtCursor(
        {
          insertAtEditingCursor: async () => {
            throw new Error("cursor was closed by modal");
          },
          getCurrentBlock: async () => ({
            uuid: "file-block",
            content: "Keep this text",
          }),
          insertBlock,
        },
        "| File table |",
        "file-block",
      );
    } finally {
      debug.mockRestore();
    }

    expect(insertBlock).toHaveBeenCalledWith("file-block", "| File table |", {
      sibling: true,
    });
  });
});
