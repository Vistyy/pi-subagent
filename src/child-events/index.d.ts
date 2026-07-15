import type { Message } from "@earendil-works/pi-ai";
import type { ChildResult } from "../core/types.js";

export function processPiEvent(event: unknown, result: ChildResult): boolean;
export function processPiJsonLine(line: string, result: ChildResult): boolean;
export function getFinalAssistantText(messages: Message[]): string;
export function getChildProgressText(result: Partial<ChildResult> | undefined): string;
export function getResultSummaryText(result: Partial<ChildResult> | undefined): string;
