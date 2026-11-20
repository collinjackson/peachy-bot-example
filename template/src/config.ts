// Settings come from the environment, so the same code runs on a laptop, in
// systemd or in Docker. See .env.example.

export interface Config {
  /** Where `peachy daemon` answers. */
  daemonUrl: string;
  /** The daemon's -token, if it has one. Sent as a bearer token. */
  token?: string;
  /** The {number} in the daemon's paths. The daemon doesn't check it; it
   * echoes it back on reactions to the bot's own posts. */
  account: string;
  /** "websocket" hears each message as it arrives; "poll" asks every
   * pollIntervalMs. A daemon in -mode json-rpc only takes "websocket". */
  receive: "websocket" | "poll";
  pollIntervalMs: number;
  /** What the bot calls itself in /help. */
  name: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const receive = env.PEACHY_RECEIVE ?? "websocket";
  if (receive !== "websocket" && receive !== "poll") {
    throw new Error(`PEACHY_RECEIVE is websocket or poll, not ${JSON.stringify(receive)}`);
  }
  return {
    daemonUrl: (env.PEACHY_DAEMON_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, ""),
    token: env.PEACHY_TOKEN || undefined,
    account: env.PEACHY_ACCOUNT || "bot",
    receive,
    pollIntervalMs: Number(env.PEACHY_POLL_MS ?? 1000),
    name: env.BOT_NAME || "Example Bot",
  };
}
