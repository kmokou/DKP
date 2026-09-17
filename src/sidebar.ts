import { providerLabels, type Attachment, type LlmLog, type ModelOption, type ProviderId,
  type ProviderState, type Result, type SemanticMap, type Settings,
  type Snapshot, type StudyContext } from "./types";
import { stringifyUnknown } from "./core";

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sourceTabId = Number(new URLSearchParams(location.search).get("tabId")) || 0;
let selectedContextId = new URLSearchParams(location.search).get("contextId") || "";
let settings: Settings;
let contexts: StudyContext[] = [];
let providerStates: ProviderState[] = [];
let snapshot: Snapshot | undefined;
let semanticMap: SemanticMap | undefined;
let activeContext: StudyContext | undefined;
let activeRequestId = "";

async function rpc<T = any>(message: Record<string, unknown>): Promise<T> {
  const response = await browser.runtime.sendMessage(message);
  if (!response?.ok) throw response?.error || new Error("DKP did not respond.");
  return response.data as T;
}
async function sendToPage<T = any>(message: Record<string, unknown>): Promise<T> {
  try {
    return await browser.tabs.sendMessage(sourceTabId, message) as T;
  } catch (firstError) {
    // Firefox drops content-script ports after a page reload or temporary
    // extension reload. Re-inject once, then retry the same request.
    try {
      await rpc({ type: "ensurePage", tabId: sourceTabId });
      return await browser.tabs.sendMessage(sourceTabId, message) as T;
    } catch {
      throw firstError;
    }
  }
}
function errorValue(reason: unknown) {
  if (reason && typeof reason === "object" && "message" in reason) {
    const value = reason as any;
    return { title: typeof value.title === "string" ? value.title : "DKP error",
      message: String(value.message), details: value.details || {} };
  }
  return { title: "DKP error", message: reason instanceof Error ? reason.message : "Action failed.",
    details: { received: stringifyUnknown(reason) } };
}
function showError(reason: unknown) {
  const value = errorValue(reason);
  const root = get<HTMLDivElement>("error");
  root.hidden = false;
  root.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = value.title;
  const p = document.createElement("p");
  p.textContent = value.message;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Technical details";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify({ timestamp: new Date().toISOString(), ...value.details }, null, 2);
  details.append(summary, pre);
  root.append(strong, p, details);
}
function clearError() { get("error").hidden = true; }
function switchTab(name: string) {
  document.querySelectorAll<HTMLElement>(".panel").forEach((panel) => panel.hidden = panel.id !== name);
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((button) =>
    button.classList.toggle("active", button.dataset.tab === name));
  if (name === "contexts") renderContexts();
  if (name === "settings") fillSettings();
}
document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((button) =>
  button.addEventListener("click", () => switchTab(button.dataset.tab || "workspace")));

async function loadState() {
  const state = await rpc<{ settings: Settings; contexts: StudyContext[]; providerStates: ProviderState[] }>({ type: "state" });
  settings = state.settings;
  contexts = state.contexts;
  providerStates = state.providerStates;
  get("context-count").textContent = String(contexts.length);
  fillSettings();
}
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.contexts) return;
  void loadState().then(() => {
    renderContexts();
    if (activeContext) {
      activeContext = contexts.find((context) => context.id === activeContext!.id);
      if (activeContext && !get("workspace").hidden) showWorkspace();
    }
  }).catch(showError);
});
async function scanPage() {
  if (!sourceTabId) throw new Error("Open DKP from a lesson or exercise tab.");
  snapshot = await sendToPage<Snapshot>({ type: "scan" });
  get("page-loading").hidden = true;
  const normalizedUrl = snapshot!.url.split("#")[0].split("?")[0];
  activeContext = contexts.find((context) => context.id === selectedContextId) || contexts.find((context) => context.pages.some((page) =>
    page.url.split("#")[0].split("?")[0] === normalizedUrl));
  if (!activeContext) return showContextGate();
  const stored = activeContext.pages.find((page) =>
    page.url.split("#")[0].split("?")[0] === normalizedUrl);
  if (stored?.semanticMap) {
    semanticMap = stored.semanticMap;
    await sendToPage({
      type: "applySemanticMap", semanticMap, contextId: activeContext.id,
    });
    snapshot = await sendToPage<Snapshot>({ type: "scan" });
    showWorkspace();
  } else await activateContext(activeContext.id);
}
function showContextGate() {
  get("context-gate").hidden = false;
  get("active-workspace").hidden = true;
  const root = get("context-options");
  root.replaceChildren();
  for (const context of contexts) {
    const button = document.createElement("button");
    button.className = "context-choice";
    const text = document.createElement("span");
    const name = document.createElement("b");
    name.textContent = context.name;
    const meta = document.createElement("small");
    meta.textContent = context.pages.length + " page" + (context.pages.length === 1 ? "" : "s");
    text.append(name, meta);
    const arrow = document.createElement("span");
    arrow.textContent = "Add →";
    button.append(text, arrow);
    button.onclick = () => void activateContext(context.id);
    root.append(button);
  }
  if (!contexts.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Create the first context for this course or topic.";
    root.append(empty);
  }
}
async function activateContext(contextId: string) {
  if (!snapshot) return;
  clearError();
  get("context-gate").hidden = true;
  get("page-loading").hidden = false;
  get("page-loading").querySelector("strong")!.textContent = "Mapping the page";
  get("page-loading").querySelector("p")!.textContent = "Separating topics, questions and exercises.";
  try {
    const data = await rpc<{ context: StudyContext; semanticMap: SemanticMap }>({
      type: "addContextPage", contextId, snapshot,
    });
    semanticMap = data.semanticMap;
    activeContext = data.context;
    contexts = contexts.map((item) => item.id === data.context.id ? data.context : item);
    await sendToPage({
      type: "applySemanticMap", semanticMap, contextId,
    });
    snapshot = await sendToPage<Snapshot>({ type: "scan" });
    showWorkspace();
  } catch (error) {
    get("page-loading").hidden = true;
    showError(error);
    showContextGate();
  }
}
function showWorkspace() {
  if (!snapshot || !activeContext) return;
  get("page-loading").hidden = true;
  get("context-gate").hidden = true;
  get("active-workspace").hidden = false;
  get("page-title").textContent = snapshot.title || "Untitled page";
  get("page-url").textContent = snapshot.url;
  get("page-words").textContent = snapshot.words.toLocaleString() + " words";
  get("page-tasks").textContent = snapshot.tasks.length + " tasks";
  get("active-context-name").textContent = activeContext.name;
  get("page-kind").textContent = (semanticMap?.pageType || "page").toUpperCase();
  const detail = get("context-detail-pages");
  detail.replaceChildren();
  for (const page of activeContext.pages) {
    const row = document.createElement("div"); row.className = "stored-page";
    const copy = document.createElement("span");
    const title = document.createElement("b"); title.textContent = page.title;
    const url = document.createElement("small"); url.textContent = page.url;
    copy.append(title, url); row.append(copy); detail.append(row);
  }
  get("context-detail-copy").textContent = activeContext.pages.length + " page" + (activeContext.pages.length === 1 ? "" : "s") + " connected. Ask questions using all of them.";
  const provider = providerStates.find((item) => item.provider === settings.provider);
  get("provider-status").textContent = provider?.hasKey
    ? providerLabels[settings.provider] + " · " + (settings.models[settings.provider] || "model")
    : "Connect " + providerLabels[settings.provider] + " in Settings";
}

function renderDevtools(logs: LlmLog[]) {
  const root = get("devtools-log");
  root.replaceChildren();
  if (!logs.length) { const empty = document.createElement("p"); empty.className = "help"; empty.textContent = "No LLM transactions for this context yet."; root.append(empty); return; }
  for (const log of logs) {
    const entry = document.createElement("article"); entry.className = "log-entry";
    const meta = document.createElement("div"); meta.className = "log-meta";
    const label = document.createElement("span"); label.textContent = log.operation;
    const time = document.createElement("time"); time.textContent = new Date(log.timestamp).toLocaleString();
    meta.append(label, time);
    const info = document.createElement("div"); info.className = "help"; info.textContent = log.provider + " · " + log.model + (log.endpoint ? " · " + log.endpoint : "");
    const request = document.createElement("details"); request.open = true; const rs = document.createElement("summary"); rs.textContent = "Raw request"; const rp = document.createElement("pre"); rp.textContent = JSON.stringify(log.request, null, 2); request.append(rs, rp);
    const response = document.createElement("details"); response.open = true; const ss = document.createElement("summary"); ss.textContent = log.error ? "Raw error" : "Raw response"; const sp = document.createElement("pre"); sp.textContent = JSON.stringify(log.error || log.response, null, 2); response.append(ss, sp);
    entry.append(meta, info, request, response); root.append(entry);
  }
}
async function openDevtools() {
  if (!activeContext) return;
  get("devtools-panel").hidden = false;
  renderDevtools(await rpc<LlmLog[]>({ type: "devtoolsLogs", contextId: activeContext.id }));
  get("devtools-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

get("change-context").addEventListener("click", showContextGate);
get("devtools").addEventListener("click", () => void openDevtools().catch(showError));
get("clear-devtools").addEventListener("click", async () => {
  if (!activeContext || !confirm("Clear raw LLM logs for this context?")) return;
  await rpc({ type: "clearDevtoolsLogs", contextId: activeContext.id });
  renderDevtools([]);
});
get<HTMLFormElement>("quick-context").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = get<HTMLInputElement>("quick-context-name");
  try {
    const context = await rpc<StudyContext>({ type: "createContext", name: input.value });
    contexts.unshift(context);
    input.value = "";
    get("context-count").textContent = String(contexts.length);
    await activateContext(context.id);
  } catch (error) { showError(error); }
});
get<HTMLFormElement>("create-context").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = get<HTMLInputElement>("context-name");
  try {
    const context = await rpc<StudyContext>({ type: "createContext", name: input.value });
    contexts.unshift(context);
    input.value = "";
    get("context-count").textContent = String(contexts.length);
    renderContexts();
  } catch (error) { showError(error); }
});
function renderContexts() {
  const root = get("contexts-list");
  root.replaceChildren();
  if (!contexts.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No contexts yet. Create one, then add related pages from the page popup.";
    root.append(empty);
    return;
  }
  for (const context of contexts) {
    const card = document.createElement("article");
    card.className = "context-card";
    card.tabIndex = 0;
    card.onclick = () => openContext(context);
    card.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") openContext(context); };
    const header = document.createElement("header");
    const copy = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = context.name;
    const meta = document.createElement("p");
    meta.textContent = context.pages.length + " pages · " + context.nativeLanguage;
    copy.append(title, meta);
    const remove = document.createElement("button");
    remove.className = "text-button danger";
    remove.textContent = "Delete";
    remove.onclick = async (event) => {
      event.stopPropagation();
      if (!confirm("Delete this context and its locally stored page knowledge?")) return;
      await rpc({ type: "deleteContext", contextId: context.id });
      contexts = contexts.filter((item) => item.id !== context.id);
      if (activeContext?.id === context.id) activeContext = undefined;
      get("context-count").textContent = String(contexts.length);
      renderContexts();
    };
    header.append(copy, remove);
    const pages = document.createElement("div");
    pages.className = "page-list";
    if (!context.pages.length) pages.textContent = "No pages added yet.";
    for (const page of context.pages) {
      const row = document.createElement("div");
      row.className = "stored-page";
      const pageCopy = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = page.title;
      const url = document.createElement("small");
      url.textContent = page.url;
      pageCopy.append(name, url);
      const removePage = document.createElement("button");
      removePage.className = "text-button";
      removePage.textContent = "Remove";
      removePage.onclick = async (event) => {
        event.stopPropagation();
        await rpc({ type: "removeContextPage", contextId: context.id, pageId: page.id });
        context.pages = context.pages.filter((item) => item.id !== page.id);
        renderContexts();
      };
      row.append(pageCopy, removePage);
      pages.append(row);
    }
    const open = document.createElement("button");
    open.className = "button";
    open.type = "button";
    open.textContent = "Open context →";
    open.onclick = (event) => { event.stopPropagation(); openContext(context); };
    card.append(header, pages, open);
    root.append(card);
  }
}

function openContext(context: StudyContext) {
  selectedContextId = context.id;
  activeContext = context;
  clearError();
  if (sourceTabId) void scanPage().catch(showError);
  else {
    snapshot = {
      title: context.name, url: "context://" + context.id,
      fingerprint: context.pages.map((page) => page.fingerprint).join("-"),
      blocks: context.pages.flatMap((page) => page.blocks), tasks: [], selection: "", media: [],
      truncated: false, words: context.pages.flatMap((page) => page.blocks)
        .reduce((total, block) => total + block.text.split(/\s+/).length, 0),
    };
    semanticMap = undefined;
    showWorkspace();
    switchTab("workspace");
  }
}

function fillSettings() {
  if (!settings) return;
  const provider = get<HTMLSelectElement>("provider");
  provider.value = settings.provider;
  get<HTMLSelectElement>("native-language").value = settings.nativeLanguage;
  get<HTMLSelectElement>("output-language").value = settings.outputLanguage;
  get<HTMLSelectElement>("answer-mode").value = settings.mode;
  get<HTMLSelectElement>("summary-style").value = settings.summaryStyle;
  updateProviderForm();
}
function updateProviderForm() {
  const provider = get<HTMLSelectElement>("provider").value as ProviderId;
  const state = providerStates.find((item) => item.provider === provider);
  get<HTMLInputElement>("api-key").value = "";
  get<HTMLInputElement>("remember-key").checked = !!state?.remembered;
  get("provider-note").textContent = state?.hasKey
    ? providerLabels[provider] + " key connected. Refresh to load its current models."
    : "Add your own " + providerLabels[provider] + " API key.";
  const model = get<HTMLSelectElement>("model");
  model.replaceChildren(new Option(settings.models[provider] || "Load models first", settings.models[provider] || ""));
}
get("provider").addEventListener("change", updateProviderForm);
get("show-key").addEventListener("click", () => {
  const input = get<HTMLInputElement>("api-key");
  input.type = input.type === "password" ? "text" : "password";
  get("show-key").textContent = input.type === "password" ? "Show" : "Hide";
});
async function loadModels() {
  const provider = get<HTMLSelectElement>("provider").value as ProviderId;
  const note = get("provider-note");
  note.textContent = "Loading available models…";
  const models = await rpc<ModelOption[]>({ type: "listModels", provider });
  const select = get<HTMLSelectElement>("model");
  select.replaceChildren(...models.map((item) => new Option(item.label, item.id)));
  const chosen = settings.models[provider];
  if (chosen && models.some((item) => item.id === chosen)) select.value = chosen;
  else if (models[0]) select.value = models[0].id;
  note.textContent = models.length + " available models loaded.";
}
get("save-key").addEventListener("click", async () => {
  const provider = get<HTMLSelectElement>("provider").value as ProviderId;
  const button = get<HTMLButtonElement>("save-key");
  button.disabled = true;
  try {
    await rpc({ type: "saveProviderKey", provider,
      key: get<HTMLInputElement>("api-key").value,
      remember: get<HTMLInputElement>("remember-key").checked });
    const state = providerStates.find((item) => item.provider === provider);
    if (state) { state.hasKey = true; state.remembered = get<HTMLInputElement>("remember-key").checked; }
    get<HTMLInputElement>("api-key").value = "";
    await loadModels();
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});
get("refresh-models").addEventListener("click", () => void loadModels().catch(showError));
get("forget-key").addEventListener("click", async () => {
  const provider = get<HTMLSelectElement>("provider").value as ProviderId;
  await rpc({ type: "forgetProviderKey", provider });
  const state = providerStates.find((item) => item.provider === provider);
  if (state) { state.hasKey = false; state.remembered = false; }
  updateProviderForm();
});
get<HTMLFormElement>("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = get<HTMLSelectElement>("provider").value as ProviderId;
  settings = await rpc<Settings>({ type: "saveSettings", settings: {
    provider,
    models: { [provider]: get<HTMLSelectElement>("model").value },
    nativeLanguage: get<HTMLSelectElement>("native-language").value,
    outputLanguage: get<HTMLSelectElement>("output-language").value,
    mode: get<HTMLSelectElement>("answer-mode").value,
    summaryStyle: get<HTMLSelectElement>("summary-style").value,
  }});
  get("settings-note").textContent = "Preferences saved.";
  setTimeout(() => get("settings-note").textContent = "", 2500);
  if (snapshot && activeContext) showWorkspace();
});

async function readAttachment(): Promise<Attachment | undefined> {
  const file = get<HTMLInputElement>("attachment").files?.[0];
  if (!file) return undefined;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 4_000_000)
    throw new Error("Attach a PNG, JPEG or WebP image under 4 MB.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  return { mimeType: file.type, name: file.name, data: dataUrl.split(",")[1] || "" };
}
async function generate(mode: string) {
  if (!snapshot || !activeContext) return;
  clearError();
  activeRequestId = crypto.randomUUID();
  get("progress").hidden = false;
  get("progress-title").textContent = mode === "solveAll" ? "Solving this page" : "DKP is thinking";
  get("progress-copy").textContent = "Retrieving relevant knowledge from " + activeContext.pages.length + " context pages.";
  document.querySelectorAll<HTMLButtonElement>(".tool,.solve-all,.send").forEach((button) => button.disabled = true);
  try {
    const result = await rpc<Result>({
      type: "generate", mode, snapshot, contextId: activeContext.id,
      question: get<HTMLTextAreaElement>("question").value.trim(),
      context: get<HTMLTextAreaElement>("extra-context").value.trim(),
      attachment: await readAttachment(), requestId: activeRequestId,
    });
    renderResult(result, mode);
    if (result.answers.length) await sendToPage({
      type: "annotate", result, fingerprint: snapshot.fingerprint,
    }).catch(() => {});
  } catch (error) { showError(error); }
  finally {
    activeRequestId = "";
    get("progress").hidden = true;
    document.querySelectorAll<HTMLButtonElement>(".tool,.solve-all,.send").forEach((button) => button.disabled = false);
    showWorkspace();
  }
}
function evidenceButton(ref: Result["answers"][number]["evidenceRefs"][number]) {
  const button = document.createElement("button");
  button.className = "evidence-card";
  const before = document.createElement("span"); before.className = "blur"; before.textContent = ref.before;
  const quote = document.createElement("span"); quote.className = "quote"; quote.textContent = "“" + ref.quote + "”";
  const after = document.createElement("span"); after.className = "blur"; after.textContent = ref.after;
  const source = document.createElement("span"); source.className = "source";
  source.textContent = (ref.pageTitle || "Current page") + " · Open source ↗";
  button.append(before, quote, after, source);
  button.onclick = () => void rpc({ type: "revealEvidence", evidence: ref, sourceTabId }).catch(showError);
  return button;
}
function renderResult(result: Result, mode: string) {
  const root = get("results");
  root.replaceChildren();
  if (result.summary) {
    const card = document.createElement("article"); card.className = "result-card";
    const top = document.createElement("div"); top.className = "result-top";
    const label = document.createElement("span"); label.className = "result-label";
    label.textContent = mode === "translate" ? "DKP · Translation" : "DKP · Summary";
    top.append(label);
    const answer = document.createElement("div"); answer.className = "answer"; answer.textContent = result.summary;
    const actions = document.createElement("div"); actions.className = "result-actions";
    const copy = document.createElement("button"); copy.className = "text-button"; copy.textContent = "Copy";
    copy.onclick = () => void navigator.clipboard.writeText(result.summary);
    actions.append(copy); card.append(top, answer, actions); root.append(card);
  }
  result.answers.forEach((item, index) => {
    const card = document.createElement("article"); card.className = "result-card";
    const top = document.createElement("div"); top.className = "result-top";
    const label = document.createElement("span"); label.className = "result-label";
    label.textContent = "Answer " + (index + 1);
    const badge = document.createElement("span"); badge.className = "result-badge";
    badge.textContent = item.confidence + " · " + item.evidence;
    top.append(label, badge); card.append(top);
    for (const warning of [...result.warnings, ...(item.missing ? [item.missing] : [])]) {
      const p = document.createElement("p"); p.className = "warning"; p.textContent = warning; card.append(p);
    }
    const question = document.createElement("h3"); question.textContent = item.question;
    const answer = document.createElement("div"); answer.className = "answer"; answer.textContent = item.answer;
    card.append(question, answer);
    const why = document.createElement("details"); why.className = "why";
    const summary = document.createElement("summary"); summary.textContent = "Why this answer";
    const explanation = document.createElement("p"); explanation.textContent = item.explanation;
    why.append(summary, explanation, ...item.evidenceRefs.map(evidenceButton));
    card.append(why);
    const actions = document.createElement("div"); actions.className = "result-actions";
    const copy = document.createElement("button"); copy.className = "text-button"; copy.textContent = "Copy";
    copy.onclick = () => void navigator.clipboard.writeText(item.answer);
    actions.append(copy); card.append(actions); root.append(card);
  });
}

get("ask").addEventListener("click", () => void generate("ask"));
get("cancel").addEventListener("click", () => {
  if (activeRequestId) void rpc({ type: "cancel", requestId: activeRequestId });
});

async function start() {
  try {
    await loadState();
    if (location.hash === "#settings") switchTab("settings");
    else if (sourceTabId) await scanPage();
    else { switchTab("contexts"); get("page-loading").hidden = true; }
  } catch (error) {
    get("page-loading").hidden = true;
    showError(error);
  }
}
void start();
