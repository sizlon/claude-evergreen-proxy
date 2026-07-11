/**
 * Converts an Anthropic Messages API request into Claude CLI input.
 *
 * Mirrors openai-to-cli.ts but for the Anthropic `/v1/messages` shape: a
 * top-level `system` plus a `messages` array whose content is a string or an
 * array of text blocks. Model resolution is shared with the OpenAI path
 * (extractModel), so aliases and explicit versions pass straight to the CLI.
 */
import type { CliInput } from "./openai-to-cli.js";
import { extractModel } from "./openai-to-cli.js";

export interface AnthropicContentBlock {
  type: string;
  text?: string;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  max_tokens?: number;
  stream?: boolean;
  metadata?: { user_id?: string };
}

/** Extract text from an Anthropic content field (string or array of blocks). */
function blockText(content: string | AnthropicContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  return String(content ?? "");
}

/**
 * Build a single CLI prompt from an Anthropic request: `system` first, then the
 * message turns (assistant turns wrapped as prior context). The CLI runs in
 * --print mode with one prompt, so the conversation is flattened.
 */
export function anthropicToCli(request: AnthropicMessagesRequest): CliInput {
  const parts: string[] = [];
  const system = blockText(request.system);
  if (system.trim()) parts.push(`<system>\n${system}\n</system>\n`);

  for (const msg of request.messages) {
    const text = blockText(msg.content);
    if (msg.role === "assistant") {
      parts.push(`<previous_response>\n${text}\n</previous_response>\n`);
    } else {
      parts.push(text);
    }
  }

  return {
    prompt: parts.join("\n").trim(),
    model: extractModel(request.model),
    sessionId: request.metadata?.user_id,
  };
}
