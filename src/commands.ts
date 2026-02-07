/**
 * Command System for DingTalk
 *
 * Extensible command registry supporting built-in + user-defined commands.
 * Built-in: /help, /status, /whoami
 * Session commands (/new, /reset, /clear, etc.) remain in session.ts
 * User-defined commands from config: reply, system-prompt, new-session
 */

import type { DingTalkConfig, DingTalkCommand } from "./types.js";
import { isNewSessionCommand, getSessionKey, getSessionInfo, getActiveSessionCount, DEFAULT_SESSION_TIMEOUT } from "./session.js";
import {
  newSessionTemplate,
  helpTemplate as renderHelpTemplate,
  statusTemplate as renderStatusTemplate,
  whoamiTemplate as renderWhoamiTemplate,
} from "./templates.js";

// ============ Types ============

interface Logger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

export type CommandResult = {
  handled: true;
  response: string;
  newSessionTriggered?: boolean;
} | {
  handled: false;
};

interface ExecuteCommandParams {
  text: string;
  config?: DingTalkConfig;
  senderId: string;
  senderName: string;
  sessionIdentifier: string;
  sessionTimeout?: number;
  log?: Logger;
}

// ============ Built-in Commands ============

/**
 * Try to execute a command from user input.
 * Returns { handled: true, response } if a command was matched and executed.
 * Returns { handled: false } if the message is not a command.
 */
export function executeCommand(params: ExecuteCommandParams): CommandResult {
  const { text, config, senderId, senderName, sessionIdentifier, sessionTimeout, log } = params;
  const trimmed = text.trim();

  // Commands must start with / or be a known session keyword
  if (!trimmed.startsWith("/") && !isNewSessionCommand(trimmed)) {
    return { handled: false };
  }

  // Session commands are handled first (backward compatibility)
  if (isNewSessionCommand(trimmed)) {
    const timeout = sessionTimeout ?? config?.sessionTimeout ?? DEFAULT_SESSION_TIMEOUT;
    getSessionKey(sessionIdentifier, true, timeout, log);
    const session = newSessionTemplate(config?.templates);
    return {
      handled: true,
      response: session.text,
      newSessionTriggered: true,
    };
  }

  const commandName = extractCommandName(trimmed);

  // Built-in commands
  switch (commandName) {
    case "help": {
      const help = buildHelpResponse(config);
      return { handled: true, response: help };
    }
    case "status": {
      const status = buildStatusResponse(senderId, sessionIdentifier);
      return { handled: true, response: status };
    }
    case "whoami": {
      const whoami = renderWhoamiTemplate(senderId, senderName);
      return { handled: true, response: whoami.text };
    }
  }

  // User-defined commands from config
  const userCommand = config?.commands?.[commandName];
  if (userCommand) {
    return executeUserCommand(commandName, userCommand, sessionIdentifier, sessionTimeout ?? config?.sessionTimeout, log);
  }

  return { handled: false };
}

// ============ Private Functions ============

function extractCommandName(text: string): string {
  const withoutSlash = text.slice(1);
  const spaceIdx = withoutSlash.indexOf(" ");
  return (spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)).toLowerCase();
}

function buildHelpResponse(config?: DingTalkConfig): string {
  const builtinCommands = [
    "`/help` - 显示可用命令列表",
    "`/status` - 显示会话状态信息",
    "`/whoami` - 显示您的用户ID",
    "`/new` `/reset` `/clear` - 开启新会话",
    "`新会话` `重新开始` `清空对话` - 开启新会话",
  ];

  const userCommands = config?.commands
    ? Object.entries(config.commands).map(([name, cmd]) => ({
        name,
        description: cmd.description ?? cmd.action,
      }))
    : [];

  const result = renderHelpTemplate(builtinCommands, userCommands, config?.templates);
  return result.text;
}

function buildStatusResponse(senderId: string, sessionIdentifier: string): string {
  const session = getSessionInfo(sessionIdentifier);
  const activeSessions = getActiveSessionCount();

  const elapsed = session ? Date.now() - session.lastActivity : undefined;
  const elapsedMin = elapsed !== undefined ? Math.round(elapsed / 60000) : undefined;

  const result = renderStatusTemplate({
    senderId,
    sessionId: session?.sessionId,
    lastActiveMin: elapsedMin,
    activeSessions,
  });
  return result.text;
}

function executeUserCommand(
  name: string,
  command: DingTalkCommand,
  sessionIdentifier: string,
  sessionTimeout?: number,
  log?: Logger,
): CommandResult {
  switch (command.action) {
    case "reply":
      return {
        handled: true,
        response: command.response ?? `(/${name} 未配置回复内容)`,
      };

    case "system-prompt":
      return {
        handled: true,
        response: command.response ?? `✅ 已切换到 ${name} 模式`,
      };

    case "new-session": {
      const timeout = sessionTimeout ?? DEFAULT_SESSION_TIMEOUT;
      getSessionKey(sessionIdentifier, true, timeout, log);
      return {
        handled: true,
        response: command.response ?? "✨ 已开启新会话，之前的对话已清空。",
        newSessionTriggered: true,
      };
    }

    default:
      return {
        handled: true,
        response: `⚠️ 未知的命令动作: ${command.action}`,
      };
  }
}
