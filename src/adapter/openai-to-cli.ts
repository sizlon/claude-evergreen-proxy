/**
 * Converts OpenAI chat request format to Claude CLI input
 */

import type { OpenAIChatRequest, OpenAIContentBlock } from "../types/openai.js";

// Bare CLI aliases ("opus"/"sonnet"/"haiku") plus explicit versioned model ids
// (e.g. "claude-sonnet-5"). Kept as string so callers can pin an exact version
// instead of riding a drifting bare alias.
export type ClaudeModel = string;

export interface CliInput {
  prompt: string;
  model: ClaudeModel;
  sessionId?: string;
}

const MODEL_MAP: Record<string, ClaudeModel> = {
  // Bare aliases → the CLI resolves each to the current model in its family.
  // Versioned ids (claude-sonnet-5, claude-opus-4-8, …) are intentionally NOT
  // listed here: extractModel passes them through verbatim so callers pin an
  // exact version instead of a drifting alias.
  "opus": "opus",
  "sonnet": "sonnet",
  "haiku": "haiku",
  "fable": "claude-fable-5",
  "opus-max": "opus",
  "sonnet-max": "sonnet",
};

/**
 * Extract Claude model alias from request model string
 */
export function extractModel(model: string): ClaudeModel {
  // Try direct lookup
  if (MODEL_MAP[model]) {
    return MODEL_MAP[model];
  }

  // Try stripping provider prefix
  const stripped = model.replace(/^(?:claude-code-cli|claude-max)\//, "");
  if (MODEL_MAP[stripped]) {
    return MODEL_MAP[stripped];
  }

  // Pass any explicit versioned Claude model id — `claude-<family>-<version>`,
  // e.g. claude-sonnet-5, claude-opus-4-8, claude-fable-5 — straight through to
  // the CLI so callers pin an exact version instead of a drifting alias. The CLI
  // validates the id and errors on unknown ones.
  if (/^claude-[a-z]+-[\w.-]+$/.test(stripped)) {
    return stripped;
  }

  // Fallback: strongest available model. Logged so a typo'd/unknown id is visible
  // instead of silently running Opus.
  console.error(`[claude-max-api-proxy] unknown model "${model}" — falling back to opus`);
  return "opus";
}

/**
 * Extract text from a content field that may be a string or array of content blocks.
 * OpenAI API allows content as either:
 *   - A plain string: "Hello"
 *   - An array of content blocks: [{"type": "text", "text": "Hello"}]
 */
function extractText(content: string | OpenAIContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === "text" || block.type === "input_text")
      .map((block) => block.text)
      .join("\n");
  }
  return String(content || "");
}

/**
 * Strip OpenClaw-specific tooling sections from system prompts.
 * These reference tools (exec, process, web_search, etc.) that don't exist
 * in the Claude Code CLI environment, causing the model to get confused.
 * We remove: ## Tooling, ## Tool Call Style, ## OpenClaw CLI Quick Reference,
 * ## OpenClaw Self-Update
 */
function stripOpenClawTooling(text: string): string {
  const sectionsToStrip = [
    "## Tooling",
    "## Tool Call Style",
    "## OpenClaw CLI Quick Reference",
    "## OpenClaw Self-Update",
  ];
  let result = text;
  for (const section of sectionsToStrip) {
    // Match from section header to the next ## header (or end of string)
    const pattern = new RegExp(
      section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "\\n[\\s\\S]*?(?=\\n## |$)",
      "g"
    );
    result = result.replace(pattern, "");
  }
  // Clean up excessive blank lines left behind
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

/**
 * Convert OpenAI messages array to a single prompt string for Claude CLI
 *
 * Claude Code CLI in --print mode expects a single prompt, not a conversation.
 * We format the messages into a readable format that preserves context.
 */
export function messagesToPrompt(
  messages: OpenAIChatRequest["messages"]
): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const text = extractText(msg.content);
    switch (msg.role) {
      case "system":
        // System messages become context instructions
        // Strip OpenClaw tooling sections that conflict with Claude Code's native tools
        parts.push(`<system>\n${stripOpenClawTooling(text)}\n</system>\n`);
        break;

      case "user":
        // User messages are the main prompt
        parts.push(text);
        break;

      case "assistant":
        // Previous assistant responses for context
        parts.push(`<previous_response>\n${text}\n</previous_response>\n`);
        break;
    }
  }

  return parts.join("\n").trim();
}

/**
 * Convert OpenAI chat request to CLI input format
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  return {
    prompt: messagesToPrompt(request.messages),
    model: extractModel(request.model),
    sessionId: request.user, // Use OpenAI's user field for session mapping
  };
}
