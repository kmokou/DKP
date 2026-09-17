import { describe, expect, it } from "vitest";
import { summaryEndBlockId } from "../src/features/summary";
import type { Snapshot } from "../src/types";

describe("inline summary placement", () => {
  it("places the summary after the reading and before later exercises", () => {
    const snapshot: Snapshot = {
      title: "Lesson",
      url: "https://school.test/lesson",
      fingerprint: "x",
      selection: "",
      media: [],
      truncated: false,
      words: 150,
      blocks: [
        {
          id: "prompt",
          kind: "h2",
          text: "II. Skim the article. Which topic is discussed?",
        },
        { id: "title", kind: "h3", text: "The Impact of Peer Influence" },
        { id: "p1", kind: "p", text: "A".repeat(240) },
        { id: "p2", kind: "p", text: "B".repeat(240) },
        {
          id: "exercise",
          kind: "p",
          text: "III. Scan the article and decide whether the statements are true or false.",
        },
        {
          id: "question",
          kind: "li",
          text: "What is the main idea of the article?",
        },
      ],
      tasks: [
        {
          id: "q-prompt",
          blockId: "prompt",
          text: "II. Skim the article. Which topic is discussed?",
          kind: "text-question",
          choices: [],
          fields: [],
        },
        {
          id: "q-question",
          blockId: "question",
          text: "What is the main idea of the article?",
          kind: "text-question",
          choices: [],
          fields: [],
        },
      ],
    };
    expect(summaryEndBlockId(snapshot)).toBe("p2");
  });
});
