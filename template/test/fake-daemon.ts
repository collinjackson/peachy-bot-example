// A stand-in for `peachy daemon` in tests: the same HTTP API, a queue of
// envelopes to hand out (by GET or WebSocket), and a record of what the bot
// sent. No Peachy server is involved.

import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { Envelope } from "../src/daemon.ts";

export interface Call {
  method: string;
  path: string;
  body: any;
}

export class FakeDaemon {
  token?: string;
  calls: Call[] = [];
  queue: Envelope[] = [];
  private server = http.createServer((req, res) => this.onRequest(req, res));
  private sockets = new Set<Socket>();
  private nextTimestamp = 1_000_000;
  private waiters: (() => void)[] = [];

  constructor(token?: string) {
    this.token = token;
    this.server.on("upgrade", (req, socket) => this.onUpgrade(req, socket as Socket));
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  /** Delivers an envelope: over every open WebSocket, or to the next GET. */
  deliver(e: Envelope): void {
    if (this.sockets.size === 0) {
      this.queue.push(e);
      return;
    }
    const frame = textFrame(JSON.stringify({ jsonrpc: "2.0", method: "receive", params: { envelope: e, account: "bot" } }));
    for (const s of this.sockets) s.write(frame);
  }

  /** Resolves once the bot has made n calls that match. */
  async waitFor(n: number, match: (c: Call) => boolean = () => true): Promise<Call[]> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const found = this.calls.filter(match);
      if (found.length >= n) return found;
      if (Date.now() > deadline) throw new Error(`waited for ${n} calls, have ${JSON.stringify(this.calls)}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  }

  get sends(): Call[] {
    return this.calls.filter((c) => c.path === "/v2/send");
  }

  get websockets(): number {
    return this.sockets.size;
  }

  private authorized(req: http.IncomingMessage): boolean {
    return !this.token || req.headers.authorization === `Bearer ${this.token}`;
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const reply = (status: number, body?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (!this.authorized(req)) return reply(401, { error: "missing or wrong token" });
    const path = req.url ?? "";
    const body = raw ? JSON.parse(raw) : undefined;
    if (req.method === "GET" && path === "/v1/about") return reply(200, { mode: "normal", version: "fake" });
    if (req.method === "GET" && path.startsWith("/v1/groups/")) return reply(200, []);
    if (req.method === "GET" && path.startsWith("/v1/receive/")) {
      const out = this.queue.map((envelope) => ({ envelope, account: "bot" }));
      this.queue = [];
      return reply(200, out);
    }
    this.calls.push({ method: req.method ?? "", path, body });
    for (const w of this.waiters.splice(0)) w();
    if (path === "/v2/send") return reply(201, { timestamp: String(this.nextTimestamp++) });
    if (path.startsWith("/v1/reactions/")) return reply(204);
    reply(404, { error: "not found" });
  }

  // Just enough of RFC 6455 for one server that only sends text frames.
  private onUpgrade(req: http.IncomingMessage, socket: Socket): void {
    if (!this.authorized(req) || !req.url?.startsWith("/v1/receive/")) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = createHash("sha1")
      .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    this.sockets.add(socket);
    socket.on("data", (b: Buffer) => {
      if ((b[0] & 0x0f) === 0x8) socket.end(Buffer.from([0x88, 0x00])); // close: answer and hang up
    });
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => {});
    for (const e of this.queue.splice(0)) this.deliver(e);
  }
}

function textFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  let head: Buffer;
  if (payload.length < 126) {
    head = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(payload.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([head, payload]);
}

// Envelopes as the daemon hands them over.

let ts = 1;

export function message(text: string, from = { id: "alice-id", name: "Alice" }, groupId?: string): Envelope {
  const t = ts++;
  return {
    sourceUuid: from.id,
    sourceName: from.name,
    timestamp: t,
    dataMessage: {
      timestamp: t,
      message: text,
      ...(groupId ? { groupInfo: { groupId, groupName: "Test group" } } : {}),
    },
  };
}

export function reaction(emoji: string, target: number, from: { id: string; name: string }, groupId: string, isRemove = false): Envelope {
  const t = ts++;
  return {
    sourceUuid: from.id,
    sourceName: from.name,
    timestamp: t,
    dataMessage: {
      timestamp: t,
      message: null,
      groupInfo: { groupId, groupName: "Test group" },
      reaction: { emoji, targetAuthorUuid: "bot-id", targetSentTimestamp: target, isRemove },
    },
  };
}
