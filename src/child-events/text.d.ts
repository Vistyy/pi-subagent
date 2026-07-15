import type { Message } from "@earendil-works/pi-ai";
import type { ChildResult } from "../core/types.js";

export function getFinalAssistantText(messages: Message[] | undefined): string;
export function getResultSummaryText(result: Partial<ChildResult> | undefined): string;
