import type { Snapshot } from "../types";

export const SUMMARY_OPERATION =
  "Summarize only the supplied reading text. Do not answer questions or solve tasks. Return the result in summary and return an empty answers array.";

export const COMBINE_SUMMARIES_OPERATION =
  "Combine these section summaries into one coherent summary of the current extracted page. Do not answer questions and do not invent omitted information.";

const readingCue =
  /\b(?:read|skim|study|review)\b.{0,80}\b(?:article|text|reading|passage)\b/i;
const exerciseBoundary =
  /^(?:[ivxlcdm]+|\d+)[.)]?\s+(?:scan|answer|discuss|complete|choose|match|decide|questions?|exercise|task|practice)\b/i;

export function summaryEndBlockId(snapshot: Snapshot): string | undefined {
  const taskBlocks = new Set(snapshot.tasks.map((task) => task.blockId));
  const cueIndex = snapshot.blocks.findIndex((block) =>
    readingCue.test(block.text),
  );
  const start = cueIndex >= 0 ? cueIndex + 1 : 0;
  let readingCharacters = 0;
  let previousContent = -1;
  for (let index = start; index < snapshot.blocks.length; index++) {
    const block = snapshot.blocks[index];
    if (
      readingCharacters >= 400 &&
      exerciseBoundary.test(block.text) &&
      previousContent >= 0
    )
      return snapshot.blocks[previousContent].id;
    readingCharacters += block.text.length;
    if (!taskBlocks.has(block.id) && block.text.length >= 35)
      previousContent = index;
  }
  const fallback = [...snapshot.blocks]
    .reverse()
    .find(
      (block) =>
        !taskBlocks.has(block.id) &&
        /^(?:p|blockquote|table|div)$/.test(block.kind) &&
        block.text.length >= 160,
    );
  return fallback?.id || snapshot.blocks.at(-1)?.id;
}
