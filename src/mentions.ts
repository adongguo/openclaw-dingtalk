/**
 * DingTalk mentions adapter.
 *
 * DingTalk uses a special format for @mentions:
 * - The message body contains `@botName` followed by \u2005 (four-per-em space)
 * - The message header includes an `atUsers` array with dingtalkId/staffId
 */

// DingTalk uses \u2005 (FOUR-PER-EM SPACE) as separator after @mentions
const DINGTALK_AT_SEPARATOR = "\u2005";

/**
 * Build regex patterns that match DingTalk @mention text.
 * These are used by the core stripMentions pipeline to remove bot mention
 * tokens before the message reaches the agent.
 */
function stripPatterns(): string[] {
  // Match @<name> followed by optional \u2005 or regular spaces
  // DingTalk format: @BotName\u2005 or @BotName at end of string
  return [
    `@\\S+${DINGTALK_AT_SEPARATOR}`,  // @name followed by DingTalk's special space
    `@\\S+\\s`,                         // @name followed by regular whitespace
  ];
}

/**
 * Additional mention stripping specific to DingTalk.
 * Called after generic pattern-based stripping.
 */
function stripMentions({ text }: { text: string }): string {
  let result = text;

  // Remove any remaining @mentions followed by DingTalk's special space
  result = result.replace(new RegExp(`@[^${DINGTALK_AT_SEPARATOR}\\s]+${DINGTALK_AT_SEPARATOR}`, "g"), " ");

  // Clean up multiple spaces
  return result.replace(/\s+/g, " ").trim();
}

export const dingtalkMentions = {
  stripPatterns,
  stripMentions,
};
