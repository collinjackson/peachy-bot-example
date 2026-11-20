# peachy-bot-example

A starting point for writing a chat bot for [Peachy](https://pchy.app).

Bots run on Peachy through `peachy daemon`, part of
[peachy-go](https://github.com/collinjackson/peachy-go). The daemon links as
a device on the bot's Peachy account and answers the HTTP API of
[signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api):
receiving (polling, or a WebSocket), sending, replies, mentions, reactions
and the list of group chats. A bot is any program that speaks that API to
the daemon.

`template/` is a small bot in TypeScript on Node 22.18+, with no runtime
dependencies: `/ping`, `/help`, `/hello` (a mention), and an RSVP example
(`/event`, `/rsvp`, `/who`) that reacts to messages and counts reactions.
It works in group chats and DMs, and its tests run against a fake daemon.
[template/README.md](template/README.md) covers running and deploying it.

## Make your bot

```
git clone https://github.com/collinjackson/peachy-bot-example
cd peachy-bot-example
./new-bot.sh ../my-bot "My Bot"
cd ../my-bot && npm install && npm test
```

`new-bot.sh <dir> [name]` copies `template/` into a new directory, fills in
the name (in `/help`, the README, `package.json` and the systemd unit; the
name defaults to the directory's), and runs `git init` there. It doesn't
commit, so the first commit is yours.

### As a GitHub template

This repository can be a GitHub template repository. Click **Use this
template** to make your own repository from it, clone that, then:

```
./new-bot.sh --here "My Bot"
git add -A && git commit -m "Start My Bot"
```

`--here` moves `template/` to the top of your repository, fills in the name,
and removes the generator, its tests and this README.

## License

Everything here is under [MIT No Attribution](LICENSE). A bot made from it is
yours: no notice or credit is needed. `template/` has no license file, so a
new bot starts with none; add one if and when you like.

## Develop

```
npm test
```

Tests `new-bot.sh`, then installs and tests `template/`. Needs Node 22.18+,
bash and git.
