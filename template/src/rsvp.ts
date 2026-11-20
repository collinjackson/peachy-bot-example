// The /event, /rsvp and /who example: one event per chat, kept in memory
// (a restart forgets it). Delete this file and its commands in bot.ts if
// you don't want it.

export type Answer = "yes" | "no" | "maybe";

export const answerEmoji: Record<Answer, string> = { yes: "👍", no: "👎", maybe: "🤔" };

export function parseAnswer(s: string): Answer | undefined {
  const a = s.trim().toLowerCase();
  return a === "yes" || a === "no" || a === "maybe" ? a : undefined;
}

export function answerForEmoji(emoji: string): Answer | undefined {
  return (Object.keys(answerEmoji) as Answer[]).find((a) => answerEmoji[a] === emoji);
}

export interface Person {
  id: string;
  name: string;
}

export class Event {
  title: string;
  /** The timestamp of the bot's announcement, so reactions to it count. */
  announcement = 0;
  answers = new Map<string, { person: Person; answer: Answer }>();

  constructor(title: string) {
    this.title = title;
  }

  set(person: Person, answer: Answer): void {
    this.answers.set(person.id, { person, answer });
  }

  clear(personId: string, answer: Answer): void {
    if (this.answers.get(personId)?.answer === answer) this.answers.delete(personId);
  }

  who(answer: Answer): Person[] {
    return [...this.answers.values()].filter((a) => a.answer === answer).map((a) => a.person);
  }
}
