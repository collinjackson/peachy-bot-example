import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { withMentions } from "../src/bot.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { run } from "../src/main.ts";
import { FakeDaemon, message, reaction } from "./fake-daemon.ts";

const GROUP = "conv-123";
const GROUP_CHAT = "group." + Buffer.from(GROUP).toString("base64");
const bob = { id: "bob-id", name: "Bob" };

for (const receive of ["websocket", "poll"] as const) {
  describe(`receiving by ${receive}`, () => {
    let daemon: FakeDaemon;
    let stop: AbortController;
    let running: Promise<void>;

    beforeEach(async () => {
      daemon = new FakeDaemon("secret");
      const config: Config = {
        ...loadConfig({}),
        daemonUrl: await daemon.start(),
        token: "secret",
        receive,
        pollIntervalMs: 20,
      };
      stop = new AbortController();
      running = run(config, stop.signal);
      if (receive === "websocket") while (daemon.websockets === 0) await new Promise((r) => setTimeout(r, 10));
    });

    afterEach(async () => {
      stop.abort();
      await running;
      await daemon.stop();
    });

    test("/ping in a group replies pong to that message", async () => {
      const ping = message("/ping", undefined, GROUP);
      daemon.deliver(ping);
      const [send] = await daemon.waitFor(1);
      assert.equal(send.body.message, "pong");
      assert.deepEqual(send.body.recipients, [GROUP_CHAT]);
      assert.equal(send.body.quote_timestamp, ping.dataMessage!.timestamp);
    });

    test("/help in a DM answers the sender", async () => {
      daemon.deliver(message("/help"));
      const [send] = await daemon.waitFor(1);
      assert.deepEqual(send.body.recipients, ["alice-id"]);
      assert.match(send.body.message, /\/ping/);
    });

    test("/hello mentions the sender", async () => {
      daemon.deliver(message("/hello", undefined, GROUP));
      const [send] = await daemon.waitFor(1);
      assert.equal(send.body.message, "Hello, @Alice!");
      assert.deepEqual(send.body.mentions, [{ author: "alice-id", start: 7, length: 6 }]);
    });

    test("a group's chatter gets no answer; a DM's gets a hint", async () => {
      daemon.deliver(message("lunch?", undefined, GROUP));
      daemon.deliver(message("/nope", undefined, GROUP));
      daemon.deliver(message("hi bot"));
      const [send] = await daemon.waitFor(1);
      assert.deepEqual(send.body.recipients, ["alice-id"]);
      assert.match(send.body.message, /\/help/);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(daemon.sends.length, 1);
    });

    test("/event, /rsvp, a reaction and /who", async () => {
      daemon.deliver(message("/event Movie night", undefined, GROUP));
      const [announce] = await daemon.waitFor(1);
      assert.match(announce.body.message, /Movie night/);
      const announced = 1_000_000; // the fake's first send timestamp

      const rsvp = message("/rsvp yes", undefined, GROUP);
      daemon.deliver(rsvp);
      const [react] = await daemon.waitFor(1, (c) => c.path.startsWith("/v1/reactions/"));
      assert.deepEqual(react.body, {
        reaction: "👍",
        recipient: GROUP_CHAT,
        target_author: "alice-id",
        timestamp: rsvp.dataMessage!.timestamp,
      });

      daemon.deliver(reaction("🤔", announced, bob, GROUP));
      daemon.deliver(message("/who", undefined, GROUP));
      const sends = await daemon.waitFor(2, (c) => c.path === "/v2/send");
      assert.equal(sends[1].body.message, "Movie night\nyes: @Alice\nmaybe: @Bob\nno: nobody");
      assert.deepEqual(sends[1].body.mentions, [
        { author: "alice-id", start: 17, length: 6 },
        { author: "bob-id", start: 31, length: 4 },
      ]);

      daemon.deliver(reaction("🤔", announced, bob, GROUP, true));
      daemon.deliver(message("/who", undefined, GROUP));
      const after = await daemon.waitFor(3, (c) => c.path === "/v2/send");
      assert.match(after[2].body.message, /maybe: nobody/);
    });
  });
}

test("the bot keeps trying while the daemon is down", async () => {
  const stop = new AbortController();
  const config: Config = { ...loadConfig({}), daemonUrl: "http://127.0.0.1:9" };
  const running = run(config, stop.signal);
  await new Promise((r) => setTimeout(r, 200));
  stop.abort();
  await running; // returns once stopped, without throwing
});

test("withMentions counts UTF-16 units", () => {
  const { message, mentions } = withMentions(["🎉 ", { id: "x", name: "Zoë" }]);
  assert.equal(message, "🎉 @Zoë");
  assert.deepEqual(mentions, [{ author: "x", start: 3, length: 4 }]);
});
