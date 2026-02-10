/**
 * CLI Commands for DingTalk
 *
 * Registers CLI subcommands under `openclaw dingtalk`.
 */

import type { Command } from "commander";

export type CliLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export type CliConfig = Record<string, unknown>;

/**
 * Register DingTalk CLI commands.
 */
export function registerDingTalkCli(params: {
  program: Command;
  config: CliConfig;
  logger: CliLogger;
}): void {
  const { program, config, logger } = params;

  const dingtalkCmd = program
    .command("dingtalk")
    .description("DingTalk channel management");

  // openclaw dingtalk status
  dingtalkCmd
    .command("status")
    .description("Show DingTalk connection status")
    .action(async () => {
      try {
        const { probeDingTalk } = await import("./probe.js");
        const { resolveDingTalkAccountConfig, listDingTalkAccountIds } = await import(
          "./accounts.js"
        );
        const { getActiveSessionCount } = await import("./session.js");

        const dingtalkCfg = (config as Record<string, unknown>).channels as
          | Record<string, unknown>
          | undefined;
        const dtCfg = dingtalkCfg?.dingtalk as Record<string, unknown> | undefined;

        const accountIds = listDingTalkAccountIds(config as never);
        if (accountIds.length === 0) {
          console.log("DingTalk: not configured");
          return;
        }

        for (const accountId of accountIds) {
          const resolved = resolveDingTalkAccountConfig(dtCfg as never, accountId);
          const probe = await probeDingTalk(resolved as never, accountId);
          const sessionCount = getActiveSessionCount();

          console.log(`\n=== DingTalk Account: ${accountId} ===`);
          console.log(`  Status: ${probe.ok ? "✅ Connected" : "❌ Error"}`);
          if (probe.appKey) console.log(`  App Key: ${probe.appKey.slice(0, 8)}...`);
          if (probe.robotCode) console.log(`  Robot Code: ${probe.robotCode}`);
          if (probe.error) console.log(`  Error: ${probe.error}`);
          console.log(`  Active Sessions: ${sessionCount}`);
        }
      } catch (err) {
        logger.error(
          `Failed to get status: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  // openclaw dingtalk send <target> <message>
  dingtalkCmd
    .command("send <target> <message>")
    .description("Send a message to a DingTalk user or group")
    .action(async (target: string, message: string) => {
      try {
        const { sendTextViaOpenAPI } = await import("./openapi-send.js");
        const { resolveDingTalkAccountConfig } = await import("./accounts.js");
        const { detectIdType } = await import("./targets.js");

        const dingtalkCfg = (config as Record<string, unknown>).channels as
          | Record<string, unknown>
          | undefined;
        const dtCfg = dingtalkCfg?.dingtalk as Record<string, unknown> | undefined;
        const resolved = resolveDingTalkAccountConfig(dtCfg as never);

        if (!resolved) {
          console.error("DingTalk is not configured.");
          process.exitCode = 1;
          return;
        }

        const idType = detectIdType(target);
        const sendTarget =
          idType === "chatId"
            ? { kind: "group" as const, id: target }
            : { kind: "user" as const, id: target };

        const result = await sendTextViaOpenAPI({
          config: resolved as never,
          target: sendTarget,
          content: message,
        });

        if (result?.processQueryKey) {
          console.log(`✅ Message sent (queryKey: ${result.processQueryKey})`);
        } else {
          console.log("✅ Message sent");
        }
      } catch (err) {
        logger.error(
          `Failed to send: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  // openclaw dingtalk groups
  dingtalkCmd
    .command("groups")
    .description("List known DingTalk groups")
    .action(async () => {
      try {
        const { listDingTalkDirectoryGroups } = await import("./directory.js");
        const groups = await listDingTalkDirectoryGroups({ cfg: config as never });

        if (groups.length === 0) {
          console.log("No known groups.");
          return;
        }

        console.log(`\nKnown DingTalk Groups (${groups.length}):\n`);
        for (const g of groups) {
          const name = g.name ? ` (${g.name})` : "";
          console.log(`  ${g.id}${name}`);
        }
      } catch (err) {
        logger.error(
          `Failed to list groups: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });
}
