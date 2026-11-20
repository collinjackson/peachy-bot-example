// Tests new-bot.sh: it makes a bot directory with the name filled in.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = join(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "new-bot-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const newBot = (args, cwd = root) =>
  execFileSync(join(cwd, "new-bot.sh"), args, { cwd, encoding: "utf8", stdio: "pipe" });
// Matches a command that exited 1 with stderr matching re.
const exited1 = (re = /./) => (err) => err.status === 1 && re.test(String(err.stderr));

test("copies template/ with the name filled in", () => {
  const dir = join(scratch, "movie-bot");
  const out = newBot([dir, "Movie Night Bot"]);
  assert.match(out, /Made Movie Night Bot/);

  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(pkg.name, "movie-night-bot");
  assert.equal(JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8")).name, "movie-night-bot");
  assert.match(readFileSync(join(dir, "src/config.ts"), "utf8"), /"Movie Night Bot"/);
  assert.match(readFileSync(join(dir, "README.md"), "utf8"), /^# Movie Night Bot\n/);
  assert.ok(existsSync(join(dir, "deploy/movie-night-bot.service")));
  assert.ok(!existsSync(join(dir, "LICENSE"))); // the owner's to add
  assert.ok(existsSync(join(dir, ".git")));
  assert.ok(!existsSync(join(dir, "node_modules")));

  // grep exits 1 when nothing is left to fill in.
  assert.throws(
    () => execFileSync("grep", ["-rlE", "Example Bot|example-bot", dir, "--exclude-dir=.git"], { stdio: "pipe" }),
    (err) => err.status === 1,
  );
});

test("names the bot after its directory by default", () => {
  const dir = join(scratch, "quiz-bot");
  newBot([dir]);
  assert.equal(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name, "quiz-bot");
});

test("won't write into a directory that has files", () => {
  const dir = join(scratch, "movie-bot");
  assert.throws(() => newBot([dir, "Other"]), exited1(/isn't empty/));
});

test("refuses names that aren't plain", () => {
  assert.throws(() => newBot([join(scratch, "x"), "a/b & c"]), exited1(/bot name/));
  assert.ok(!existsSync(join(scratch, "x")));
});

test("--here turns a copy of this repo into the bot", () => {
  const copy = join(scratch, "from-template");
  cpSync(root, copy, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.endsWith(".git") });
  newBot(["--here", "Trivia"], copy);
  const files = readdirSync(copy).sort();
  assert.ok(!files.includes("template"));
  assert.ok(!files.includes("new-bot.sh"));
  assert.ok(files.includes("src"));
  assert.equal(JSON.parse(readFileSync(join(copy, "package.json"), "utf8")).name, "trivia");
  assert.ok(!files.includes("LICENSE")); // the template's own repo license doesn't come along
});
