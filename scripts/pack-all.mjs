/**
 * Pack every publishable package into dist/.
 *
 * The release attaches these tarballs, and each package's README points at
 * them, so the file names have to be predictable: `<name>-<version>.tgz`.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// The repository root is the published package; packages/dsh-mobile-maxxing/ is the
// implementation and ships inside it.
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packages = [{
	directory: root,
	name: manifest.name,
	version: manifest.version,
	file: `${manifest.name}-${manifest.version}.tgz`,
	alias: `${manifest.name}.tgz`,
}];

// Rewrite the READMEs BEFORE packing. `npm pack` snapshots the files, so
// rewriting afterwards ships the previous version's install URL inside the
// tarball — which is how the 0.3.3 tarball came to point at 0.3.2.
//
// Keep the install commands on the version just packed: a version-free install
// URL is cached by pnpm, so the docs must point at the versioned one.
for (const item of packages) {
	const url = `https://github.com/kuraneko1/dsh-mobile-maxxing/releases/download/v${item.version}/${item.file}`;
	for (const doc of [join(item.directory, "README.md"), join(root, "packages", item.name, "README.md")]) {
		let text;
		try {
			text = readFileSync(doc, "utf8");
		} catch {
			continue;
		}
		const updated = text.replace(
			new RegExp(`https://github\\.com/kuraneko1/dsh-mobile-maxxing/releases/download/v[^/]+/${item.name}[\\w.\\-]*\\.tgz`, "g"),
			url,
		);
		if (updated !== text) {
			writeFileSync(doc, updated);
			console.log(`updated ${doc.slice(root.length)} -> v${item.version}`);
		}
	}
}

const packed = [];
for (const item of packages) {
	execFileSync("npm", ["pack", "--pack-destination", dist], { cwd: item.directory, stdio: "pipe" });
	// A second copy under a version-free name, so documentation can link
	// `releases/latest/download/dsh-mobile-maxxing.tgz` and keep working across versions.
	copyFileSync(join(dist, item.file), join(dist, item.alias));
	packed.push(item);
	console.log(`packed ${item.file} (+ ${item.alias})`);
}

console.log(`\n${packed.length} tarballs in dist/`);
for (const item of packed) console.log(`  ${item.file}  /  ${item.alias}`);
