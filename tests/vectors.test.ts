import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import vectors from './vectors.json';
import { compareText, parseStrict, report } from '../src/delta';
import JsonPayloadDeltaPlugin from '../src/main';
import { App } from 'obsidian-test-mocks/obsidian';
import manifest from '../manifest.json';
function input(value: unknown): string {
	if (typeof value === 'string') return value;
	const v = value as { repeat?: string; count?: number; depth?: number; array?: number; value?: number };
	if (v.depth) return '['.repeat(v.depth) + '0' + ']'.repeat(v.depth);
	if (v.array) return JSON.stringify(Array.from({ length: v.array }, () => v.value));
	return v.repeat!.repeat(v.count!);
}
describe('golden acceptance vectors', () => {
	it.skipIf(!existsSync('../../packages/spec/vectors/json-payload-delta.json'))('the portable copy matches the factory vectors', () => {
		expect(JSON.parse(readFileSync('../../packages/spec/vectors/json-payload-delta.json', 'utf8'))).toEqual(vectors);
	});
	for (const raw of vectors.cases) {
		const c = raw as { name: string; function?: string; args: unknown[]; expected: unknown };
		it(c.name, async () => {
			const want = c.expected as { error?: string; depth?: number; count?: number; incomplete?: boolean };
			if (c.function === 'vault') {
				const app = App.createConfigured__({ files: { 'old.json': input(c.args[0]), 'new.json': input(c.args[1]), 'JSON Delta.md': 'Existing report' } });
				const plugin = new JsonPayloadDeltaPlugin(app as never, manifest as never);
				const file = await plugin.createReport(await plugin.compare('old.json', 'new.json'));
				expect({ path: file.path, old: await app.vault.read(app.vault.getAbstractFileByPath('old.json') as never), new: await app.vault.read(app.vault.getAbstractFileByPath('new.json') as never) }).toEqual(want);
				expect(await app.vault.read(app.vault.getAbstractFileByPath('JSON Delta.md') as never)).toBe('Existing report');
			} else if (c.function === 'literalReport') {
				const value = input(c.args[0]);
				const text = report(compareText('"before"', JSON.stringify(value)), 'old.json', 'new.json');
				expect({ literal: text.includes(JSON.stringify(value, null, 2)), fenced: text.includes('````'), sourceLinks: text.includes('[Old source](<old.json>)') && text.includes('[New source](<new.json>)') }).toEqual(want);
			} else if (c.function === 'parseStrict') {
				if (want.error) expect(() => parseStrict(input(c.args[0]))).toThrow(want.error);
				else { let value = parseStrict(input(c.args[0])); let depth = 0; while (Array.isArray(value)) { depth++; value = value[0]!; } expect({ depth }).toEqual(want); }
			} else {
				const result = compareText(input(c.args[0]), input(c.args[1]), c.args[2] as string[]);
				expect(want.count !== undefined ? { count: result.rows.length, incomplete: result.incomplete } : result).toEqual(want);
			}
		});
	}
});
