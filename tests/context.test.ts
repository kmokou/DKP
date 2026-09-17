import { describe, expect, it } from "vitest";
import { contextPage, retrieveContext, upsertPage } from "../src/context";
import type { Snapshot, StudyContext } from "../src/types";

const makeSnapshot = (url: string, title: string, text: string): Snapshot => ({
  title, url, fingerprint: title, selection: "", media: [], truncated: false,
  words: text.split(/\s+/).length, tasks: [],
  blocks: [{ id: "b1", text, kind: "p" }],
});
describe("cross-page contexts", () => {
  it("stores compact pages and retrieves the relevant other-page evidence", () => {
    const now = Date.now();
    let context: StudyContext = {
      id: "c1", name: "Unit", nativeLanguage: "Русский",
      createdAt: now, updatedAt: now, pages: [],
    };
    context = upsertPage(context, contextPage(makeSnapshot(
      "https://school.test/article", "Article",
      "Peer tutoring improves study habits and creates a supportive academic environment.",
    )));
    context = upsertPage(context, contextPage(makeSnapshot(
      "https://school.test/vocabulary", "Vocabulary",
      "A volcano is an opening in the crust of a planet.",
    )));
    const current = makeSnapshot("https://school.test/quiz", "Quiz",
      "Which practice improves study habits?");
    const found = retrieveContext(context, current, "peer tutoring study habits", 2);
    expect(found[0]).toMatchObject({
      pageTitle: "Article", pageUrl: "https://school.test/article",
    });
    expect(found[0].id).toContain("ctx-page-");
  });
  it("replaces a revisited page instead of duplicating it", () => {
    const now = Date.now();
    const base: StudyContext = {
      id: "c1", name: "Unit", nativeLanguage: "Русский",
      createdAt: now, updatedAt: now, pages: [],
    };
    const first = upsertPage(base, contextPage(makeSnapshot("https://a.test/p", "A", "Old text")));
    const second = upsertPage(first, contextPage(makeSnapshot("https://a.test/p", "A", "New text")));
    expect(second.pages).toHaveLength(1);
    expect(second.pages[0].blocks[0].text).toBe("New text");
  });
});
