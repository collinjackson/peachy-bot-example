#!/usr/bin/env bash
# Makes a new Peachy bot from template/.
#
#   ./new-bot.sh <dir> [name]   copy template/ into a new directory
#   ./new-bot.sh --here [name]  turn this checkout into the bot (for a repo
#                               made with GitHub's "Use this template")
#
# The name defaults to the directory's name. It fills in "Example Bot" and
# "example-bot" (the name in lowercase with dashes) throughout.
set -euo pipefail

usage() {
  echo "usage: $0 <dir> [name]" >&2
  echo "       $0 --here [name]" >&2
  exit 2
}

[ $# -ge 1 ] && [ $# -le 2 ] || usage
root=$(cd "$(dirname "$0")" && pwd)
[ -d "$root/template" ] || { echo "no template/ next to $0" >&2; exit 1; }

if [ "$1" = "--here" ]; then
  dest=$root
else
  dest=$1
  if [ -e "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
    echo "$dest already exists and isn't empty" >&2
    exit 1
  fi
fi

if [ $# -ge 2 ]; then
  name=$2
else
  name=$(basename "$dest")
  case $name in .|..) name=$(basename "$(cd "$dest" && pwd)") ;; esac
fi
if ! [[ $name =~ ^[A-Za-z0-9][A-Za-z0-9\ ._\'-]*$ ]]; then
  echo "a bot name is letters, digits, spaces and . _ ' -, not: $name" >&2
  exit 1
fi
slug=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | sed -E "s/[^a-z0-9]+/-/g; s/^-+//; s/-+$//")
[ -n "$slug" ] || { echo "can't make a package name from: $name" >&2; exit 1; }

if [ "$1" = "--here" ]; then
  if [ -d "$root/.git" ] && [ -n "$(git -C "$root" status --porcelain)" ]; then
    echo "commit or stash your changes first: --here replaces this checkout's files" >&2
    exit 1
  fi
  # Everything but .git and template/ goes; template/ moves up.
  find "$root" -mindepth 1 -maxdepth 1 ! -name .git ! -name template -exec rm -rf {} +
  rm -rf "$root/template/node_modules"
  find "$root/template" -mindepth 1 -maxdepth 1 -exec mv {} "$root/" \;
  rmdir "$root/template"
else
  mkdir -p "$dest"
  (cd "$root/template" && tar cf - --exclude node_modules .) | (cd "$dest" && tar xf -)
fi

# Fill in the name. Only letters, digits and " ._'-" get here, so no
# escaping is needed in sed.
grep -rlE "Example Bot|example-bot" "$dest" --exclude-dir=.git --exclude-dir=node_modules | while read -r f; do
  sed -e "s/Example Bot/$name/g" -e "s/example-bot/$slug/g" "$f" > "$f.new"
  mv "$f.new" "$f"
done
if [ -e "$dest/deploy/example-bot.service" ]; then
  mv "$dest/deploy/example-bot.service" "$dest/deploy/$slug.service"
fi

if [ ! -d "$dest/.git" ] && command -v git > /dev/null; then
  git init -q "$dest"
  git -C "$dest" symbolic-ref HEAD refs/heads/main
fi

cat <<MSG
Made $name in $dest.

  cd $dest
  npm install
  npm test
  cp .env.example .env    # then edit it, and see README.md to run it

It's your code now. LICENSE is MIT No Attribution, which asks nothing of
you; replace it with any license you like (and "license" in package.json).
MSG
