import type { Message } from "@earendil-works/pi-ai";
import type { SubagentResult } from "../core/types.js";

export function processPiEvent(event: unknown, result: SubagentResult): boolean;
export function processPiJsonLine(line: string, result: SubagentResult): boolean;
export function getFinalAssistantText(messages: Message[]): string;
export function getForkProgressText(result: Partial<SubagentResult> | undefined): string;
export function getResultSummaryText(result: Partial<SubagentResult> | undefined): string;
