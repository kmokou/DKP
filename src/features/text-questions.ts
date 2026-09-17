import { normalize } from "../core";

const stageDirection =
  /^(?:[ivxlcdm]+[.)]?\s*)?(?:discuss with (?:a partner|your group)|work (?:in pairs|with a partner)|read the (?:text|article)|skim the (?:text|article)|watch the video|listen to the (?:audio|recording)|vocabulary|reading|discussion)\s*[:.]?$/i;
const interrogative =
  /(?:^|[.!:]\s+)(?:\d+[.)]\s*)?(?:what|why|how|which|who|where|when|whose|is|are|do|does|did|can|could|would|should|have|has)\b/i;
const answerableInstruction =
  /(?:^|[.!:]\s+)(?:\d+[.)]\s*)?(?:explain|compare|describe|define|identify|calculate|translate|complete|choose|match|write|list|give)\s+\S.{8,}[.!?]$/i;
const dependentInstruction =
  /^(?:\d+[.)]\s*)?(?:watch|listen to|read|study|review)\b.{0,120}\b(?:answer|explain|describe|identify|compare|write|list|give)\b/i;

export function isTextQuestion(text: string): boolean {
  const value = normalize(text);
  if (value.length < 14 || value.length > 3500 || stageDirection.test(value))
    return false;
  if (value.includes("?") && interrogative.test(value)) return true;
  if (interrogative.test(value) && /:$/.test(value)) return true;
  return answerableInstruction.test(value) || dependentInstruction.test(value);
}

export const TEXT_ANSWERS_OPERATION =
  "Answer every supplied task whose kind is text-question. These are questions embedded in lesson prose. Do not answer headings, stage directions, reading titles, or any text not present in the supplied tasks. Return one answer per supplied task and preserve each exact task id.";
