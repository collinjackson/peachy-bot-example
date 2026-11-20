# Example Bot

A chat bot for [Peachy](https://pchy.app), in TypeScript on Node 22.18 or
later, with no runtime dependencies.

It talks to `peachy daemon` from
[peachy-go](https://github.com/collinjackson/peachy-go), which runs as one of
the bot account's devices and answers the HTTP API of
[signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api). The
bot is any program that speaks that API; this one shows:

| Command | Shows |
|---|---|
| `/ping` | a reply to the message |
| `/help` | a plain message to the chat |
| `/hello` | mentioning someone |
| `/event <title>`, `/rsvp yes\|no\|maybe`, `/who` | keeping state per chat, reacting, mentioning several people, and counting reactions to the bot's own post |

It answers in group chats and DMs. In a group it stays quiet unless a
message starts with `/`; in a DM it answers everything.

## Files

- `src/main.ts`: starts the bot and keeps it receiving.
- `src/bot.ts`: what it does with each message. Add commands here.
- `src/rsvp.ts`: the event example. Delete it, and its commands, when you
  don't need it.
- `src/daemon.ts`: the daemon's API: `send`, `react`, `unreact`, `groups`,
  `receive` (polling) and `listen` (WebSocket).
- `src/config.ts`: settings, from the environment.
- `test/`: tests against a fake daemon (`test/fake-daemon.ts`), no Peachy
  server needed.

## Run it

1. **Get `peachy`.** Build it from
   [peachy-go](https://github.com/collinjackson/peachy-go); its README says
   how.
2. **Link a device for the bot.** Make a Peachy account for the bot (its own
   phone number), then give the daemon its own data folder and link it:

   ```
   peachy -d ~/example-bot-peachy login -name "Example Bot" +15551234567
   ```

   Type the code from the text message. Then open Peachy on the phone
   signed in to the bot's account, tap **add another device**, and pick the
   number the terminal shows.
3. **Start the daemon:**

   ```
   peachy -d ~/example-bot-peachy daemon -mode json-rpc
   ```

   It answers on `http://127.0.0.1:8080`. `-listen` changes that; listening
   beyond this machine needs `-token`.
4. **Start the bot:**

   ```
   npm install
   cp .env.example .env    # then edit it
   npm start
   ```

5. Add the bot's account to a group, or message it, and send `/help`.

## Settings

Set in the environment, or in `.env` for `npm start`:

| Variable | Default | |
|---|---|---|
| `PEACHY_DAEMON_URL` | `http://127.0.0.1:8080` | where the daemon answers |
| `PEACHY_TOKEN` | none | the daemon's `-token` |
| `PEACHY_ACCOUNT` | `bot` | the `{number}` in the API's paths; the daemon doesn't check it |
| `PEACHY_RECEIVE` | `websocket` | `websocket` hears each message as it arrives; `poll` asks every `PEACHY_POLL_MS`. A daemon in `-mode json-rpc` takes only `websocket`. |
| `PEACHY_POLL_MS` | `1000` | |
| `BOT_NAME` | `Example Bot` | used in `/help` |

## Good to know

- **People are ids.** Peachy never shows phone numbers: a sender is their
  `sourceUuid`, and a DM goes to that id. The bot can DM someone only after
  they've messaged it.
- **A group** is `"group." + base64(groupInfo.groupId)`; `chatOf()` in
  `src/daemon.ts` works out where to answer.
- **Messages are named by timestamp.** Replies (`replyTo`) and reactions use
  the `dataMessage.timestamp` the bot received, or the one `send` returned.
- **Mentions:** put any placeholder text (here `@Name`) in the message and
  give its `start` and `length` in UTF-16 units, which is what JavaScript
  string indexes count. The daemon turns it into the person's `@handle`.
  `withMentions()` in `src/bot.ts` does the counting.
- **Reactions** are a single emoji. A new one from the bot replaces its old
  one on that message.
- **The bot doesn't see its own messages**, nor edits, deletes or receipts.
- **Disappearing messages:** `dataMessage.expiresInSeconds` is the chat's
  timer. A bot that stores messages should drop them when it runs out.
- **State is in memory.** The events in `/event` are lost on restart. Keep
  anything that matters in a file or database.
- **Collect often.** The daemon holds up to 2,000 messages for a bot that
  isn't receiving, then drops the oldest.

## Test

```
npm test
```

Type-checks with `tsc`, then runs `node --test` against the fake daemon.

## Deploy

The daemon and the bot are two processes. Keep the daemon's data folder
private: it holds the bot account's keys.

**systemd:** `deploy/peachy-daemon.service` and `deploy/example-bot.service`
are starting points. Copy the bot to `/opt/example-bot`, put its settings in
`/opt/example-bot/.env`, adjust the paths and user, then
`systemctl enable --now peachy-daemon example-bot`.

**Docker:** the `Dockerfile` runs the bot only.

```
docker build -t example-bot .
docker run --env-file .env example-bot
```

From a container, the daemon on the host isn't `127.0.0.1`. Run the daemon
with `-listen 0.0.0.0:8080 -token <secret>` (or the address of a network the
container shares), and set `PEACHY_DAEMON_URL` and `PEACHY_TOKEN` to match.

## License

This bot started from
[peachy-bot-example](https://github.com/collinjackson/peachy-bot-example),
which is under MIT No Attribution: it's yours, and no notice or credit is
needed. Add a license of your own if and when you like.
