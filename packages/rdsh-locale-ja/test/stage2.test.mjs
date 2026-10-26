import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	BATCH_MAX,
	BATCH_MIN,
	DEFAULT_PACKAGE_DIR,
	EXPECTED_KEYS,
	EXPECTED_NAMESPACES,
	assertPlaceholders,
	buildArtifacts,
	checkArtifacts,
	dictionaryHash,
	duplicateValueWarnings,
	jsonText,
	loadEnglish,
	loadJapanese,
	localePaths,
	parseStrictJson,
	placeholders,
	readJsonFile,
	validateBatchManifest,
	writeArtifacts,
} from '../../../tools/locale-data.mjs';
import { mergeReviewedBatches } from '../../../tools/merge-batches.mjs';
import { LOCALE_PACKS } from '../../dsh-mobile-maxxing/lib/copy.js';
import { apply, dictionaries, inject, language } from '../client.js';

const packageDir = path.resolve(import.meta.dirname, '..');

function temporaryDirectory(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rdsh-locale-ja-stage2-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	return directory;
}

function copyPackageLocale(t) {
	const directory = temporaryDirectory(t);
	fs.cpSync(path.join(packageDir, 'locale'), path.join(directory, 'locale'), { recursive: true });
	return directory;
}

function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, jsonText(value));
}

function readBatchFile(packageDirectory) {
	return readJsonFile(path.join(packageDirectory, 'locale', 'batches.json'));
}

function batchById(packageDirectory, id) {
	const batch = readBatchFile(packageDirectory).batches.find((entry) => entry.id === id);
	assert.ok(batch, 'missing batch ' + id);
	return batch;
}

function makeOutput(packageDirectory, id, { sourceHash = null, omit = null, transform = (value) => '【改】' + value } = {}) {
	const batch = batchById(packageDirectory, id);
	const upstream = readJsonFile(path.join(packageDirectory, 'locale', 'upstream.json'));
	const english = readJsonFile(path.join(packageDirectory, 'locale', 'namespaces', 'en', upstream.namespaces[batch.namespace].fileName));
	const values = {};
	for (const key of batch.keys) {
		if (key === omit) continue;
		values[key] = transform(english[key]);
	}
	return {
		schemaVersion: 1,
		batch: id,
		namespace: batch.namespace,
		sourceHash: sourceHash ?? batch.sourceHash,
		values,
	};
}

function writeReviewed(workDirectory, reviewed) {
	writeJson(path.join(workDirectory, 'reviewed.json'), { schemaVersion: 1, reviewed });
}

function englishFileHashes(packageDirectory) {
	const upstream = readJsonFile(path.join(packageDirectory, 'locale', 'upstream.json'));
	const hashes = {};
	for (const [namespace, entry] of Object.entries(upstream.namespaces)) {
		hashes[namespace] = dictionaryHash(readJsonFile(path.join(packageDirectory, 'locale', 'namespaces', 'en', entry.fileName)));
	}
	return hashes;
}

test('generated files are fresh and keep the stage-1 64/2906 snapshot', () => {
	const check = checkArtifacts({ packageDir });
	assert.deepEqual(check.problems, []);
	const { upstream, dictionaries: english } = loadEnglish(packageDir);
	assert.equal(Object.keys(english).length, EXPECTED_NAMESPACES);
	assert.equal(Object.keys(upstream.namespaces).length, EXPECTED_NAMESPACES);
	assert.equal(Object.values(english).reduce((sum, dictionary) => sum + Object.keys(dictionary).length, 0), EXPECTED_KEYS);
	assert.equal(upstream.totals.keys, EXPECTED_KEYS);
	const status = readJsonFile(path.join(packageDir, 'locale', 'translation-status.json'));
	assert.equal(status.status, 'incomplete');
	assert.equal(status.developmentOnlyEnglishFallback, true);
	assert.equal(status.fallbackPolicy, 'development-only-english');
	assert.equal(status.totals.translated, 83);
	assert.equal(status.totals.fallback, 2823);
	assert.equal(status.totals.translatedNamespaces, 3);
});

test('single ownership: one addLanguage(ja) and 64 explicit register calls', () => {
	const source = fs.readFileSync(path.join(packageDir, 'client.js'), 'utf8');
	assert.equal((source.match(/\.addLanguage\(/gu) ?? []).length, 1, 'client.js must own exactly one addLanguage call');
	assert.equal((source.match(/\.register\(/gu) ?? []).length, EXPECTED_NAMESPACES, 'client.js must register every namespace');
	assert.deepEqual(language, { id: 'ja', label: '日本語', fallback: 'en' });
	assert.deepEqual(inject, ['locale']);
	assert.equal(Object.keys(dictionaries).length, EXPECTED_NAMESPACES);

	const javascriptFiles = [];
	const walk = (directory) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === 'work' || entry.name === 'node_modules') continue;
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(file);
			else if (entry.name.endsWith('.js')) javascriptFiles.push(file);
		}
	};
	walk(packageDir);
	const owners = javascriptFiles.filter((file) => fs.readFileSync(file, 'utf8').includes('addLanguage('));
	assert.deepEqual(owners.map((file) => path.relative(packageDir, file)), ['client.js']);
	assert.equal(Object.keys(LOCALE_PACKS.ja.dictionaries).length, 3, 'the existing mobile pack must remain untouched while it is still present');
});

test('apply registers all 64 dictionaries and every effect can dispose its registration', () => {
	const registered = new Map();
	const languages = [];
	const disposers = [];
	const { dictionaries: english } = loadEnglish(packageDir);
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
				registered.set(namespace, dictionary);
				return () => {
					if (registered.get(namespace) === dictionary) registered.delete(namespace);
				};
			},
		},
	};
	apply(ctx);
	assert.equal(languages.length, 1);
	assert.deepEqual(languages[0], { id: 'ja', label: '日本語', fallback: 'en' });
	assert.equal(registered.size, 65);
	assert.equal(disposers.length, 65);
	for (const dispose of disposers) assert.equal(typeof dispose, 'function');
	for (const namespace of Object.keys(dictionaries)) {
		assert.equal(registered.has(namespace), true, 'missing registration for ' + namespace);
		assert.deepEqual(Object.keys(registered.get(namespace)), Object.keys(english[namespace]));
	}
	assert.equal(registered.has('common'), true);
	for (const dispose of disposers) dispose();
	assert.equal(registered.size, 0);
});

test('the 83 migrated values are byte-for-byte the mobile COPY.ja values', () => {
	let total = 0;
	for (const [namespace, source] of Object.entries(LOCALE_PACKS.ja.dictionaries)) {
		const destination = readJsonFile(path.join(packageDir, 'locale', 'namespaces', 'ja', namespace + '.json'));
		assert.deepEqual(Object.keys(destination), Object.keys(source), namespace + ' key order changed');
		for (const [key, value] of Object.entries(source)) {
			assert.equal(destination[key], value, namespace + '.' + key + ' changed');
			total += 1;
		}
	}
	assert.equal(total, 83);
});

test('generated Japanese has en/ja key parity with the incomplete status explicit', () => {
	const { dictionaries: english } = loadEnglish(packageDir);
	const status = readJsonFile(path.join(packageDir, 'locale', 'translation-status.json'));
	let translated = 0;
	for (const [namespace, englishDictionary] of Object.entries(english)) {
		assert.deepEqual(Object.keys(dictionaries[namespace]), Object.keys(englishDictionary), namespace + ' is not in parity with English');
		assert.equal(status.namespaces[namespace].keys, Object.keys(englishDictionary).length);
		let namespaceTranslated = 0;
		for (const [key, englishValue] of Object.entries(englishDictionary)) {
			if (Object.hasOwn(LOCALE_PACKS.ja.dictionaries[namespace] ?? {}, key)) {
				assert.equal(dictionaries[namespace][key], LOCALE_PACKS.ja.dictionaries[namespace][key], namespace + '.' + key + ' lost its reviewed value');
				namespaceTranslated += 1;
			} else {
				assert.equal(dictionaries[namespace][key], englishValue, namespace + '.' + key + ' is neither reviewed nor an English fallback');
			}
		}
		assert.equal(status.namespaces[namespace].translated, namespaceTranslated, namespace + ' translated count is wrong');
		assert.equal(status.namespaces[namespace].fallback, Object.keys(englishDictionary).length - namespaceTranslated, namespace + ' fallback count is wrong');
		translated += namespaceTranslated;
	}
	assert.equal(translated, 83);
	assert.equal(status.totals.translated, translated);
	assert.equal(status.totals.fallback, EXPECTED_KEYS - translated);
	assert.equal(status.status, 'incomplete');
	assert.equal(status.developmentOnlyEnglishFallback, true);
	assert.deepEqual(
		Object.entries(status.namespaces).filter(([, entry]) => entry.translated > 0).map(([namespace]) => namespace).sort(),
		['common', 'settings', 'settings.locale'],
	);
});

test('placeholder preservation holds for every value and a broken placeholder is rejected', (t) => {
	const { dictionaries: english } = loadEnglish(packageDir);
	for (const namespace of Object.keys(english)) {
		for (const key of Object.keys(english[namespace])) {
			assert.deepEqual(placeholders(dictionaries[namespace][key]), placeholders(english[namespace][key]), namespace + '.' + key + ' placeholder mismatch');
		}
	}
	assert.throws(() => assertPlaceholders('fixture', 'key', 'hello {name}', 'hello {other}'), /placeholder/);

	const directory = copyPackageLocale(t);
	const japaneseFile = path.join(directory, 'locale', 'namespaces', 'ja', 'common.json');
	const japanese = readJsonFile(japaneseFile);
	japanese['copy.optionsHint'] = '右クリックでコピー方法を選択';
	writeJson(japaneseFile, japanese);
	assert.throws(() => buildArtifacts({ packageDir: directory }), /placeholder/);
});

test('duplicate JSON keys and duplicate translated values are checked', (t) => {
	assert.throws(() => parseStrictJson('{"a":"one","a":"two"}', 'duplicate.json'), /duplicate key/);
	assert.deepEqual(duplicateValueWarnings('settings', LOCALE_PACKS.ja.dictionaries.settings, loadEnglish(packageDir).dictionaries.settings), [], 'two keys with the same English value are not a duplicate-translation warning');
	assert.equal(duplicateValueWarnings('fixture', { left: '同じ', right: '同じ' }, { left: 'Left', right: 'Right' }).length, 1);
	const directory = copyPackageLocale(t);
	const japaneseFile = path.join(directory, 'locale', 'namespaces', 'ja', 'common.json');
	fs.writeFileSync(japaneseFile, '{\n  "ok": "確定",\n  "ok": "決定"\n}\n');
	assert.throws(() => buildArtifacts({ packageDir: directory }), /duplicate key/);
});

test('batch manifest covers every key once in 40-50 key chunks and hashes the source namespaces', () => {
	const document = readBatchFile(packageDir);
	const { upstream, dictionaries: english } = loadEnglish(packageDir);
	const batches = validateBatchManifest(document, upstream, english);
	assert.equal(batches.size, document.batches.length);
	assert.equal(document.totals.batches, document.batches.length);
	assert.equal(document.totals.keys, EXPECTED_KEYS);
	assert.equal(document.batches.flatMap((batch) => batch.keys).length, EXPECTED_KEYS);
	assert.equal(new Set(document.batches.flatMap((batch) => batch.keys.map((key) => batch.namespace + '\u0000' + key))).size, EXPECTED_KEYS);
	const grouped = new Map();
	for (const batch of document.batches) {
		assert.equal(batch.sourceHash, upstream.namespaces[batch.namespace].sourceHash);
		if (!grouped.has(batch.namespace)) grouped.set(batch.namespace, []);
		grouped.get(batch.namespace).push(batch);
	}
	for (const [namespace, group] of grouped) {
		const count = Object.keys(english[namespace]).length;
		if (count < BATCH_MIN) {
			assert.equal(group.length, 1, namespace + ' should stay in one small batch');
			assert.equal(group[0].keys.length, count);
		} else {
			for (const [index, batch] of group.entries()) {
				assert.equal(batch.keys.length <= BATCH_MAX, true, batch.id + ' exceeds the maximum');
				if (index < group.length - 1) assert.equal(batch.keys.length >= BATCH_MIN, true, batch.id + ' is below the minimum before the final chunk');
			}
		}
	}
});

test('merge applies only reviewed batches, preserves English, and ignores unreviewed outputs', (t) => {
	const directory = copyPackageLocale(t);
	const workDirectory = path.join(directory, 'work');
	fs.mkdirSync(path.join(workDirectory, 'out'), { recursive: true });
	const beforeEnglish = englishFileHashes(directory);
	const beforeJapanese = readJsonFile(path.join(directory, 'locale', 'namespaces', 'ja', 'common.json'));

	const output = makeOutput(directory, 'common-01');
	writeJson(path.join(workDirectory, 'out', 'common-01.json'), output);
	writeJson(path.join(workDirectory, 'out', 'approval-01.json'), makeOutput(directory, 'approval-01'));
	writeReviewed(workDirectory, { 'common-01': batchById(directory, 'common-01').sourceHash });

	const result = mergeReviewedBatches({ packageDir: directory, workDir: workDirectory });
	assert.deepEqual(result.applied, ['common-01']);
	assert.deepEqual(result.written, [path.join('locale', 'namespaces', 'ja', 'common.json')]);
	assert.equal(result.warnings.some((warning) => warning.includes('ignoring unreviewed output')), true);
	assert.deepEqual(readJsonFile(path.join(directory, 'locale', 'namespaces', 'ja', 'common.json')), output.values);
	assert.equal(fs.existsSync(path.join(directory, 'locale', 'namespaces', 'ja', 'approval.json')), false, 'an unreviewed output must not create a Japanese dictionary');
	assert.deepEqual(englishFileHashes(directory), beforeEnglish, 'merge must never change the English snapshot');
	assert.notDeepEqual(readJsonFile(path.join(directory, 'locale', 'namespaces', 'ja', 'common.json')), beforeJapanese);
});

test('merge is all-or-nothing when one reviewed batch is invalid', (t) => {
	const directory = copyPackageLocale(t);
	const workDirectory = path.join(directory, 'work');
	fs.mkdirSync(path.join(workDirectory, 'out'), { recursive: true });
	const beforeJapanese = readJsonFile(path.join(directory, 'locale', 'namespaces', 'ja', 'common.json'));
	writeJson(path.join(workDirectory, 'out', 'common-01.json'), makeOutput(directory, 'common-01'));
	writeJson(path.join(workDirectory, 'out', 'approval-01.json'), makeOutput(directory, 'approval-01', { omit: batchById(directory, 'approval-01').keys[0] }));
	writeReviewed(workDirectory, {
		'common-01': batchById(directory, 'common-01').sourceHash,
		'approval-01': batchById(directory, 'approval-01').sourceHash,
	});
	assert.throws(() => mergeReviewedBatches({ packageDir: directory, workDir: workDirectory }), /missing/);
	assert.deepEqual(readJsonFile(path.join(directory, 'locale', 'namespaces', 'ja', 'common.json')), beforeJapanese, 'a later validation failure must not leave an earlier batch applied');
});

test('merge rejects stale source hashes and stale review hashes without writing', (t) => {
	const directory = copyPackageLocale(t);
	const workDirectory = path.join(directory, 'work');
	fs.mkdirSync(path.join(workDirectory, 'out'), { recursive: true });
	const before = readJsonFile(path.join(directory, 'locale', 'namespaces', 'ja', 'common.json'));

	writeJson(path.join(workDirectory, 'out', 'common-01.json'), makeOutput(directory, 'common-01', { sourceHash: 'sha256:' + '0'.repeat(64) }));
	writeReviewed(workDirectory, { 'common-01': batchById(directory, 'common-01').sourceHash });
	assert.throws(() => mergeReviewedBatches({ packageDir: directory, workDir: workDirectory }), /stale output/);
	assert.deepEqual(readJsonFile(path.join(directory, 'locale', 'namespaces', 'ja', 'common.json')), before);

	writeJson(path.join(workDirectory, 'out', 'common-01.json'), makeOutput(directory, 'common-01'));
	writeReviewed(workDirectory, { 'common-01': 'sha256:' + '1'.repeat(64) });
	assert.throws(() => mergeReviewedBatches({ packageDir: directory, workDir: workDirectory }), /stale review/);
	assert.deepEqual(readJsonFile(path.join(directory, 'locale', 'namespaces', 'ja', 'common.json')), before);
});

test('generated --check detects drift in a generated artifact', (t) => {
	const directory = copyPackageLocale(t);
	writeArtifacts(buildArtifacts({ packageDir: directory }));
	assert.deepEqual(checkArtifacts({ packageDir: directory }).problems, []);
	const clientFile = path.join(directory, 'client.js');
	fs.appendFileSync(clientFile, '// drift\n');
	const result = checkArtifacts({ packageDir: directory });
	assert.equal(result.problems.includes('different client.js; run node tools/build-client.mjs'), true);
});

test('work/ is gitignored and is not part of the shipped package files', () => {
	const manifest = readJsonFile(path.join(packageDir, 'package.json'));
	assert.equal(manifest.files.some((file) => file === 'work' || file.startsWith('work/')), false);
	assert.equal(Object.keys(manifest.exports).some((key) => key.includes('work')), false);
	for (const file of manifest.files) assert.equal(file.includes('work'), false, 'work must not be shipped: ' + file);
	const ignored = spawnSync('git', ['check-ignore', '-q', path.join('packages', 'rdsh-locale-ja', 'work', 'out', 'probe.json')], { cwd: path.resolve(packageDir, '..', '..') });
	assert.equal(ignored.status, 0, 'work/out/probe.json must be ignored by git');
	const tracked = execFileSync('git', ['ls-files', 'packages/rdsh-locale-ja/work'], { cwd: path.resolve(packageDir, '..', '..'), encoding: 'utf8' });
	assert.equal(tracked.trim(), '');
});
