import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  const snapshot = {
    title: "Unit 1.6 · Lifelong Learning",
    url: "https://school.test/unit-1-6",
    fingerprint: "fp",
    selection: "",
    media: [],
    truncated: false,
    words: 486,
    blocks: [
      { id: "b1", kind: "h1", text: "What is Lifelong Learning?" },
      { id: "b2", kind: "p", text: "Lifelong learning is voluntary and supports personal fulfilment." },
      { id: "b3", kind: "p", text: "Explain why lifelong learning matters?" },
    ],
    tasks: [],
  };
  const context = {
    id: "c1", name: "English · Unit 1.6", nativeLanguage: "Русский",
    createdAt: 1, updatedAt: 1, pages: [],
  };
  let applied = false;
  globalThis.browser = {
    runtime: { sendMessage: async (message) => {
      if (message.type === "state") return { ok: true, data: {
        settings: {
          provider: "gemini",
          models: { gemini: "gemini-2.5-flash", openai: "gpt-4.1-mini",
            anthropic: "claude-sonnet-4-5", deepseek: "deepseek-chat" },
          nativeLanguage: "Русский", outputLanguage: "native", level: "Natural",
          mode: "Answer + explanation", summaryStyle: "Study notes",
        },
        contexts: [context],
        providerStates: ["gemini", "openai", "anthropic", "deepseek"].map((provider) => ({
          provider, hasKey: provider === "gemini", remembered: false, model: "",
        })),
      }};
      if (message.type === "createContext") return { ok: true, data: context };
      if (message.type === "addContextPage") return { ok: true, data: {
        context: { ...context, pages: [{ id: "p1", title: snapshot.title,
          url: snapshot.url, fingerprint: "fp", addedAt: 1, updatedAt: 1,
          blocks: snapshot.blocks }] },
        semanticMap: { fingerprint: "fp", pageType: "mixed", units: [
          { id: "read", type: "topic", startBlockId: "b1", endBlockId: "b2",
            anchorBlockId: "b2", action: "summary", reason: "reading" },
          { id: "q", type: "question", startBlockId: "b3", endBlockId: "b3",
            anchorBlockId: "b3", action: "answer", reason: "question" },
        ]},
      }};
      return { ok: true, data: true };
    }},
    storage: { onChanged: { addListener: () => {} } },
    tabs: { sendMessage: async (_tab, message) => {
      if (message.type === "applySemanticMap") { applied = true; return snapshot; }
      if (message.type === "scan") return applied ? { ...snapshot, tasks: [{
        id: "semantic-q", blockId: "b3", text: "Explain why lifelong learning matters?",
        kind: "text-question", choices: [], fields: [],
      }]} : snapshot;
    }},
  };
});

await page.goto("http://127.0.0.1:4173/sidebar.html");
await page.getByText("Contexts", { exact: true }).first().waitFor();
await page.getByRole("button", { name: "Open context →" }).click();
await page.getByText("Ask across this context").waitFor();
assert.equal(await page.locator("#devtools").isVisible(), true);
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
await page.screenshot({ path: "/tmp/dkp-ui.png", fullPage: true });
assert.deepEqual(errors, []);
console.log("UI smoke passed");
await browser.close();
