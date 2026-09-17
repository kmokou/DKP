import { hash, normalize } from "./core";
import type { Snapshot, Task, Block } from "./types";
import { isMoodleTaskElement } from "./features/task-solver";
export interface Extraction {
  snapshot: Snapshot;
  anchors: Map<string, HTMLElement>;
  controls: Map<string, HTMLInputElement | HTMLOptionElement>;
  fields: Map<string, HTMLInputElement | HTMLTextAreaElement>;
}
const excluded =
  'script,style,noscript,nav,header,footer,aside,[hidden],[aria-hidden="true"],.dkp-root,#page-header,#page-footer,.breadcrumb,.activity-navigation';
function readable(el: Element): boolean {
  if (el.closest(excluded)) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const style = getComputedStyle(n);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}
function textOf(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  const originals = Array.from(el.querySelectorAll("*"));
  const copies = Array.from(clone.querySelectorAll("*"));
  originals.forEach((n, i) => {
    if (!readable(n)) copies[i]?.remove();
  });
  clone
    .querySelectorAll(excluded + ",input,textarea,button")
    .forEach((n) => n.remove());
  return normalize(clone.textContent || "");
}
function textWithFieldMarkers(
  el: Element,
  writable: Array<HTMLInputElement | HTMLTextAreaElement>,
  fieldIds: string[],
): string {
  const clone = el.cloneNode(true) as Element;
  const originals = Array.from(el.querySelectorAll("*"));
  const copies = Array.from(clone.querySelectorAll("*"));
  originals.forEach((node, index) => {
    if (!readable(node)) copies[index]?.remove();
  });
  const originalInputs = Array.from(
    el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"],input[type="number"],input:not([type]),textarea',
    ),
  );
  const clonedInputs = Array.from(
    clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"],input[type="number"],input:not([type]),textarea',
    ),
  );
  writable.forEach((field, index) => {
    const cloneIndex = originalInputs.indexOf(field);
    clonedInputs[cloneIndex]?.replaceWith(
      document.createTextNode(` [FIELD ${fieldIds[index]}] `),
    );
  });
  clone
    .querySelectorAll(excluded + ",input,textarea,button")
    .forEach((n) => n.remove());
  return normalize(clone.textContent || "");
}
export function extract(doc: Document = document): Extraction {
  const root =
    doc.querySelector<HTMLElement>('#region-main,[role="main"],main,article') ||
    doc.body;
  const anchors = new Map<string, HTMLElement>();
  const controls = new Map<string, HTMLInputElement | HTMLOptionElement>();
  const fields = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  const blocks: Block[] = [];
  const tasks: Task[] = [];
  let total = 0;
  let truncated = false;
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      ".que,[data-questiontype],p,li,h1,h2,h3,h4,h5,table,pre,blockquote,div,img",
    ),
  ).filter((el) => readable(el));
  const accepted: HTMLElement[] = [];
  for (const el of candidates) {
    if (accepted.some((parent) => parent.contains(el))) continue;
    const isQuiz = isMoodleTaskElement(el);
    if (!isQuiz && el.closest(".que")) continue;
    if (el.tagName === "DIV" && !isQuiz) {
      if (el.querySelector("p,li,h1,h2,h3,h4,table,pre,blockquote,div,.que"))
        continue;
      if (
        !Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && normalize(n.textContent || "").length > 15,
        )
      )
        continue;
    }
    const text =
      el.tagName === "IMG"
        ? `[Image not read: ${(el as HTMLImageElement).alt || "no description"}. Attach this image in DKP to analyze it.]`
        : textOf(el);
    if (text.length < 8) continue;
    if (total + text.length > 120000 || blocks.length >= 1000) {
      truncated = true;
      continue;
    }
    const id = `b${blocks.length}-${hash(text)}`;
    blocks.push({ id, text, kind: isQuiz ? "quiz" : el.tagName.toLowerCase() });
    anchors.set(id, el);
    accepted.push(el);
    total += text.length;
    if (isQuiz) {
      const task: Task = {
        id: `q-${id}`,
        blockId: id,
        text,
        kind: "moodle-task",
        choices: [],
        fields: [],
      };
      el.querySelectorAll<HTMLInputElement | HTMLOptionElement>(
        'input[type="radio"],input[type="checkbox"],select option',
      ).forEach((input, i) => {
        if (
          input instanceof HTMLOptionElement &&
          (!input.value || input.disabled)
        )
          return;
        const label =
          input instanceof HTMLOptionElement
            ? input.textContent
            : input.labels?.[0]?.textContent ||
              input.closest("label")?.textContent ||
              input.parentElement?.textContent;
        const choice = { id: `${task.id}-c${i}`, text: normalize(label || "") };
        if (!choice.text) return;
        task.choices.push(choice);
        controls.set(choice.id, input);
      });
      const writable = el.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >('input[type="text"],input[type="number"],input:not([type]),textarea');
      const writableFields = Array.from(writable).filter(
        (field) => !field.disabled && !field.readOnly,
      );
      const fieldIds = writableFields.map((_, index) => `${task.id}-f${index}`);
      task.fields = fieldIds.map((fieldId, index) => ({
        id: fieldId,
        label: `Blank ${index + 1}`,
      }));
      writableFields.forEach((field, index) =>
        fields.set(fieldIds[index], field),
      );
      if (writableFields.length)
        task.text = textWithFieldMarkers(el, writableFields, fieldIds);
      tasks.push(task);
    }
  }
  const media = Array.from(
    root.querySelectorAll("video,audio,iframe,embed,object,a[href]"),
  )
    .filter(
      (el) =>
        readable(el) &&
        (el.tagName !== "A" ||
          /\.(pdf|docx?|mp4|mp3)(?:[?#]|$)|youtube|youtu\.be|vimeo|mod\/resource/.test(
            el.getAttribute("href") || "",
          )),
    )
    .slice(0, 30)
    .map((el) =>
      normalize(el.getAttribute("title") || el.textContent || el.tagName).slice(
        0,
        180,
      ),
    );
  if (
    /\b(?:watch|listen to)\b.{0,60}\b(?:video|audio|recording|clip)\b/i.test(
      blocks.map((b) => b.text).join(" "),
    ) &&
    !media.length
  )
    media.push("Referenced video or audio was not accessed");
  const selection = doc.getSelection()?.toString().trim().slice(0, 20000) || "";
  return {
    snapshot: {
      title: doc.title,
      url: location.origin + location.pathname,
      fingerprint: hash(JSON.stringify(blocks)),
      blocks,
      tasks,
      selection,
      media,
      truncated,
      words: blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0),
    },
    anchors,
    controls,
    fields,
  };
}
