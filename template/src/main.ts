// Starts the bot: node src/main.ts

import { fileURLToPath } from "node:url";
import { Bot } from "./bot.ts";
import { loadConfig, type Config } from "./config.ts";
import { DaemonClient, receiveForever } from "./daemon.ts";

/** Runs the bot until signal aborts. */
export async function run(config: Config, signal: AbortSignal): Promise<void> {
  const daemon = new DaemonClient(config);
  const bot = new Bot(daemon, config.name);
  try {
    const groups = await daemon.groups();
    console.log(`${config.name}: daemon at ${config.daemonUrl}, in ${groups.length} group chat(s)`);
  } catch (err) {
    console.error(`${config.name}: can't reach the daemon yet (${(err as Error).message}); will keep trying`);
  }
  await receiveForever(
    daemon,
    async (e) => {
      try {
        await bot.handle(e);
      } catch (err) {
        console.error("handling a message failed:", err);
      }
    },
    signal,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stop = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => stop.abort());
  await run(loadConfig(), stop.signal);
}
