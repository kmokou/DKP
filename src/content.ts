import { extract, type Extraction } from "./extract";
import { hash, normalize, stringifyUnknown } from "./core";
import type { Answer, Result, SemanticMap, SemanticUnit, Snapshot, Task } from "./types";

const pageState = globalThis as typeof globalThis & { __dkpInstalled?: boolean };
if (!pageState.__dkpInstalled) { pageState.__dkpInstalled = true; install(); }

function install() {
  let current: Extraction = extract();
  let contextId = "";
  let activeMap: SemanticMap | undefined;
  const hosts = new Set<HTMLElement>();
  const jobs = new Set<string>();
  const css = ':host{all:initial;display:block;margin:12px 0 20px;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#17151f;font-size:14px;line-height:1.55;color-scheme:light}*{box-sizing:border-box}button{font:inherit;cursor:pointer}.trigger{border:1px solid #d9d0f0;border-radius:999px;padding:8px 14px;background:#faf8ff;color:#633dcc;font-weight:700;box-shadow:0 4px 14px #4f2ca00d}.trigger:hover{background:#f1ebff;border-color:#bba9eb}.trigger:disabled{opacity:.55}.summary-trigger{background:#17151f;color:white;border-color:#17151f}.solve-all{width:100%;border:0;border-radius:14px;padding:15px 18px;background:linear-gradient(115deg,#5e36d3,#7d5ae1);color:#fff;font-size:15px;font-weight:750;display:flex;justify-content:space-between;box-shadow:0 12px 30px #5e36d326}.card{max-width:820px;border:1px solid #e7e1ef;border-radius:16px;background:#fff;padding:17px;box-shadow:0 12px 32px #23153d0c}.card.summary{background:linear-gradient(145deg,#fff,#f7f2ff)}.top{display:flex;align-items:center;justify-content:space-between;gap:12px}.brand{font-size:11px;letter-spacing:.13em;text-transform:uppercase;font-weight:850;color:#6842c8}.badge{font-size:10px;border-radius:999px;background:#f1edf7;padding:4px 8px;color:#725e84}.body{white-space:pre-wrap;margin:13px 0;color:#25202e;font-size:15px}.warn{background:#fff6df;color:#7d5b22;padding:10px 12px;border-radius:9px;font-size:12px}.why{margin:13px 0}.why summary{cursor:pointer;font-weight:700;color:#5d4777}.why p{white-space:pre-wrap;color:#675d70}.evidence{display:block;width:100%;text-align:left;border:1px solid #e4dcf1;border-radius:12px;background:linear-gradient(#f8f4ff,#fff);padding:12px;margin:9px 0;color:#312a3b;overflow:hidden}.evidence:hover{border-color:#bda9e7}.evidence .fade{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#9990a3;filter:blur(1.8px);font-size:11px}.evidence .quote{display:block;font:600 12px/1.55 Georgia,serif;margin:5px 0}.evidence .source{display:block;font-size:9px;color:#7258a0;text-transform:uppercase;letter-spacing:.08em}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.actions button{border:1px solid #ded7e8;border-radius:9px;padding:8px 11px;background:#fff;color:#5f4778;font-weight:650}.actions .primary{background:#6942d3;color:#fff;border-color:#6942d3}.error{color:#a23e3e}.error-details pre{max-height:220px;overflow:auto;white-space:pre-wrap;background:#fff5f3;padding:10px;border-radius:9px;font:10px/1.5 ui-monospace,monospace}.filled{font-size:11px;color:#4f7148}';

  const makeHost = (anchor: HTMLElement, before = false) => {
    const node = document.createElement("div");
    node.className = "dkp-root";
    const shadow = node.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    shadow.append(style);
    before ? anchor.prepend(node) : anchor.after(node);
    hosts.add(node);
    return shadow;
  };
  const makeButton = (label: string, action: () => void, className = "trigger") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.onclick = action;
    return button;
  };
  const report = (reason: unknown) => {
    if (reason && typeof reason === "object" && "message" in reason) {
      const value = reason as any;
      return { title: typeof value.title === "string" ? value.title : "DKP error",
        message: String(value.message), details: value.details || {} };
    }
    return { title: "DKP error",
      message: reason instanceof Error ? reason.message : "Action failed.",
      details: { received: stringifyUnknown(reason) } };
  };
  const renderError = (shadow: ShadowRoot, reason: unknown) => {
    const value = report(reason);
    const wrap = document.createElement("div");
    wrap.className = "card";
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = value.title + ": " + value.message;
    const details = document.createElement("details");
    details.className = "error-details";
    const summary = document.createElement("summary");
    summary.textContent = "Technical details";
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify({ timestamp: new Date().toISOString(), ...value.details }, null, 2);
    details.append(summary, pre);
    wrap.append(p, details);
    shadow.append(wrap);
  };

  function rangeBlocks(snapshot: Snapshot, unit: SemanticUnit) {
    const start = snapshot.blocks.findIndex((block) => block.id === unit.startBlockId);
    const end = snapshot.blocks.findIndex((block) => block.id === unit.endBlockId);
    return start < 0 || end < start ? [] : snapshot.blocks.slice(start, end + 1);
  }
  function applyMap(map: SemanticMap): Snapshot {
    current = extract();
    const native = current.snapshot.tasks.filter((task) => task.kind === "moodle-task");
    const semanticTasks: Task[] = [];
    for (const unit of map.units) {
      if (unit.action !== "answer" && unit.action !== "solve") continue;
      const blocks = rangeBlocks(current.snapshot, unit);
      const existing = native.find((task) => blocks.some((block) => block.id === task.blockId));
      if (existing || !blocks.length) continue;
      const text = blocks.map((block) => block.text).join("\n");
      semanticTasks.push({
        id: "semantic-" + hash(unit.id + text),
        blockId: unit.startBlockId,
        text,
        kind: unit.action === "answer" ? "text-question" : "complex-task",
        choices: [],
        fields: [],
        dependency: /\b(?:watch|listen|video|audio)\b/i.test(text) ? "media"
          : /\b(?:document|pdf|linked (?:text|article))\b/i.test(text) ? "document" : "none",
      });
    }
    current.snapshot.tasks = [...native, ...semanticTasks];
    return current.snapshot;
  }
  function taskForUnit(unit: SemanticUnit): Task | undefined {
    const blocks = rangeBlocks(current.snapshot, unit);
    return current.snapshot.tasks.find((task) => blocks.some((block) => block.id === task.blockId));
  }
  function clearHosts() {
    for (const item of hosts) item.remove();
    hosts.clear();
  }
  function renderMap(map: SemanticMap) {
    clearHosts();
    applyMap(map);
    const actionable = map.units.filter((unit) => unit.action === "solve" || unit.action === "answer");
    if (actionable.length) {
      const root = document.querySelector<HTMLElement>('#region-main,[role="main"],main,article') || document.body;
      const shadow = makeHost(root, true);
      const button = makeButton("", () => void runAll(shadow, button), "solve-all");
      const count = actionable.length;
      button.textContent = "✦ Solve all page · " + count + " task" + (count === 1 ? "" : "s") + " →";
      shadow.append(button);
    }
    for (const unit of map.units) {
      if (unit.action === "none") continue;
      const anchor = current.anchors.get(unit.anchorBlockId);
      if (!anchor) continue;
      const shadow = makeHost(anchor);
      if (unit.action === "summary") {
        const button = makeButton("≋ Summarize this text",
          () => void runSummary(shadow, button), "trigger summary-trigger");
        shadow.append(button);
      } else {
        const task = taskForUnit(unit);
        if (!task) { hosts.forEach(() => {}); continue; }
        const label = unit.action === "solve" ? "✦ Solve task" : "✦ Generate answer";
        const button = makeButton(label, () => void runTask(task.id, shadow, button));
        shadow.append(button);
      }
    }
  }

  async function request(payload: Record<string, unknown>, shadow: ShadowRoot, button: HTMLButtonElement) {
    const requestId = crypto.randomUUID();
    jobs.add(requestId);
    const previous = button.textContent || "Try again";
    button.disabled = true;
    button.textContent = "DKP is thinking…";
    const cancel = makeButton("Cancel",
      () => void browser.runtime.sendMessage({ type: "cancel", requestId }));
    shadow.append(cancel);
    try {
      const response = await browser.runtime.sendMessage({
        ...payload, type: "generate", snapshot: current.snapshot, contextId, requestId,
      });
      if (!response?.ok) throw response?.error || new Error("No response from DKP.");
      if (extract().snapshot.fingerprint !== current.snapshot.fingerprint)
        throw new Error("The page changed. Generate again for the updated content.");
      button.remove();
      return response.data as Result;
    } catch (error) {
      renderError(shadow, error);
      button.disabled = false;
      button.textContent = previous;
      throw error;
    } finally {
      cancel.remove();
      jobs.delete(requestId);
    }
  }
  async function runTask(taskId: string, shadow: ShadowRoot, button: HTMLButtonElement) {
    try { renderAnswers(shadow, await request({ mode: "answer", taskId }, shadow, button), taskId); }
    catch {}
  }
  async function runSummary(shadow: ShadowRoot, button: HTMLButtonElement) {
    try { renderSummary(shadow, await request({ mode: "summary" }, shadow, button)); }
    catch {}
  }
  async function runAll(shadow: ShadowRoot, button: HTMLButtonElement) {
    try {
      const result = await request({ mode: "solveAll" }, shadow, button);
      renderAnswers(shadow, result);
      for (const answer of result.answers) fill(answer, undefined, true);
    } catch {}
  }
  function renderSummary(shadow: ShadowRoot, result: Result) {
    const card = document.createElement("div");
    card.className = "card summary";
    const top = document.createElement("div");
    top.className = "top";
    const brand = document.createElement("span");
    brand.className = "brand";
    brand.textContent = "DKP · Summary";
    top.append(brand);
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = result.summary;
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      makeButton("Copy", () => void navigator.clipboard.writeText(result.summary), ""),
      makeButton("Dismiss", () => card.remove(), ""),
    );
    card.append(top, body, actions);
    shadow.append(card);
  }
  function evidenceCard(ref: Answer["evidenceRefs"][number]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "evidence";
    const before = document.createElement("span");
    before.className = "fade";
    before.textContent = ref.before;
    const quote = document.createElement("span");
    quote.className = "quote";
    quote.textContent = "“" + ref.quote + "”";
    const after = document.createElement("span");
    after.className = "fade";
    after.textContent = ref.after;
    const source = document.createElement("span");
    source.className = "source";
    source.textContent = (ref.pageTitle || "Current page") + " · Open evidence ↗";
    button.append(before, quote, after, source);
    button.onclick = () => void browser.runtime.sendMessage({ type: "revealEvidence", evidence: ref });
    return button;
  }
  function renderAnswers(shadow: ShadowRoot, result: Result, taskId?: string) {
    for (const answer of result.answers.filter((item) => !taskId || item.id === taskId)) {
      const card = document.createElement("div");
      card.className = "card";
      const top = document.createElement("div");
      top.className = "top";
      const brand = document.createElement("span");
      brand.className = "brand";
      brand.textContent = "DKP · Answer";
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = answer.confidence + " confidence · " + answer.evidence;
      top.append(brand, badge);
      card.append(top);
      for (const warning of [...result.warnings, ...(answer.missing ? [answer.missing] : [])]) {
        const p = document.createElement("p");
        p.className = "warn";
        p.textContent = warning;
        card.append(p);
      }
      const body = document.createElement("div");
      body.className = "body";
      body.textContent = answer.answer;
      card.append(body);
      if (answer.explanation || answer.evidenceRefs.length) {
        const why = document.createElement("details");
        why.className = "why";
        const summary = document.createElement("summary");
        summary.textContent = "Why this answer";
        const explanation = document.createElement("p");
        explanation.textContent = answer.explanation;
        why.append(summary, explanation, ...answer.evidenceRefs.map(evidenceCard));
        card.append(why);
      }
      const actions = document.createElement("div");
      actions.className = "actions";
      const task = current.snapshot.tasks.find((item) => item.id === answer.id);
      if (answer.choiceIds.length || answer.fieldValues.length || task?.fields.length === 1) {
        const fillButton = makeButton("Fill answer", () => fill(answer, fillButton), "primary");
        actions.append(fillButton);
      }
      actions.append(
        makeButton("Copy", () => void navigator.clipboard.writeText(answer.answer), ""),
        makeButton("Dismiss", () => card.remove(), ""),
      );
      card.append(actions);
      shadow.append(card);
    }
  }
  function fill(answer: Answer, button?: HTMLButtonElement, onlyEmpty = false): boolean {
    if (extract().snapshot.fingerprint !== current.snapshot.fingerprint) {
      if (button) button.textContent = "Page changed";
      return false;
    }
    const undo: Array<() => void> = [];
    const event = (element: HTMLElement) => {
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const task = current.snapshot.tasks.find((item) => item.id === answer.id);
    for (const choice of task?.choices || []) {
      const control = current.controls.get(choice.id);
      if (control instanceof HTMLInputElement && !control.disabled) {
        const previous = control.checked;
        const next = answer.choiceIds.includes(choice.id);
        if (previous !== next) {
          undo.push(() => { control.checked = previous; event(control); });
          control.checked = next;
          event(control);
        }
      } else if (control instanceof HTMLOptionElement && answer.choiceIds.includes(choice.id)) {
        const select = control.closest("select");
        if (select && !select.disabled) {
          const previous = select.value;
          undo.push(() => { select.value = previous; event(select); });
          select.value = control.value;
          event(select);
        }
      }
    }
    const values = answer.fieldValues.length ? answer.fieldValues
      : task?.fields.length === 1 ? [{ fieldId: task.fields[0].id, value: answer.answer }] : [];
    for (const item of values) {
      const field = current.fields.get(item.fieldId);
      if (!field || field.disabled || field.readOnly || (onlyEmpty && field.value.trim())) continue;
      const previous = field.value;
      undo.push(() => { field.value = previous; event(field); });
      field.value = item.value;
      event(field);
    }
    if (!undo.length) return false;
    if (button) {
      const label = button.textContent || "Fill answer";
      button.textContent = "↶ Undo";
      button.onclick = () => {
        undo.reverse().forEach((action) => action());
        button.textContent = label;
        button.onclick = () => fill(answer, button);
      };
    }
    return true;
  }

  function highlight(evidence: { sourceId?: string; quote?: string }) {
    current = extract();
    let anchor = evidence.sourceId ? current.anchors.get(evidence.sourceId) : undefined;
    if (!anchor && evidence.quote) anchor = [...current.anchors.values()]
      .find((element) => normalize(element.textContent || "").includes(normalize(evidence.quote || "")));
    if (!anchor) return false;
    anchor.scrollIntoView({ behavior: "smooth", block: "center" });
    const previous = { background: anchor.style.background, transition: anchor.style.transition,
      boxShadow: anchor.style.boxShadow, borderRadius: anchor.style.borderRadius };
    anchor.style.transition = "background 1.5s ease, box-shadow 1.5s ease";
    anchor.style.background = "#fff1a8";
    anchor.style.boxShadow = "0 0 0 8px #fff1a855";
    anchor.style.borderRadius = "4px";
    setTimeout(() => {
      if (!anchor) return;
      anchor.style.background = previous.background;
      anchor.style.boxShadow = previous.boxShadow;
    }, 3500);
    setTimeout(() => { if (anchor) Object.assign(anchor.style, previous); }, 5000);
    return true;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === "scan") {
      if (activeMap) applyMap(activeMap);
      else current = extract();
      return Promise.resolve(current.snapshot);
    }
    if (message.type === "applySemanticMap") {
      contextId = message.contextId || "";
      activeMap = message.semanticMap as SemanticMap;
      renderMap(activeMap);
      return Promise.resolve(current.snapshot);
    }
    if (message.type === "annotate") {
      const result = message.result as Result;
      for (const answer of result.answers) {
        const anchor = current.anchors.get(answer.blockId);
        if (anchor) renderAnswers(makeHost(anchor), { ...result, answers: [answer] });
      }
      return Promise.resolve(true);
    }
    if (message.type === "highlightEvidence")
      return Promise.resolve(highlight(message.evidence || {}));
    if (message.type === "disable") {
      clearHosts();
      for (const id of jobs) void browser.runtime.sendMessage({ type: "cancel", requestId: id });
      return Promise.resolve(true);
    }
  });
}
