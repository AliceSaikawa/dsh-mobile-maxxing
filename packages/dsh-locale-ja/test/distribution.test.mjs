/**
 * Distribution and install smoke tests for the optional Japanese locale pack.
 *
 * These run without a DSH process and without a browser. They pack the real
 * package with npm, inspect the tarball, import the installed host half, and
 * materialize the installed browser half through the same
 * window.__ModuleLoader__.load({ id, factory }) registration DSH uses. They
 * prove that the package is a standalone, private, optional ja owner rather
 * than something the mobile tarball installs.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { LOCALE_REQUIREMENTS, localePublishDecision, tarballName } from '../../../scripts/pack-all.mjs';
import { loadClientModule } from './client-loader.mjs';

const packageDir = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(packageDir, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(packageDir, 'locale', 'package-meta.json'), 'utf8'));
const upstream = JSON.parse(fs.readFileSync(path.join(packageDir, 'locale', 'upstream.json'), 'utf8'));
const rootLicense = fs.readFileSync(path.join(repo, 'LICENSE'), 'utf8');

function temporaryDirectory(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-locale-ja-dist-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	return directory;
}

function pack(t) {
	const destination = temporaryDirectory(t);
	execFileSync('npm', ['pack', '--pack-destination', destination], { cwd: packageDir, stdio: 'pipe' });
	const file = path.join(destination, tarballName(manifest));
	assert.equal(fs.existsSync(file), true, 'npm pack did not create the predictable tarball name');
	return { file, destination };
}

function tarballEntries(file) {
	return execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).trim().split('\n');
}

test('the package is a separate, private web client with its own exports', () => {
	assert.equal(manifest.name, 'dsh-locale-ja');
	assert.equal(manifest.private, true, 'the package stays private until its actual release');
	assert.equal(manifest.type, 'module');
	assert.equal(manifest.description, meta.description, 'the generated description drifted from package-meta.json');
	assert.equal(manifest.dsh?.client?.platform, 'web', 'the locale pack must be usable on the web');
	assert.equal(manifest.dsh?.client?.immediately, true);
	assert.deepEqual(manifest.dsh?.client?.inject, ['@deepseek-ai/dsh-client-locale']);
	assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-client-locale'], upstream.dsh.version);
	assert.equal(manifest.exports?.['.'], './index.js');
	assert.equal(manifest.exports?.['./client'], './client.js');
	for (const target of Object.values(manifest.exports)) {
		if (typeof target === 'string' && !target.includes('*')) {
			assert.equal(fs.existsSync(path.join(packageDir, target)), true, 'export target is missing: ' + target);
		}
	}
	assert.doesNotMatch(JSON.stringify(manifest.dependencies ?? {}), /dsh-mobile-maxxing/,
		'the locale pack must not depend on or install the mobile package');
	assert.equal(manifest.files.some((entry) => entry === 'work' || entry.startsWith('work/')), false);
	assert.ok(manifest.files.includes('LICENSE'), 'the manifest must ship the package MIT license');
	assert.ok(manifest.files.includes('NOTICE'), 'the manifest must ship the upstream notice');

	// The mobile package is the optional consumer's neighbour, not its owner:
	// nothing silently installs or enables the locale pack.
	const rootManifest = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
	for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
		assert.equal(rootManifest[field]?.['dsh-locale-ja'], undefined, 'the root package silently depends on ' + field);
	}
	assert.doesNotMatch(fs.readFileSync(path.join(repo, 'cordis.patch.yml'), 'utf8'), /dsh-locale-ja/,
		'the mobile bundle silently enables the locale pack');
	assert.equal(rootManifest.files.some((entry) => entry.includes('dsh-locale-ja')), false,
		'the root file list ships the locale package');
});

test('the rename left one identity: dsh-locale-ja, and no old name in the tracked tree', () => {
	assert.equal(manifest.name, 'dsh-locale-ja');
	assert.equal(meta.name, manifest.name, 'the generated manifest and package-meta.json disagree');
	assert.equal(path.basename(packageDir), manifest.name, 'the directory name is the package name');
	assert.equal(manifest.repository?.directory, 'packages/dsh-locale-ja');
	assert.equal(manifest.homepage?.endsWith('/packages/dsh-locale-ja#readme'), true, 'the homepage points elsewhere');

	// The old name belongs to no live file. Spelled in parts so this guard is
	// itself not a hit; historical notes, if any, live outside this repository.
	const oldName = ['rdsh', 'locale', 'ja'].join('-');
	const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
	assert.equal(tracked.some((file) => file.startsWith('packages/' + oldName + '/')), false, 'the old package directory is still tracked');
	const offenders = tracked.filter((file) => fs.readFileSync(path.join(repo, file), 'utf8').includes(oldName));
	assert.deepEqual(offenders, [], 'the old package name survives in tracked files');
});

test('npm pack is a standalone install: no work directory and every export resolves', async (t) => {
	const { file } = pack(t);
	const entries = tarballEntries(file);
	for (const required of [
		'package/package.json',
		'package/index.js',
		'package/client.js',
		'package/locale/translation-status.json',
		'package/locale/namespaces/en/common.json',
		'package/locale/namespaces/ja/common.json',
		'package/README.md',
	]) {
		assert.ok(entries.includes(required), 'the tarball is missing ' + required);
	}
	assert.deepEqual(entries.filter((entry) => /(^|\/)work(\/|$)/.test(entry)), [], 'work/ must not ship');
	assert.deepEqual(entries.filter((entry) => entry.includes('.gitignore')), []);

	const extracted = temporaryDirectory(t);
	execFileSync('tar', ['-xzf', file, '-C', extracted, '--strip-components=1'], { stdio: 'pipe' });
	assert.equal(fs.existsSync(path.join(extracted, 'work')), false, 'installing created a work directory');

	const installedManifest = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
	for (const [subpath, target] of Object.entries(manifest.exports)) {
		assert.equal(installedManifest.exports[subpath], target, 'export changed during install: ' + subpath);
		const normalized = target.replace('./', '');
		if (!normalized.includes('*')) {
			assert.equal(fs.existsSync(path.join(extracted, normalized)), true, 'installed export target is missing: ' + target);
		}
	}

	const host = await import(pathToFileURL(path.join(extracted, 'index.js')).href);
	assert.equal(typeof host.apply, 'function');

	// The public ./client export is browser-only: the installed bytes must
	// register through the DSH loader, so evaluate them the way the Host does
	// instead of importing them as an ES module in bare Node.
	const client = loadClientModule(fs.readFileSync(path.join(extracted, 'client.js'), 'utf8'));
	assert.equal(client.registration.id, 'dsh-locale-ja');
	assert.deepEqual(Object.keys(client.registration).sort(), ['factory', 'id']);
	assert.equal(typeof client.registration.factory, 'function');
	assert.deepEqual(client.language, { id: 'ja', label: '日本語', fallback: 'en' });
	assert.deepEqual(client.inject, ['locale']);
	assert.equal(Object.keys(client.dictionaries).length, upstream.totals.namespaces);
	assert.equal(typeof client.apply, 'function');
});

test('npm pack carries the MIT terms and accurate upstream attribution', (t) => {
	const { file } = pack(t);
	const entries = tarballEntries(file);
	for (const required of ['package/LICENSE', 'package/NOTICE']) {
		assert.ok(entries.includes(required), 'the tarball is missing ' + required);
	}

	const extracted = temporaryDirectory(t);
	execFileSync('tar', ['-xzf', file, '-C', extracted, '--strip-components=1'], { stdio: 'pipe' });
	const installedManifest = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
	assert.equal(installedManifest.license, 'MIT');

	// The shipped license is the repository MIT text plus the upstream snapshot's
	// copyright line: the permission notice and disclaimer stay byte-identical.
	const expectedLicense = rootLicense.replace(
		'Copyright (c) 2026 kuraneko1\n',
		'Copyright (c) 2026 kuraneko1\nCopyright (c) 2026 DeepSeek\n',
	);
	const license = fs.readFileSync(path.join(extracted, 'LICENSE'), 'utf8');
	assert.equal(license, expectedLicense, 'the packed LICENSE is not the repository MIT text plus the upstream copyright');

	const notice = fs.readFileSync(path.join(extracted, 'NOTICE'), 'utf8');
	assert.match(notice, /Copyright \(c\) 2026 DeepSeek/u, 'the upstream copyright holder is not named');
	for (const line of notice.split('\n').filter((entry) => entry.includes('Copyright'))) {
		assert.match(line, /Copyright \(c\) 2026 (?:kuraneko1|DeepSeek)/u, 'the notice invents or misattributes a copyright holder: ' + line);
	}
	// Every package recorded as an owner of the English snapshot is DeepSeek's,
	// which is what the notice claims; no third author is invented.
	for (const namespace of Object.values(upstream.namespaces)) {
		for (const owner of namespace.owners) assert.match(owner, /^@deepseek-ai\//u, 'the English snapshot has a non-DeepSeek owner: ' + owner);
	}
	assert.match(notice, /@deepseek-ai\/dsh-client-locale/u, 'the upstream locale package is not named');
	assert.ok(notice.includes(upstream.dsh.version), 'the notice does not name the snapshot version ' + upstream.dsh.version);
	assert.match(notice, /locale\/namespaces\/en\/\*\.json/u, 'the notice does not say which files are the English snapshot');
	assert.match(notice, /derivative translations/u, 'the notice does not mark the ja values as translations');
	assert.match(notice, /MIT License/u);
});

test('the installed client is the single ja owner and coexists/disposes cleanly', async (t) => {
	const { file } = pack(t);
	const extracted = temporaryDirectory(t);
	execFileSync('tar', ['-xzf', file, '-C', extracted, '--strip-components=1'], { stdio: 'pipe' });
	const source = fs.readFileSync(path.join(extracted, 'client.js'), 'utf8');
	const client = loadClientModule(source);
	assert.equal((source.match(/\.addLanguage\(/gu) ?? []).length, 1, 'exactly one owner must addLanguage(ja)');
	assert.doesNotMatch(source, /\.setLocale\(/, 'the locale pack must not set the shared language');
	assert.doesNotMatch(source, /dsh-mobile-maxxing/, 'the locale pack must not reach into the mobile package');

	const registered = new Map();
	const languages = [];
	const disposers = [];
	registered.set('foreign.namespace', { untouched: 'yes' });
	const ctx = {
		effect(effect) {
			const dispose = effect();
			disposers.push(dispose);
			return dispose;
		},
		locale: {
			addLanguage(input) {
				languages.push({ ...input });
				registered.set('__language__', input);
				return () => registered.delete('__language__');
			},
			register(namespace, locale, dictionary) {
				assert.equal(registered.has(namespace), false, 'duplicate registration for ' + namespace);
				assert.equal(locale, 'ja');
				registered.set(namespace, dictionary);
				return () => {
					if (registered.get(namespace) === dictionary) registered.delete(namespace);
				};
			},
		},
	};
	client.apply(ctx);
	assert.equal(languages.length, 1);
	assert.deepEqual(languages[0], { id: 'ja', label: '日本語', fallback: 'en' });
	assert.equal(registered.size, 65 + 1, '64 dictionaries, one language and the foreign namespace');
	assert.equal(disposers.length, 65);
	for (const dispose of disposers) dispose();
	assert.deepEqual([...registered.keys()], ['foreign.namespace'], 'dispose removed a foreign registration');
	assert.equal(registered.get('foreign.namespace').untouched, 'yes');

	// A second activation (HMR / plugin reload) is clean too.
	client.apply(ctx);
	assert.equal(registered.size, 65 + 1);
	for (const dispose of disposers) dispose();
	assert.deepEqual([...registered.keys()], ['foreign.namespace'], 'a repeated dispose removed a foreign registration');
});

test('pack-all publishes the locale only for the complete 64/2906 zero-fallback status', () => {
	assert.deepEqual(LOCALE_REQUIREMENTS, { namespaces: 64, keys: 2906, fallback: 0 });
	const current = JSON.parse(fs.readFileSync(path.join(packageDir, 'locale', 'translation-status.json'), 'utf8'));
	const complete = {
		...current,
		status: 'complete',
		developmentOnlyEnglishFallback: false,
		totals: { ...current.totals, translated: 2906, fallback: 0 },
	};

	assert.equal(localePublishDecision(complete).publish, true);
	assert.equal(tarballName(manifest), `dsh-locale-ja-${manifest.version}.tgz`);

	assert.equal(current.status, current.totals.fallback === 0 ? 'complete' : 'incomplete');
	if (current.totals.fallback > 0) {
		const decision = localePublishDecision(current);
		assert.equal(decision.publish, false, 'an incomplete locale must not be packed');
		assert.match(decision.reason, /incomplete|fallback/);
	}
	assert.equal(localePublishDecision({ ...complete, totals: { ...complete.totals, translated: 2905, fallback: 1 } }).publish, false);
	assert.equal(localePublishDecision({ ...complete, totals: { ...complete.totals, keys: 2905 } }).publish, false);
	assert.equal(localePublishDecision({ ...complete, locale: 'zh' }).publish, false);
	assert.equal(localePublishDecision({ ...complete, developmentOnlyEnglishFallback: true }).publish, false);
	assert.equal(localePublishDecision(null).publish, false);
});

test('pack-all refuses an incomplete locale in practice and leaves no locale tarball', () => {
	const status = JSON.parse(fs.readFileSync(path.join(packageDir, 'locale', 'translation-status.json'), 'utf8'));
	const result = spawnSync('node', [path.join(repo, 'scripts', 'pack-all.mjs'), '--require-locale'], {
		cwd: repo,
		encoding: 'utf8',
	});
	const tarballs = fs.readdirSync(path.join(repo, 'dist')).filter((file) => /^dsh-locale-ja-.*\.tgz$/.test(file));
	if (status.status === 'complete' && status.totals.fallback === 0) {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(tarballs.length, 1, 'a complete locale must produce exactly one tarball');
	} else {
		assert.equal(result.status, 1, 'an incomplete locale must fail under --require-locale');
		assert.match(result.stdout, /REFUSED: not packing dsh-locale-ja/);
		assert.match(result.stdout, /English fallback pack was produced/);
		assert.deepEqual(tarballs, [], 'an incomplete locale produced a fallback tarball');
	}
	assert.equal(fs.existsSync(path.join(repo, 'dist', tarballName(JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))))), true,
		'the mobile tarball must still be packed');
});

test('docs describe the optional local-tarball install and never a fake release asset', () => {
	const readme = fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8');
	assert.doesNotMatch(readme, /releases\/download\/[^\s"']*dsh-locale-ja/, 'the unreleased locale must not link a release asset');
	assert.match(readme, /dsh plugin --profile web add \.\/dist\/dsh-locale-ja-0\.1\.0\.tgz/);
	assert.match(readme, /REFUSED/);
	assert.match(readme, /sole owner|only owner/i, 'the sole-owner migration must be explicit');
	const rootReadme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');
	assert.doesNotMatch(rootReadme, /releases\/download\/[^\s"']*dsh-locale-ja/);
	const jaUsage = fs.readFileSync(path.join(repo, 'packages', 'dsh-mobile-maxxing', 'docs', 'USAGE.ja.md'), 'utf8');
	assert.doesNotMatch(jaUsage, /この端末では日本語も選べます/, 'the mobile docs still claim a built-in ja pack');
	const issueNotes = fs.readFileSync(path.join(repo, 'packages', 'dsh-mobile-maxxing', 'docs', 'ISSUES.md'), 'utf8');
	assert.match(issueNotes, /唯一の所有者/);
	assert.match(issueNotes, /REFUSED/);
});
