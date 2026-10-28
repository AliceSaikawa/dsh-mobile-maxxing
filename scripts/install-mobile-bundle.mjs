#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const profile = process.env.DSH_PROFILE ?? process.argv[2] ?? "web";
const tag = process.env.DSH_BUNDLE_TAG ?? "v0.7.0-rc.1";
const base = process.env.DSH_BUNDLE_BASE_URL ?? "https://github.com/kuraneko1/dsh-mobile-maxxing/releases/download/" + tag;
const packages = [
  "github:kuraneko1/dsh-mobile-maxxing" + (process.env.DSH_BUNDLE_TAG ? "#" + tag : ""),
  base + "/dsh-md-rendering-0.1.2.tgz",
  "github:kuraneko1/dsh-locale-ja" + (process.env.DSH_LOCALE_REF ? "#" + process.env.DSH_LOCALE_REF : ""),
];

const result = spawnSync("dsh", ["plugin", "--profile", profile, "add", ...packages], { stdio: "inherit" });
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
