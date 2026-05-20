#!/usr/bin/env bun
import { $, TOML } from "bun";
import { readFileSync } from "fs";
import { homedir } from "os";
import { basename } from "path";

type Repo = { url: string; name: string };
type KittyTab = { title: string; id: number };
type KittyWindow = { tabs: KittyTab[] };

const config = TOML.parse(
  readFileSync(`${homedir()}/.gitrepos.toml`, "utf8"),
) as { repo: Repo[] };

const repos = config.repo;

const input = repos.map((r) => `${r.url}\t${r.name}`).join("\n");
const proc = Bun.spawn(
  [
    "fzf",
    "--with-nth=2",
    "--layout=reverse",
    "--delimiter=\t",
    "--prompt=Select project> ",
  ],
  { stdin: "pipe", stdout: "pipe" },
);
proc.stdin.write(input);
await proc.stdin.end();
const selection = (await new Response(proc.stdout).text()).trim();
if (!selection) process.exit(0);
const [url, name] = selection.split("\t");
const title = basename(name!);
// Check existing tabs
const windows: KittyWindow[] = await $`kitty @ ls`.json();
const exists = windows.some((w) => w.tabs.some((t) => t.title === title));
if (exists) {
  await $`kitty @ focus-tab --match ${"title:^" + title + "$"}`;
} else {
  const script = `${homedir()}/git/joe-p/apple-dev-container/run_dev_container.sh`;
  await $`kitty @ launch --type=tab --tab-title=${title} /bin/zsh -i -c ${`${script} '${name}' '${url}'`}`;
}
