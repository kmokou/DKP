export type ProviderId = "gemini" | "openai" | "anthropic" | "deepseek";

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface Block {
  id: string;
  text: string;
  kind: string;
  pageId?: string;
  pageTitle?: string;
  pageUrl?: string;
}
export interface Choice { id: string; text: string }
export interface TaskField { id: string; label: string }
export type TaskKind = "text-question" | "moodle-task" | "complex-task";
export interface Task {
  id: string;
  blockId: string;
  text: string;
  kind: TaskKind;
  choices: Choice[];
  fields: TaskField[];
  dependency?: "none" | "media" | "document" | "other-page";
}
export interface Snapshot {
  title: string;
  url: string;
  fingerprint: string;
  blocks: Block[];
  tasks: Task[];
  selection: string;
  media: string[];
  truncated: boolean;
  words: number;
}

export type UnitType = "topic" | "quiz" | "question" | "reference";
export type UnitAction = "summary" | "answer" | "solve" | "none";
export interface SemanticUnit {
  id: string;
  type: UnitType;
  startBlockId: string;
  endBlockId: string;
  anchorBlockId: string;
  action: UnitAction;
  reason: string;
}
export interface SemanticMap {
  fingerprint: string;
  pageType: "topic" | "quiz" | "mixed" | "reference";
  units: SemanticUnit[];
}

export type Evidence = "page" | "context" | "general" | "missing" | "personal";
export interface EvidenceRef {
  sourceId: string;
  quote: string;
  before: string;
  after: string;
  pageId?: string;
  pageTitle?: string;
  pageUrl?: string;
}
export interface Answer {
  id: string;
  blockId: string;
  question: string;
  answer: string;
  explanation: string;
  evidence: Evidence;
  quote: string;
  sourceId: string;
  evidenceRefs: EvidenceRef[];
  missing: string;
  confidence: "high" | "medium" | "low";
  strategy: "direct" | "structured" | "long-form" | "procedural" | "insufficient";
  choiceIds: string[];
  fieldValues: Array<{ fieldId: string; value: string }>;
}
export interface Result {
  answers: Answer[];
  summary: string;
  warnings: string[];
  tokens: number;
  cached?: boolean;
}

export interface Settings {
  provider: ProviderId;
  models: Partial<Record<ProviderId, string>>;
  nativeLanguage: string;
  outputLanguage: "native" | "original" | "bilingual";
  level: string;
  mode: string;
  summaryStyle: string;
}
export interface Attachment { mimeType: string; data: string; name: string }
export type GenerateMode =
  | "answer" | "textAnswers" | "tasks" | "solveAll"
  | "summary" | "translate" | "ask";
export interface GenerateRequest {
  type: "generate";
  mode: GenerateMode;
  snapshot: Snapshot;
  contextId?: string;
  taskId?: string;
  question?: string;
  context?: string;
  attachment?: Attachment;
  force?: boolean;
  requestId: string;
}

export interface ContextPage {
  id: string;
  title: string;
  url: string;
  fingerprint: string;
  addedAt: number;
  updatedAt: number;
  blocks: Block[];
  semanticMap?: SemanticMap;
}
export interface StudyContext {
  id: string;
  name: string;
  nativeLanguage: string;
  createdAt: number;
  updatedAt: number;
  pages: ContextPage[];
}
export interface ProviderState {
  provider: ProviderId;
  hasKey: boolean;
  remembered: boolean;
  model: string;
}

export const providerLabels: Record<ProviderId, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  deepseek: "DeepSeek",
};
export const defaults: Settings = {
  provider: "gemini",
  models: {
    gemini: "gemini-2.5-flash",
    openai: "gpt-4.1-mini",
    anthropic: "claude-sonnet-4-5",
    deepseek: "deepseek-chat",
  },
  nativeLanguage: "Русский",
  outputLanguage: "native",
  level: "Natural",
  mode: "Answer + explanation",
  summaryStyle: "Study notes",
};
