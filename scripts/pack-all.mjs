/**
 * Pack every publishable package into dist/.
 *
 * The release attaches these tarballs, and each package's README points at
 * them, so the file names have to be predictable: `<name>-<version>.tgz`.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const packed = [];
for (const entry of readdirSync(join(root, "packages"))) {
	const directory = join(root, "packages", entry);
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
	} catch {
		continue;
	}
	if (manifest.private === true) {
		console.log(`skip ${manifest.name} (private)`);
		continue;
	}
	execFileSync("npm", ["pack", "--pack-destination", dist], { cwd: directory, stdio: "pipe" });
	const file = `${manifest.name}-${manifest.version}.tgz`;
	// A second copy under a version-free name, so documentation can link
	// `releases/latest/download/rdsh-pwa.tgz` and keep working across versions.
	const alias = `${manifest.name}.tgz`;
	copyFileSync(join(dist, file), join(dist, alias));
	packed.push({ name: manifest.name, version: manifest.version, file, alias });
	console.log(`packed ${file} (+ ${alias})`);
}

console.log(`\n${packed.length} tarballs in dist/`);
for (const item of packed) console.log(`  ${item.file}  /  ${item.alias}`);
