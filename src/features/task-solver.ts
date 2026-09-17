export function isMoodleTaskElement(element: Element): boolean {
  return element.matches(".que,[data-questiontype]");
}

export const TASK_SOLVER_OPERATION =
  "Solve every supplied task whose kind is moodle-task. Use its exact choices, fields, and native question context. Return every blank separately in fieldValues using the exact supplied fieldId; never combine multiple blanks into one field value. Do not invent additional tasks. Return one answer per supplied task and preserve each exact task id. If an attached image contains a task, it may be returned with blockId=attachment.";
