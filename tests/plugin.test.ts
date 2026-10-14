import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import JsonPayloadDeltaPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { SPONSORS, bindPro, isPro, resetPro } from '../src/pro';
import { fence, parseIgnore, report } from '../src/delta';
import manifest from '../manifest.json';
afterEach(resetPro);
function plugin(files = { 'old.json': '{}', 'new.json': '{"a":null}' }) {
	const app = App.createConfigured__({ files });
	return new JsonPayloadDeltaPlugin(app as never, manifest as never);
}
function pro(on: boolean) { bindPro({ isPro: () => on, onChange: () => () => undefined } as never); }
describe('vault workflow and Pro guard', () => {
	it('loads defaults and repairs bad settings', async () => {
		const p = plugin(); await p.loadSettings(); expect(p.settings).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ profiles: [null, {}, { name: 'x', oldPath: 'a', newPath: 'b', ignore: ['/bad~'] }] })).toEqual(DEFAULT_SETTINGS);
	});
	it('blocks saving profiles without Pro and keeps free comparison available', async () => {
		const p = plugin(); expect(isPro()).toBe(false);
		await expect(p.saveProfile({ name: 'x', oldPath: 'old.json', newPath: 'new.json', ignore: [] })).rejects.toThrow('Pro');
		expect((await p.compare('old.json', 'new.json')).delta.rows).toHaveLength(1);
	});
	it('stores named pairs, applies ignored paths, and rejects profile use after Pro is off', async () => {
		const p = plugin(); pro(true);
		vi.spyOn(p, 'saveData').mockResolvedValue(undefined);
		await p.saveProfile({ name: 'Sample', oldPath: 'old.json', newPath: 'new.json', ignore: ['/a'] });
		expect((await p.compare('old.json', 'new.json', 'Sample')).delta.rows).toEqual([]);
		pro(false);
		await expect(p.compare('old.json', 'new.json', 'Sample')).rejects.toThrow('Pro');
		expect((await p.compare('old.json', 'new.json')).delta.rows).toHaveLength(1);
		expect(p.settings.profiles).toHaveLength(1);
	});
	it('does not create a report for parse errors', async () => {
		const p = plugin({ 'old.json': '{}', 'new.json': '1e999' }); const create = vi.spyOn(p.app.vault, 'create');
		await expect(p.compare('old.json', 'new.json')).rejects.toThrow('Number limit'); expect(create).not.toHaveBeenCalled();
	});
	it('rejects a missing file and a non JSON file', async () => {
		const p = plugin(); await expect(p.compare('missing.json', 'new.json')).rejects.toThrow('Choose a JSON');
	});
	it('checks the sponsor terms', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, sponsorLogin: 'theluckystrike' });
	});
	it('escapes report source paths and uses fences longer than input runs', () => {
		expect(fence('```\n<img>')).toBe('````\n```\n<img>\n````');
		expect(report({ rows: [], incomplete: false }, 'a#x].json', 'b (2).json')).toContain('a%23x%5D.json');
		expect(parseIgnore('/a~1b\n/a~1b')).toEqual(['/a~1b']); expect(() => parseIgnore('/bad~2')).toThrow('JSON Pointer');
	});
});
