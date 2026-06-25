export function getFinalAssistantText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type === "text" && typeof part.text === "string" && part.text.length > 0) return part.text;
    }
  }
  return "";
}

export function getResultSummaryText(result) {
  const finalText = getFinalAssistantText(result?.messages);
  if (finalText) return finalText;
  if (typeof result?.errorMessage === "string" && result.errorMessage.trim()) return result.errorMessage.trim();
  const isError = (typeof result?.exitCode === "number" && result.exitCode > 0) || result?.stopReason === "error" || result?.stopReason === "aborted";
  if (isError && typeof result?.stderr === "string" && result.stderr.trim()) return result.stderr.trim();
  return "(no output)";
}
