import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:4173/privacy.html");
await page.setContent(`<!doctype html><main>
  <h1>What is Lifelong Learning?</h1>
  <p id="reading">Lifelong learning is voluntary education focused on personal development and fulfilment. It can happen inside or outside formal institutions and continues throughout life.</p>
  <h2 id="real-question">How can lifelong learning support personal development?</h2>
  <div class="que" id="native-task"><p>Complete: Learning <input type="text"> throughout life.</p></div>
</main>`);
await page.evaluate(() => {
  globalThis.dkpListeners = [];
  globalThis.browser = {
    runtime: {
      onMessage: { addListener: (listener) => globalThis.dkpListeners.push(listener) },
      sendMessage: async (message) => {
        if (message.type === "cancel" || message.type === "revealEvidence") return { ok: true, data: true };
        if (message.type === "generate") {
          const task = message.snapshot.tasks.find((item) => item.id === message.taskId);
          const source = message.snapshot.blocks.find((item) =>
            item.text.includes("Lifelong learning is voluntary"));
          return { ok: true, data: {
            summary: "",
            warnings: [],
            tokens: 20,
            answers: [{
              id: task.id, blockId: task.blockId, question: task.text,
              answer: task.fields.length ? "continues" : "It supports ongoing growth.",
              explanation: "The reading directly describes continuing personal development.",
              evidence: "page", quote: "focused on personal development",
              sourceId: source.id,
              evidenceRefs: [{ sourceId: source.id, quote: "focused on personal development",
                before: "Lifelong learning is voluntary education", after: "and fulfilment.",
                pageTitle: "Lesson", pageUrl: location.href }],
              missing: "", confidence: "high", strategy: "direct", choiceIds: [],
              fieldValues: task.fields.map((field) => ({ fieldId: field.id, value: "continues" })),
            }],
          }};
        }
      },
    },
  };
});
await page.addScriptTag({ path: "dist/content.js" });
const snapshot = await page.evaluate(() => globalThis.dkpListeners[0]({ type: "scan" }));
const heading = snapshot.blocks.find((block) => block.text === "What is Lifelong Learning?");
const reading = snapshot.blocks.find((block) => block.text.startsWith("Lifelong learning is voluntary"));
const question = snapshot.blocks.find((block) => block.text.startsWith("How can lifelong"));
const native = snapshot.tasks[0];
assert.ok(heading && reading && question && native);
await page.evaluate(({ map }) => globalThis.dkpListeners[0]({
  type: "applySemanticMap", contextId: "c1", semanticMap: map,
}), { map: { fingerprint: snapshot.fingerprint, pageType: "mixed", units: [
  { id: "topic", type: "topic", startBlockId: heading.id, endBlockId: reading.id,
    anchorBlockId: reading.id, action: "summary", reason: "reading" },
  { id: "question", type: "question", startBlockId: question.id, endBlockId: question.id,
    anchorBlockId: question.id, action: "answer", reason: "real question" },
  { id: "quiz", type: "quiz", startBlockId: native.blockId, endBlockId: native.blockId,
    anchorBlockId: native.blockId, action: "solve", reason: "native control" },
] }});
assert.equal(await page.getByRole("button", { name: /Solve all tasks/ }).count(), 1);
assert.equal(await page.getByRole("button", { name: /Summarize this text/ }).count(), 1);
assert.equal(await page.getByRole("button", { name: /Generate answer/ }).count(), 1);
assert.equal(await page.locator("h1 + .dkp-root").count(), 0);
assert.equal(await page.locator("#reading + .dkp-root").getByRole("button", { name: /Summarize/ }).count(), 1);
const taskHost = page.locator("#native-task + .dkp-root");
await taskHost.evaluate((node) => node.shadowRoot?.querySelector("button")?.click());
await page.waitForTimeout(500);
await taskHost.getByRole("button", { name: "Fill answer" }).click();
assert.equal(await page.locator("#native-task input").inputValue(), "continues");
await taskHost.getByRole("button", { name: "↶ Undo" }).click();
assert.equal(await page.locator("#native-task input").inputValue(), "");
assert.deepEqual(errors, []);
console.log("Content smoke passed");
await browser.close();
