// What the bot does with each message. Add a command by adding a case to
// the switch in onCommand.

import { chatOf, type DaemonClient, type Envelope, type Mention } from "./daemon.ts";
import { Event, answerEmoji, answerForEmoji, parseAnswer, type Person } from "./rsvp.ts";

/** A message the bot is answering, with what it needs to answer it. */
export interface Incoming {
  text: string;
  /** Names the message for replies and reactions. */
  timestamp: number;
  from: Person;
  /** Where to answer: the group, or the DM with the sender. */
  chat: string;
  inGroup: boolean;
}

const help = (name: string) =>
  [
    `${name} commands:`,
    "/ping: check that I'm here",
    "/hello: I say hello to you",
    "/event <title>: start an event in this chat",
    "/rsvp yes|no|maybe: answer it (or react to the event with 👍 👎 🤔)",
    "/who: who's coming",
  ].join("\n");

export class Bot {
  daemon: DaemonClient;
  name: string;
  /** The current /event in each chat. */
  events = new Map<string, Event>();

  constructor(daemon: DaemonClient, name: string) {
    this.daemon = daemon;
    this.name = name;
  }

  async handle(e: Envelope): Promise<void> {
    const dm = e.dataMessage;
    if (!dm) return;
    const from = { id: e.sourceUuid, name: e.sourceName || "someone" };
    if (dm.reaction) {
      return this.onReaction(chatOf(e), from, dm.reaction.targetSentTimestamp, dm.reaction.emoji, dm.reaction.isRemove);
    }
    const text = dm.message?.trim();
    if (!text) return;
    const msg: Incoming = { text, timestamp: dm.timestamp, from, chat: chatOf(e), inGroup: !!dm.groupInfo };
    if (text.startsWith("/")) {
      const [command, ...rest] = text.slice(1).split(/\s+/);
      return this.onCommand(msg, command.toLowerCase(), rest.join(" "));
    }
    // In a group, people talk to each other; stay quiet unless asked.
    // In a DM everything is for the bot.
    if (!msg.inGroup) await this.reply(msg, "Hi! Send /help to see what I can do.");
  }

  async onCommand(msg: Incoming, command: string, args: string): Promise<void> {
    switch (command) {
      case "ping":
        return this.reply(msg, "pong");
      case "help":
        await this.say(msg.chat, help(this.name));
        return;
      case "hello": {
        const { message, mentions } = withMentions(["Hello, ", msg.from, "!"]);
        await this.say(msg.chat, message, mentions);
        return;
      }
      case "event": {
        if (!args) return this.reply(msg, "Usage: /event <title>");
        const event = new Event(args);
        this.events.set(msg.chat, event);
        const e = answerEmoji;
        event.announcement = await this.say(
          msg.chat,
          `📅 ${args}\nReply /rsvp yes|no|maybe, or react to this message with ${e.yes} ${e.no} ${e.maybe}.`,
        );
        return;
      }
      case "rsvp": {
        const event = this.events.get(msg.chat);
        if (!event) return this.reply(msg, "No event here yet. Start one with /event <title>.");
        const answer = parseAnswer(args);
        if (!answer) return this.reply(msg, "Usage: /rsvp yes|no|maybe");
        event.set(msg.from, answer);
        return this.react(msg, answerEmoji[answer]);
      }
      case "who": {
        const event = this.events.get(msg.chat);
        if (!event) return this.reply(msg, "No event here yet. Start one with /event <title>.");
        const parts: (string | Person)[] = [event.title];
        for (const answer of ["yes", "maybe", "no"] as const) {
          const people = event.who(answer);
          parts.push(`\n${answer}: `);
          if (people.length === 0) parts.push("nobody");
          people.forEach((p, i) => parts.push(...(i > 0 ? [", "] : []), p));
        }
        const { message, mentions } = withMentions(parts);
        await this.say(msg.chat, message, mentions);
        return;
      }
      default:
        if (!msg.inGroup) return this.reply(msg, `I don't know /${command}. Send /help to see what I can do.`);
    }
  }

  async onReaction(chat: string, from: Person, target: number, emoji: string, removed: boolean): Promise<void> {
    const event = this.events.get(chat);
    const answer = answerForEmoji(emoji);
    if (!event || !answer || target !== event.announcement) return;
    if (removed) event.clear(from.id, answer);
    else event.set(from, answer);
  }

  // Ways to answer. Each returns once the daemon has sent it.

  /** Sends to a chat; returns the message's timestamp. */
  say(chat: string, text: string, mentions?: Mention[]): Promise<number> {
    return this.daemon.send(chat, text, { mentions });
  }

  /** Answers as a reply to msg, so it shows quoted. */
  async reply(msg: Incoming, text: string): Promise<void> {
    await this.daemon.send(msg.chat, text, { replyTo: msg.timestamp });
  }

  react(msg: Incoming, emoji: string): Promise<void> {
    return this.daemon.react(msg.chat, { author: msg.from.id, timestamp: msg.timestamp }, emoji);
  }
}

/** Joins text and people into a message, with a mention for each person.
 * The daemon turns each mention's span into the person's @handle. */
export function withMentions(parts: (string | Person)[]): { message: string; mentions: Mention[] } {
  let message = "";
  const mentions: Mention[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      message += part;
    } else {
      const placeholder = "@" + part.name;
      // JS string lengths are UTF-16 units, which is what the API counts.
      mentions.push({ author: part.id, start: message.length, length: placeholder.length });
      message += placeholder;
    }
  }
  return { message, mentions };
}
