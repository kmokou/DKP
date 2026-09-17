import { defaults, providerLabels, type GenerateRequest, type LlmLog, type ProviderId, type Result,
  type SemanticMap, type Settings, type Snapshot, type StudyContext } from "./types";
import { cacheInput, chunks, hash, responseSchema, semanticPrompt, semanticSchema,
  sourceText, stringifyUnknown, systemPrompt, validateResult, validateSemanticMap } from "./core";
import { contextPage, retrieveContext, upsertPage } from "./context";
import { providers } from "./providers";
import { parseJsonText, ProviderError } from "./providers/types";
import { summaryEndBlockId } from "./features/summary";

type ErrorDetail = { title: string; message: string; details: Record<string, unknown> };
const running = new Map<string, { controller: AbortController; owner: string }>();
let writeQueue: Promise<unknown> = Promise.resolve();
const serialWrite = (fn: () => Promise<unknown>) => {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
};

function redact(value: unknown): unknown {
  if (typeof value === "string") return value
    .replace(/AIza[\w-]{20,}/g, "[redacted API key]")
    .replace(/(?:Bearer|x-api-key)\s+\S+/gi, "[redacted credential]")
    .replace(/sk-[\w-]{16,}/g, "[redacted API key]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key, /key|token|secret|authorization/i.test(key) ? "[redacted]" : redact(child),
    ]),
  );
  return value;
}
function errorDetail(error: unknown): ErrorDetail {
  if (error instanceof ProviderError) return {
    title: `${providerLabels[error.provider]} request failed`,
    message: error.message,
    details: { provider: error.provider, endpoint: error.endpoint, httpStatus: error.status,
      response: redact(error.payload), timestamp: new Date().toISOString() },
  };
  if (error instanceof DOMException && error.name === "AbortError") return {
    title: "Request cancelled or timed out",
    message: "Generation stopped. You can try again.",
    details: { type: error.name, message: error.message, timestamp: new Date().toISOString() },
  };
  if (error instanceof Error) return {
    title: "DKP error", message: error.message,
    details: { type: error.name, message: error.message, stack: error.stack,
      timestamp: new Date().toISOString() },
  };
  return { title: "Unknown error", message: "Something went wrong.",
    details: { received: stringifyUnknown(error), timestamp: new Date().toISOString() } };
}

async function getSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get("settings")).settings || {};
  return { ...defaults, ...stored, models: { ...defaults.models, ...(stored.models || {}) } };
}
async function keyMap(area: typeof browser.storage.local | typeof browser.storage.session) {
  return ((await area.get("providerKeys")).providerKeys || {}) as Partial<Record<ProviderId, string>>;
}
async function getKey(provider: ProviderId): Promise<string> {
  return (await keyMap(browser.storage.session))[provider] ||
    (await keyMap(browser.storage.local))[provider] || "";
}
async function setKey(provider: ProviderId, key: string, remember: boolean) {
  const local = await keyMap(browser.storage.local);
  const session = await keyMap(browser.storage.session);
  delete local[provider]; delete session[provider];
  (remember ? local : session)[provider] = key;
  await browser.storage.local.set({ providerKeys: local });
  await browser.storage.session.set({ providerKeys: session });
}
async function forgetKey(provider: ProviderId) {
  const local = await keyMap(browser.storage.local);
  const session = await keyMap(browser.storage.session);
  delete local[provider]; delete session[provider];
  await browser.storage.local.set({ providerKeys: local });
  await browser.storage.session.set({ providerKeys: session });
}
async function getContexts(): Promise<StudyContext[]> {
  return ((await browser.storage.local.get("contexts")).contexts || []) as StudyContext[];
}
async function saveContexts(contexts: StudyContext[]) {
  await browser.storage.local.set({ contexts: contexts.slice(0, 12) });
}
const providerEndpoints: Record<ProviderId, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  deepseek: "https://api.deepseek.com/chat/completions",
};
async function appendLlmLog(log: LlmLog) {
  await serialWrite(async () => {
    const stored = ((await browser.storage.local.get("llmLogs")).llmLogs || []) as LlmLog[];
    stored.push(redact(log) as LlmLog);
    await browser.storage.local.set({ llmLogs: stored.slice(-160) });
  });
}

function fallbackSemanticMap(snapshot: Snapshot): SemanticMap {
  const units: SemanticMap["units"] = snapshot.tasks
    .filter((task) => task.kind === "moodle-task" || task.kind === "text-question")
    .map((task, index) => ({
      id: `native-${index}`, type: "quiz", startBlockId: task.blockId,
      endBlockId: task.blockId, anchorBlockId: task.blockId,
      action: task.kind === "text-question" ? "answer" : "solve",
      reason: task.kind === "text-question" ? "Prose question fallback" : "Native LMS question control",
    }));
  const end = snapshot.words >= 80 ? summaryEndBlockId(snapshot) : undefined;
  if (end) units.push({
    id: "reading", type: "topic", startBlockId: snapshot.blocks[0]?.id || end,
    endBlockId: end, anchorBlockId: end, action: "summary",
    reason: "Long reading region",
  });
  return {
    fingerprint: snapshot.fingerprint,
    pageType: units.some((u) => u.action === "solve") && end ? "mixed"
      : units.some((u) => u.action === "solve") ? "quiz" : end ? "topic" : "reference",
    units,
  };
}

async function classify(snapshot: Snapshot, force = false): Promise<SemanticMap> {
  const cacheKey = `semantic-${snapshot.fingerprint}`;
  const cache = (await browser.storage.session.get(cacheKey))[cacheKey] as SemanticMap | undefined;
  if (cache && !force) return cache;
  const settings = await getSettings();
  const key = await getKey(settings.provider);
  if (!key) return fallbackSemanticMap(snapshot);
  const model = settings.models[settings.provider];
  if (!model) return fallbackSemanticMap(snapshot);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const compact = snapshot.blocks.slice(0, 350).map((block) => ({
      id: block.id, kind: block.kind, text: block.text.slice(0, 1000),
      nativeTask: snapshot.tasks.some((task) => task.blockId === block.id && task.kind === "moodle-task"),
    }));
    const response = await providers[settings.provider].generate({
      apiKey: key, model, system: systemPrompt,
      prompt: `${semanticPrompt}\n\nPAGE:\n${JSON.stringify({ title: snapshot.title, blocks: compact })}`,
      schema: semanticSchema, signal: controller.signal,
    });
    await appendLlmLog({
      id: crypto.randomUUID(), timestamp: new Date().toISOString(), provider: settings.provider,
      model, operation: "semantic-map",
      endpoint: providerEndpoints[settings.provider],
      request: { system: systemPrompt, prompt: `${semanticPrompt}\n\nPAGE:\n${JSON.stringify({ title: snapshot.title, blocks: compact })}`, schema: semanticSchema },
      response: { text: response.text, tokens: response.tokens, requestId: response.requestId },
    });
    const result = validateSemanticMap(parseJsonText(response.text), snapshot);
    const safe = result.units.length ? result : fallbackSemanticMap(snapshot);
    await browser.storage.session.set({ [cacheKey]: safe });
    return safe;
  } catch (error) {
    await appendLlmLog({
      id: crypto.randomUUID(), timestamp: new Date().toISOString(), provider: settings.provider,
      model, operation: "semantic-map", endpoint: providerEndpoints[settings.provider],
      request: { system: systemPrompt, prompt: semanticPrompt, schema: semanticSchema },
      error: errorDetail(error),
    }).catch(() => {});
    return fallbackSemanticMap(snapshot);
  } finally { clearTimeout(timer); }
}

function operationFor(request: GenerateRequest, settings: Settings, tasks: Snapshot["tasks"]): string {
  const language = settings.outputLanguage === "original"
    ? "Keep all output in the source language."
    : settings.outputLanguage === "bilingual"
      ? `Give explanations and summaries in both the source language and ${settings.nativeLanguage}.`
      : `Write explanations and summaries in ${settings.nativeLanguage}. Keep form-ready answers in the task's source language.`;
  const common = `${language} Answer style: ${settings.mode}. Language level: ${settings.level}.`;
  switch (request.mode) {
    case "summary": return `Summarize only the supplied reading. Do not solve exercises. Style: ${settings.summaryStyle}. ${common}`;
    case "translate": return `Translate the supplied reading into ${settings.nativeLanguage}. Preserve meaning and structure. Return it in summary. ${common}`;
    case "answer": return `Answer only task ${request.taskId}. Preserve its exact ID. ${common}`;
    case "textAnswers": return `Answer every genuine prose question in tasks. Do not answer titles or directions. ${common}`;
    case "tasks": return `Solve every native or complex task in tasks. Return fieldValues and choiceIds using exact IDs. ${common}`;
    case "solveAll": return `Solve every supplied task on this page. Give direct values for supported controls and a structured answer or procedure for unusual tasks. ${common}`;
    case "ask": return `Answer userQuestion from the supplied page and context evidence. ${common}`;
  }
}

async function generate(request: GenerateRequest, owner: string): Promise<Result> {
  if (!request.snapshot || !Array.isArray(request.snapshot.blocks) ||
      JSON.stringify(request).length > 6_500_000)
    throw new Error("This page or attachment is too large. Select a smaller section.");
  if (running.size >= 3) throw new Error("Three requests are already running.");
  if (running.has(request.requestId)) throw new Error("This request is already running.");
  const settings = await getSettings();
  const key = await getKey(settings.provider);
  if (!key) throw new Error(`Add your ${providerLabels[settings.provider]} API key in Settings.`);
  const model = settings.models[settings.provider];
  if (!model) throw new Error("Select a model in Settings.");
  const tasks = request.mode === "answer"
    ? request.snapshot.tasks.filter((task) => task.id === request.taskId)
    : request.mode === "textAnswers"
      ? request.snapshot.tasks.filter((task) => task.kind === "text-question")
      : request.mode === "tasks"
        ? request.snapshot.tasks.filter((task) => task.kind !== "text-question")
        : request.mode === "solveAll" ? request.snapshot.tasks : [];
  if (["answer", "textAnswers", "tasks", "solveAll"].includes(request.mode) && !tasks.length)
    throw new Error("No complete, answerable tasks were found for this action.");
  const contexts = await getContexts();
  const context = contexts.find((item) => item.id === request.contextId);
  const taskText = [request.question, request.context, ...tasks.map((task) => task.text)].filter(Boolean).join(" ");
  const contextBlocks = retrieveContext(context, request.snapshot, taskText);
  const snapshot: Snapshot = {
    ...structuredClone(request.snapshot),
    blocks: [...request.snapshot.blocks, ...contextBlocks],
    tasks,
  };
  const { requestId, force, ...cacheable } = request;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
    cacheInput({ ...cacheable, snapshot, attachment: request.attachment?.name }, settings)));
  const cacheKey = Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
  const cache = (await browser.storage.session.get("resultCache")).resultCache || {};
  if (!force && cache[cacheKey]) return { ...cache[cacheKey], cached: true };
  const controller = new AbortController();
  running.set(requestId, { controller, owner });
  const timer = setTimeout(() => controller.abort(), 180000);
  let tokens = 0;
  const call = async (operation: string, content: string): Promise<Result> => {
    const prompt = JSON.stringify({
      operation, preferences: settings, title: snapshot.title,
      source: content, tasks, taskId: request.taskId,
      userQuestion: request.question || "", userAddedContext: request.context || "",
      unavailableMaterial: snapshot.media,
      instruction: "Warnings about unavailable material are allowed only when a supplied task explicitly depends on it.",
    });
    let response;
    try {
      response = await providers[settings.provider].generate({
        apiKey: key, model, system: systemPrompt, prompt, schema: responseSchema,
        image: request.attachment ? { mimeType: request.attachment.mimeType, data: request.attachment.data } : undefined,
        signal: controller.signal,
      });
      await appendLlmLog({
        id: crypto.randomUUID(), contextId: request.contextId, timestamp: new Date().toISOString(),
        provider: settings.provider, model, operation, endpoint: providerEndpoints[settings.provider],
        request: { system: systemPrompt, prompt, schema: responseSchema,
          image: request.attachment ? { mimeType: request.attachment.mimeType, data: request.attachment.data } : undefined },
        response: { text: response.text, tokens: response.tokens, requestId: response.requestId },
      });
    } catch (error) {
      await appendLlmLog({
        id: crypto.randomUUID(), contextId: request.contextId, timestamp: new Date().toISOString(),
        provider: settings.provider, model, operation, endpoint: providerEndpoints[settings.provider],
        request: { system: systemPrompt, prompt, schema: responseSchema,
          image: request.attachment ? { mimeType: request.attachment.mimeType, data: request.attachment.data } : undefined },
        error: errorDetail(error),
      }).catch(() => {});
      throw error;
    }
    if (!response.text) throw new Error("The AI provider returned no content.");
    tokens += response.tokens;
    const result = validateResult(parseJsonText(response.text), snapshot);
    result.tokens = tokens;
    return result;
  };
  try {
    const operation = operationFor(request, settings, tasks);
    const text = sourceText(snapshot);
    let result: Result;
    if ((request.mode === "summary" || request.mode === "translate") && text.length > 20_000) {
      const partial: string[] = [];
      const sections = chunks(text);
      for (let index = 0; index < sections.length; index++) {
        const item = await call(`${operation} Process section ${index + 1}/${sections.length}.`, sections[index]);
        partial.push(item.summary);
      }
      result = await call(`Combine the section results into one coherent result. ${operation}`, partial.join("\n\n"));
    } else result = await call(operation, text.slice(0, 100_000));
    if (request.mode === "summary" || request.mode === "translate") {
      if (!result.summary.trim()) throw new Error("The provider returned an empty text result.");
      result.answers = [];
    } else {
      if (tasks.length) {
        const allowed = new Set(tasks.map((task) => task.id));
        result.answers = result.answers.filter((answer) => allowed.has(answer.id));
      }
      if (!result.answers.length) throw new Error(
        tasks.length ? "The response could not be matched to the requested task." : "No answer was returned.",
      );
    }
    if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    await serialWrite(async () => {
      const current = (await browser.storage.session.get("resultCache")).resultCache || {};
      current[cacheKey] = result;
      await browser.storage.session.set({ resultCache: Object.fromEntries(Object.entries(current).slice(-40)) });
    });
    return result;
  } finally {
    clearTimeout(timer); running.delete(requestId);
  }
}

async function ensureContent(tabId: number) {
  const tab = await browser.tabs.get(tabId);
  if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new Error("Open a web lesson or exercise first.");
  await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
  return tab;
}
async function revealEvidence(evidence: { pageUrl?: string; sourceId?: string; quote?: string }, sourceTab?: number) {
  let tabId = sourceTab;
  if (evidence.pageUrl) {
    const tabs = await browser.tabs.query({});
    const found = tabs.find((tab) => tab.id && tab.url &&
      tab.url.split("#")[0].split("?")[0] === evidence.pageUrl!.split("#")[0].split("?")[0]);
    if (found?.id) tabId = found.id;
    else {
      const created = await browser.tabs.create({ url: evidence.pageUrl, active: true });
      tabId = created.id;
      if (tabId) await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { browser.tabs.onUpdated.removeListener(listener); resolve(); }, 12000);
        const listener = (id: number, info: { status?: string }) => {
          if (id === tabId && info.status === "complete") {
            clearTimeout(timeout); browser.tabs.onUpdated.removeListener(listener); resolve();
          }
        };
        browser.tabs.onUpdated.addListener(listener);
      });
    }
  }
  if (!tabId) throw new Error("The source page is not available.");
  await ensureContent(tabId);
  await browser.tabs.update(tabId, { active: true });
  return browser.tabs.sendMessage(tabId, { type: "highlightEvidence", evidence });
}

browser.runtime.onMessage.addListener((message, sender) => {
  const extensionUrl = browser.runtime.getURL("");
  const ui = sender.id === browser.runtime.id &&
    (sender.url?.startsWith(extensionUrl) || sender.url?.startsWith(browser.runtime.getURL("sidebar.html")));
  const owner = ui ? "ui" : `tab:${sender.tab?.id || "unknown"}`;
  const handle = async () => {
    if (message.type === "generate") return generate(message, owner);
    if (message.type === "cancel") {
      const job = running.get(message.requestId);
      if (job?.owner === owner) job.controller.abort();
      return true;
    }
    if (message.type === "revealEvidence")
      return revealEvidence(message.evidence || {}, ui ? message.sourceTabId : sender.tab?.id);
    if (!ui) throw new Error("This action is only available in DKP.");
    switch (message.type) {
      case "openWorkspace": {
        if (typeof message.sourceTabId !== "number") throw new Error("Open DKP from a lesson tab.");
        await ensureContent(message.sourceTabId);
        const contextQuery = typeof message.contextId === "string" && message.contextId
          ? `&contextId=${encodeURIComponent(message.contextId)}` : "";
        await browser.tabs.create({ url: browser.runtime.getURL(`sidebar.html?tabId=${message.sourceTabId}${contextQuery}`) });
        return true;
      }
      case "ensurePage": {
        if (typeof message.tabId !== "number") throw new Error("The lesson tab is unavailable.");
        await ensureContent(message.tabId);
        return true;
      }
      case "state": {
        const settings = await getSettings();
        const local = await keyMap(browser.storage.local);
        const session = await keyMap(browser.storage.session);
        return {
          settings, contexts: await getContexts(),
          providerStates: (Object.keys(providers) as ProviderId[]).map((provider) => ({
            provider, hasKey: !!(local[provider] || session[provider]),
            remembered: !!local[provider], model: settings.models[provider] || "",
          })),
        };
      }
      case "devtoolsLogs": {
        const logs = ((await browser.storage.local.get("llmLogs")).llmLogs || []) as LlmLog[];
        return logs.filter((log) => !message.contextId || log.contextId === message.contextId);
      }
      case "clearDevtoolsLogs": {
        const logs = ((await browser.storage.local.get("llmLogs")).llmLogs || []) as LlmLog[];
        await browser.storage.local.set({ llmLogs: message.contextId
          ? logs.filter((log) => log.contextId !== message.contextId)
          : [] });
        return true;
      }
      case "saveSettings": {
        const current = await getSettings();
        const next = { ...current, ...message.settings,
          models: { ...current.models, ...(message.settings?.models || {}) } };
        await browser.storage.local.set({ settings: next });
        return next;
      }
      case "saveProviderKey": {
        const provider = message.provider as ProviderId;
        if (!providers[provider]) throw new Error("Choose a supported AI provider.");
        if (typeof message.key !== "string" || message.key.trim().length < 10)
          throw new Error("Enter a valid API key.");
        await setKey(provider, message.key.trim(), !!message.remember);
        return true;
      }
      case "forgetProviderKey":
        await forgetKey(message.provider);
        return true;
      case "listModels": {
        const provider = message.provider as ProviderId;
        const key = await getKey(provider);
        if (!key) throw new Error(`Save your ${providerLabels[provider]} API key first.`);
        return providers[provider].listModels(key, AbortSignal.timeout(25000));
      }
      case "classify":
        return classify(message.snapshot, !!message.force);
      case "createContext": {
        const name = String(message.name || "").trim().slice(0, 80);
        if (!name) throw new Error("Give this context a name.");
        const settings = await getSettings();
        const now = Date.now();
        const context: StudyContext = {
          id: crypto.randomUUID(), name, nativeLanguage: settings.nativeLanguage,
          createdAt: now, updatedAt: now, pages: [],
        };
        await saveContexts([context, ...(await getContexts())]);
        return context;
      }
      case "deleteContext":
        await saveContexts((await getContexts()).filter((context) => context.id !== message.contextId));
        return true;
      case "addContextPage": {
        const contexts = await getContexts();
        const index = contexts.findIndex((context) => context.id === message.contextId);
        if (index < 0) throw new Error("Choose a valid context.");
        const semanticMap = message.semanticMap || await classify(message.snapshot);
        contexts[index] = upsertPage(contexts[index], contextPage(message.snapshot, semanticMap));
        await saveContexts(contexts);
        return { context: contexts[index], semanticMap };
      }
      case "removeContextPage": {
        const contexts = await getContexts();
        const context = contexts.find((item) => item.id === message.contextId);
        if (context) {
          context.pages = context.pages.filter((page) => page.id !== message.pageId);
          context.updatedAt = Date.now();
          await saveContexts(contexts);
        }
        return true;
      }
      case "revealEvidence":
        return revealEvidence(message.evidence || {}, message.sourceTabId);
      default: throw new Error("Unknown DKP action.");
    }
  };
  return handle().then((data) => ({ ok: true, data }))
    .catch((error) => ({ ok: false, error: errorDetail(error) }));
});

// Remove data keys that are not part of the DKP context architecture.
void browser.storage.local.remove(["sites", "history", "usage", "key"]);
void browser.storage.session.remove(["cache", "key"]);
