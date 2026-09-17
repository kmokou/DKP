import { describe, it, expect } from "vitest";
import { chunks, stringifyUnknown, validateResult, validateSemanticMap } from "../src/core";
import type { Snapshot } from "../src/types";
const snapshot: Snapshot = {
  title: "Reading",
  url: "https://school.example/course",
  fingerprint: "x",
  words: 10,
  selection: "",
  truncated: false,
  media: [],
  blocks: [
    {
      id: "b1",
      text: "Peer tutoring involves learners helping other learners.",
      kind: "p",
    },
  ],
  tasks: [
    {
      id: "q1",
      blockId: "b1",
      text: "Which?",
      kind: "moodle-task",
      choices: [{ id: "c1", text: "Tutoring" }],
      fields: [{ id: "f1", label: "Blank 1" }],
    },
  ],
};
const answer = {
  id: "q1",
  blockId: "invented",
  question: "Which?",
  answer: "Tutoring",
  explanation: "Learners help peers.",
  evidence: "page",
  quote: "learners helping other learners",
  sourceId: "b1",
  evidenceRefs: [{ sourceId: "b1", quote: "learners helping other learners", before: "", after: "" }],
  missing: "",
  confidence: "high",
  strategy: "direct",
  choiceIds: ["c1", "invented"],
  fieldValues: [
    { fieldId: "f1", value: "works" },
    { fieldId: "invented", value: "wrong" },
  ],
};
describe("grounding and output validation", () => {
  it("keeps genuine quotations, maps known questions and rejects invented choices", () => {
    const r = validateResult(
      { summary: "", answers: [answer], warnings: [] },
      snapshot,
    );
    expect(r.answers[0]).toMatchObject({
      blockId: "b1",
      evidence: "page",
      choiceIds: ["c1"],
      fieldValues: [{ fieldId: "f1", value: "works" }],
    });
  });
  it("downgrades fabricated page evidence", () => {
    const r = validateResult(
      {
        summary: "",
        answers: [{ ...answer, quote: "This is made up", evidenceRefs: [{ sourceId: "b1", quote: "This is made up", before: "", after: "" }] }],
        warnings: [],
      },
      snapshot,
    );
    expect(r.answers[0].evidence).toBe("general");
    expect(r.answers[0].quote).toBe("");
  });
  it("makes missing material override a page-supported claim", () => {
    const r = validateResult(
      {
        summary: "",
        answers: [{ ...answer, missing: "The video is unavailable." }],
        warnings: [],
      },
      snapshot,
    );
    expect(r.answers[0].evidence).toBe("missing");
  });
  it("does not warn about unrelated media and still marks truncation", () => {
    const r = validateResult(
      { summary: "text", answers: [], warnings: [] },
      { ...snapshot, media: ["video"], truncated: true },
    );
    expect(r.warnings).toEqual(["Only part of this page was included."]);
  });
  it("rejects semantic actions that reference invented DOM blocks", () => {
    const map = validateSemanticMap({
      pageType: "mixed",
      units: [
        { id: "good", type: "topic", startBlockId: "b1", endBlockId: "b1", anchorBlockId: "b1", action: "summary", reason: "reading" },
        { id: "bad", type: "question", startBlockId: "invented", endBlockId: "b1", anchorBlockId: "b1", action: "answer", reason: "question" },
      ],
    }, snapshot);
    expect(map.units.map((unit) => unit.id)).toEqual(["good"]);
  });
  it("rejects malformed envelopes and ignores malformed answer records", () => {
    expect(() => validateResult({}, snapshot)).toThrow();
    expect(
      validateResult(
        { summary: "", answers: [null, {}], warnings: [] },
        snapshot,
      ).answers,
    ).toEqual([]);
  });
});
describe("reading processing", () => {
  it("renders unknown objects as useful JSON", () => {
    expect(stringifyUnknown({ code: 400, status: "INVALID_ARGUMENT" })).toBe(
      '{\n  "code": 400,\n  "status": "INVALID_ARGUMENT"\n}',
    );
    expect(stringifyUnknown({})).not.toContain("[object Object]");
  });
  it("splits huge paragraphs without losing content", () => {
    const text = "a".repeat(40001);
    const c = chunks(text);
    expect(c.join("")).toBe(text);
    expect(c.every((x) => x.length <= 14000)).toBe(true);
  });
});
