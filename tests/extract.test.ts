// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from "vitest";
import { extract } from "../src/extract";
beforeEach(() => {
  document.body.innerHTML = "";
});
describe("Moodle extraction", () => {
  it("extracts prose for semantic mapping without prematurely turning headings into tasks", () => {
    document.body.innerHTML = `<nav>Do you want to log out?</nav><main><h1>Peer influence</h1><h2>What is Peer Influence?</h2><p>Peers can support learning.</p><p>How would you describe your peers?</p><div class="dkp-root">Ignore this answer annotation?</div></main>`;
    const s = extract().snapshot;
    expect(s.tasks).toHaveLength(0);
    expect(s.blocks.map((b) => b.text).join(" ")).not.toMatch(
      /log out|annotation/,
    );
    expect(s.blocks.map((b) => b.text).join(" ")).toContain("How would you");
  });
  it("extracts a question once and maps shuffled choice labels", () => {
    document.body.innerHTML = `<main><div class="que"><div class="qtext"><p>What is peer review?</p></div><label><input type="radio" name="q" value="9">Feedback from peers</label><label><input type="radio" name="q" value="2">A sporting event</label></div></main>`;
    const data = extract();
    expect(data.snapshot.tasks).toHaveLength(1);
    expect(data.snapshot.tasks[0].kind).toBe("moodle-task");
    expect(data.snapshot.tasks[0].choices.map((c) => c.text)).toEqual([
      "Feedback from peers",
      "A sporting event",
    ]);
    expect(data.controls.size).toBe(2);
  });
  it("maps every blank in a multi-field Moodle task", () => {
    document.body.innerHTML = `<main><div class="que"><p>Complete the sentences: You <input type="text"> (work) today. She <input type="text"> (study) now.</p></div></main>`;
    const data = extract();
    const task = data.snapshot.tasks[0];
    expect(task.fields).toEqual([
      { id: `${task.id}-f0`, label: "Blank 1" },
      { id: `${task.id}-f1`, label: "Blank 2" },
    ]);
    expect(task.text).toContain(`[FIELD ${task.id}-f0]`);
    expect(data.fields.size).toBe(2);
  });
  it("detects inaccessible media and fingerprints actual source changes", () => {
    document.body.innerHTML =
      '<main><p>Watch the video and describe what happened?</p><iframe title="Lesson video"></iframe></main>';
    const a = extract().snapshot;
    expect(a.media).toContain("Lesson video");
    document.querySelector("p")!.textContent = "Describe the article instead?";
    expect(extract().snapshot.fingerprint).not.toBe(a.fingerprint);
  });
  it("excludes hidden answers and does not expose student text field values", () => {
    document.body.innerHTML =
      '<main><div class="que"><p>Explain this phenomenon.</p><div hidden>Secret answer</div><div style="display:none">CSS hidden answer</div><input type="text" value="My private draft"></div></main>';
    expect(extract().snapshot.blocks[0].text).toBe("Explain this phenomenon.");
  });
});
