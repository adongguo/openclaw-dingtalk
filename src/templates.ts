/**
 * Rich Message Templates for DingTalk
 *
 * Standardized, configurable message formats for common bot interactions.
 * Each template returns { text, useCard } to guide rendering mode.
 * Templates use config overrides when available, falling back to defaults.
 */

import type { DingTalkTemplates } from "./types.js";

// ============ Types ============

export type TemplateResult = {
  text: string;
  useCard: boolean;
};

// ============ Template Functions ============

export function thinkingTemplate(templates?: DingTalkTemplates): TemplateResult {
  const text = templates?.thinking?.text ?? "🤔 思考中...";
  return { text, useCard: false };
}

export function thinkingEnabled(templates?: DingTalkTemplates): boolean {
  return templates?.thinking?.enabled !== false;
}

export function accessDeniedTemplate(senderId: string, templates?: DingTalkTemplates): TemplateResult {
  const customText = templates?.accessDenied?.text;
  const text = customText
    ? customText.replace("{senderId}", senderId)
    : `⛔ 访问受限\n\n您的用户ID: \`${senderId}\`\n\n请联系管理员将此ID添加到允许列表中。`;
  return { text, useCard: false };
}

export function groupAccessDeniedTemplate(senderId: string, templates?: DingTalkTemplates): TemplateResult {
  const customText = templates?.groupAccessDenied?.text;
  const text = customText
    ? customText.replace("{senderId}", senderId)
    : `⛔ 群组访问受限\n\n您的用户ID: \`${senderId}\`\n\n请联系管理员将此ID添加到群组允许列表中。`;
  return { text, useCard: false };
}

export function newSessionTemplate(templates?: DingTalkTemplates): TemplateResult {
  const text = templates?.newSession?.text ?? "✨ 已开启新会话，之前的对话已清空。";
  return { text, useCard: false };
}

export function errorTemplate(message: string, templates?: DingTalkTemplates): TemplateResult {
  const customText = templates?.error?.text;
  const text = customText
    ? customText.replace("{message}", message)
    : `抱歉，处理请求时出错: ${message}`;
  return { text, useCard: false };
}

export function welcomeTemplate(
  senderName: string,
  commands: string[],
  templates?: DingTalkTemplates,
): TemplateResult {
  const title = templates?.welcome?.title ?? "AI Assistant";
  const customText = templates?.welcome?.text;

  if (customText) {
    const text = customText
      .replace("{senderName}", senderName)
      .replace("{commands}", commands.join("\n"));
    return { text, useCard: true };
  }

  const commandList = commands.length > 0
    ? `\n\n**可用命令:**\n${commands.map((c) => `- ${c}`).join("\n")}`
    : "";

  const text = [
    `**${title}**`,
    "",
    `你好，${senderName}！我是你的AI助手。`,
    "发送任何消息开始对话，或使用以下命令：",
    commandList,
  ].join("\n");

  return { text, useCard: true };
}

export function welcomeEnabled(templates?: DingTalkTemplates): boolean {
  return templates?.welcome?.enabled === true;
}

export function helpTemplate(
  builtinCommands: string[],
  userCommands: Array<{ name: string; description: string }>,
  templates?: DingTalkTemplates,
): TemplateResult {
  const title = templates?.welcome?.title ?? "AI Assistant";
  const lines: string[] = [
    `📋 **${title} - 可用命令**`,
    "",
    "**内置命令:**",
    ...builtinCommands.map((c) => `- ${c}`),
  ];

  if (userCommands.length > 0) {
    lines.push("", "**自定义命令:**");
    for (const cmd of userCommands) {
      lines.push(`- \`/${cmd.name}\` - ${cmd.description}`);
    }
  }

  return { text: lines.join("\n"), useCard: true };
}

export function statusTemplate(params: {
  senderId: string;
  sessionId?: string;
  lastActiveMin?: number;
  activeSessions: number;
}): TemplateResult {
  const { senderId, sessionId, lastActiveMin, activeSessions } = params;

  if (!sessionId) {
    return {
      text: [
        "📊 **会话状态**",
        "",
        `- 用户ID: \`${senderId}\``,
        "- 会话: 无活跃会话",
        `- 活跃会话总数: ${activeSessions}`,
      ].join("\n"),
      useCard: false,
    };
  }

  return {
    text: [
      "📊 **会话状态**",
      "",
      `- 用户ID: \`${senderId}\``,
      `- 会话ID: \`${sessionId}\``,
      `- 上次活跃: ${lastActiveMin ?? 0} 分钟前`,
      `- 活跃会话总数: ${activeSessions}`,
    ].join("\n"),
    useCard: false,
  };
}

export function whoamiTemplate(senderId: string, senderName: string): TemplateResult {
  return {
    text: [
      "👤 **用户信息**",
      "",
      `- 用户ID: \`${senderId}\``,
      `- 昵称: ${senderName}`,
    ].join("\n"),
    useCard: false,
  };
}
