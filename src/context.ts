import { hash, normalize } from "./core";
import type { Block, ContextPage, Snapshot, StudyContext } from "./types";

const stop = new Set("the a an and or but of to in on at for from with by is are was were be been it this that these those as into your you".split(" "));
function terms(text: string): Set<string> {
  return new Set(normalize(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter((x) => !stop.has(x)) || []);
}
function score(query: Set<string>, text: string): number {
  const words = terms(text);
  let n = 0;
  for (const word of query) if (words.has(word)) n++;
  return n / Math.max(3, Math.sqrt(words.size));
}

export function contextPage(snapshot: Snapshot, semanticMap?: ContextPage["semanticMap"]): ContextPage {
  const now = Date.now();
  let characters = 0;
  const blocks = snapshot.blocks.filter((block) => {
    if (characters + block.text.length > 60_000) return false;
    characters += block.text.length;
    return true;
  });
  return {
    id: `page-${hash(snapshot.url)}`,
    title: snapshot.title,
    url: snapshot.url,
    fingerprint: snapshot.fingerprint,
    addedAt: now,
    updatedAt: now,
    blocks: blocks.map((block) => ({ ...block })),
    semanticMap,
  };
}

export function upsertPage(context: StudyContext, page: ContextPage): StudyContext {
  const previous = context.pages.find((p) => p.id === page.id);
  const pages = context.pages.filter((p) => p.id !== page.id);
  pages.unshift({ ...page, addedAt: previous?.addedAt || page.addedAt });
  return { ...context, pages: pages.slice(0, 12), updatedAt: Date.now() };
}

export function retrieveContext(
  context: StudyContext | undefined,
  snapshot: Snapshot,
  taskText: string,
  limit = 24,
): Block[] {
  if (!context) return [];
  const query = terms(`${taskText} ${snapshot.title} ${snapshot.selection}`);
  const currentUrl = snapshot.url;
  return context.pages
    .flatMap((page) => page.blocks.map((block) => ({ page, block, score: score(query, block.text) })))
    .filter((item) => item.page.url !== currentUrl && item.block.text.length >= 30)
    .sort((a, b) => b.score - a.score || b.block.text.length - a.block.text.length)
    .slice(0, limit)
    .map(({ page, block }) => ({
      ...block,
      id: `ctx-${page.id}-${block.id}`,
      pageId: page.id,
      pageTitle: page.title,
      pageUrl: page.url,
    }));
}
