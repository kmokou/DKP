import { describe, expect, it } from "vitest";
import { isTextQuestion } from "../src/features/text-questions";

describe("text question detection", () => {
  it("rejects classroom directions and headings", () => {
    expect(isTextQuestion("I. Discuss with a partner:")).toBe(false);
    expect(isTextQuestion("Read the article.")).toBe(false);
    expect(isTextQuestion("The Impact of Peer Influence")).toBe(false);
    expect(
      isTextQuestion(
        "When students are secure in their values, they are less likely to give in to pressure.",
      ),
    ).toBe(false);
  });

  it("accepts explicit and colon-ended questions", () => {
    expect(isTextQuestion("How would you describe your peers?")).toBe(true);
    expect(isTextQuestion("2. What do the combinations below mean:")).toBe(
      true,
    );
  });

  it("accepts a concrete answerable instruction", () => {
    expect(
      isTextQuestion("Explain the difference between these two terms."),
    ).toBe(true);
    expect(
      isTextQuestion(
        "Watch the video and explain why the speaker changed her opinion.",
      ),
    ).toBe(true);
  });
});
