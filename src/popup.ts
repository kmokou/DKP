import type { StudyContext } from "./types";
import { stringifyUnknown } from "./core";

const root = document.getElementById("contexts")!;
const form = document.getElementById("new-context") as HTMLFormElement;
const nameInput = document.getElementById("context-name") as HTMLInputElement;
const error = document.getElementById("error") as HTMLParagraphElement;
const settings = document.getElementById("settings") as HTMLAnchorElement;

async function rpc<T>(message: Record<string, unknown>): Promise<T> {
  const response = await browser.runtime.sendMessage(message);
  if (!response?.ok) throw response?.error || new Error("DKP could not respond.");
  return response.data as T;
}
function showError(reason: unknown) {
  error.hidden = false;
  const value = reason && typeof reason === "object" && "message" in reason
    ? reason as { title?: string; message: unknown } : undefined;
  error.textContent = (value?.title ? value.title + ": " : "") + stringifyUnknown(value?.message ?? reason);
}
async function addPageToContext(contextId: string) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) throw new Error("Open a lesson or exercise first.");
  const response = await browser.runtime.sendMessage({ type: "quickAddPage", tabId: tab.id, contextId });
  if (!response?.ok) throw response?.error || new Error("DKP could not add this page.");
  window.close();
}
function render(contexts: StudyContext[]) {
  root.replaceChildren();
  if (!contexts.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No contexts yet. Create one below."; root.append(empty); return; }
  for (const context of contexts) {
    const button = document.createElement("button"); button.className = "context-choice"; button.type = "button";
    const copy = document.createElement("span"); const title = document.createElement("b"); title.textContent = context.name;
    const meta = document.createElement("small"); meta.textContent = context.pages.length + " page" + (context.pages.length === 1 ? "" : "s"); copy.append(title, meta);
    const action = document.createElement("span"); action.textContent = "+ Add page"; button.append(copy, action);
    button.onclick = () => void addPageToContext(context.id).catch(showError); root.append(button);
  }
}
async function start() {
  try { const state = await rpc<{ contexts: StudyContext[] }>({ type: "state" }); render(state.contexts); settings.href = browser.runtime.getURL("sidebar.html#settings"); }
  catch (reason) { showError(reason); }
}
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.contexts) void start();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try { const context = await rpc<StudyContext>({ type: "createContext", name: nameInput.value }); await addPageToContext(context.id); }
  catch (reason) { showError(reason); }
});
void start();
