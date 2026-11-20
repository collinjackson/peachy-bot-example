// A small client for the HTTP API `peachy daemon` answers (the same API as
// signal-cli-rest-api). It uses Node's built-in fetch and WebSocket.

import { setTimeout as sleep } from "node:timers/promises";
import type { Config } from "./config.ts";

/** One thing that arrived: a message or a reaction. */
export interface Envelope {
  /** The sender's Peachy id. Peachy never shares phone numbers, so
   * sourceNumber is always empty. */
  sourceUuid: string;
  sourceName?: string;
  timestamp: number;
  dataMessage?: DataMessage;
}

export interface DataMessage {
  /** Names this message for replies and reactions. */
  timestamp: number;
  message: string | null;
  /** Present in group chats. */
  groupInfo?: { groupId: string; groupName?: string };
  /** Where each @handle in `message` is, in UTF-16 units (JS string indexes). */
  mentions?: { uuid: string; name: string; start: number; length: number }[];
  /** Set when this message replies to another. */
  quote?: { id: number; authorUuid: string };
  /** Set (and `message` null) when this is a reaction. */
  reaction?: {
    emoji: string;
    targetAuthorUuid: string;
    targetSentTimestamp: number;
    isRemove: boolean;
  };
  attachments?: { contentType: string; filename: string; size: number }[];
  /** The chat's disappearing-message timer; 0 when off. */
  expiresInSeconds?: number;
}

/** A mention in something the bot sends: `start` and `length` cover the
 * text the daemon replaces with the person's @handle. */
export interface Mention {
  author: string;
  start: number;
  length: number;
}

export interface SendOptions {
  /** Reply to this message (its dataMessage.timestamp). */
  replyTo?: number;
  mentions?: Mention[];
  /** Photos or files, as data:<mime>;filename=<name>;base64,<data> or plain base64. */
  attachments?: string[];
}

export interface Group {
  name: string;
  /** Send to this. */
  id: string;
  members: string[];
}

export class DaemonClient {
  config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private get accountPath(): string {
    return encodeURIComponent(this.config.account);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.token) h.Authorization = `Bearer ${this.config.token}`;
    return h;
  }

  private async call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    const res = await fetch(this.config.daemonUrl + path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new Error(`${method} ${path}: ${res.status} ${data?.error ?? text}`);
    }
    return data;
  }

  about(): Promise<{ mode: string; version: string }> {
    return this.call("GET", "/v1/about");
  }

  groups(): Promise<Group[]> {
    return this.call("GET", `/v1/groups/${this.accountPath}`);
  }

  /** Sends to a chat (see chatOf) and returns the new message's timestamp,
   * which replies and reactions to it use. */
  async send(chat: string, message: string, opts: SendOptions = {}): Promise<number> {
    const res = await this.call("POST", "/v2/send", {
      number: this.config.account,
      recipients: [chat],
      message,
      quote_timestamp: opts.replyTo,
      mentions: opts.mentions,
      base64_attachments: opts.attachments,
    });
    return Number(res.timestamp);
  }

  /** Reacts with one emoji. A new reaction replaces the bot's old one. */
  react(chat: string, target: { author: string; timestamp: number }, emoji: string): Promise<void> {
    return this.call("POST", `/v1/reactions/${this.accountPath}`, {
      reaction: emoji,
      recipient: chat,
      target_author: target.author,
      timestamp: target.timestamp,
    });
  }

  unreact(chat: string, target: { author: string; timestamp: number }): Promise<void> {
    return this.call("DELETE", `/v1/reactions/${this.accountPath}`, {
      reaction: "",
      recipient: chat,
      target_author: target.author,
      timestamp: target.timestamp,
    });
  }

  /** Polling: what arrived since the last call. */
  async receive(signal?: AbortSignal): Promise<Envelope[]> {
    const items: { envelope: Envelope }[] = await this.call("GET", `/v1/receive/${this.accountPath}`, undefined, signal);
    return items.map((i) => i.envelope);
  }

  /** WebSocket: calls onEnvelope for each arrival, one at a time, until the
   * socket closes or signal aborts. Rejects if it can't connect. */
  listen(onEnvelope: (e: Envelope) => Promise<void>, signal: AbortSignal): Promise<void> {
    const url = `${this.config.daemonUrl.replace(/^http/, "ws")}/v1/receive/${this.accountPath}`;
    // Node's WebSocket takes headers as an extension to the browser API.
    const init = this.config.token ? { headers: { Authorization: `Bearer ${this.config.token}` } } : undefined;
    const ws = new WebSocket(url, init as any);
    let chain = Promise.resolve();
    return new Promise((resolve, reject) => {
      let opened = false;
      const stop = () => {
        ws.close();
        // Some Node versions never fire onclose for a socket still connecting.
        chain.then(() => resolve());
      };
      signal.addEventListener("abort", stop, { once: true });
      ws.onopen = () => {
        opened = true;
      };
      ws.onmessage = (ev) => {
        const item = JSON.parse(String(ev.data));
        const envelope: Envelope | undefined = item.params?.envelope ?? item.envelope;
        if (envelope) chain = chain.then(() => onEnvelope(envelope)).catch((err) => console.error(err));
      };
      ws.onclose = () => {
        signal.removeEventListener("abort", stop);
        chain.then(() => (opened || signal.aborted ? resolve() : reject(new Error(`couldn't connect to ${url}`))));
      };
      ws.onerror = () => {}; // onclose follows
    });
  }
}

/** Hands everything that arrives to onEnvelope until signal aborts, and
 * reconnects when the daemon goes away. */
export async function receiveForever(
  client: DaemonClient,
  onEnvelope: (e: Envelope) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const { receive, pollIntervalMs } = client.config;
  let backoff = 1000;
  while (!signal.aborted) {
    try {
      if (receive === "poll") {
        for (const e of await client.receive(signal)) await onEnvelope(e);
        await sleep(pollIntervalMs, undefined, { signal });
      } else {
        await client.listen(onEnvelope, signal);
        if (!signal.aborted) console.error("daemon closed the websocket; reconnecting");
        await sleep(1000, undefined, { signal });
      }
      backoff = 1000;
    } catch (err) {
      if (signal.aborted) break;
      console.error(`receive failed, retrying in ${backoff / 1000}s:`, (err as Error).message);
      await sleep(backoff, undefined, { signal }).catch(() => {});
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

/** The recipient that sends back to where an envelope came from: the group,
 * or the DM with its sender. */
export function chatOf(e: Envelope): string {
  const group = e.dataMessage?.groupInfo;
  return group ? "group." + Buffer.from(group.groupId).toString("base64") : e.sourceUuid;
}
