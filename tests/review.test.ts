import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import * as obsidian from 'obsidian';
import JsonPayloadDeltaPlugin from '../src/main';
import { MAX_BYTES, compareText, parseIgnore, parseStrict, report } from '../src/delta';
import { bindPro, resetPro } from '../src/pro';
import { JsonPayloadDeltaSettingTab } from '../src/settings';
import manifest from '../manifest.json';

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return { ...actual, requestUrl: vi.fn(() => { throw new Error('Network disabled'); }) };
});
afterEach(() => { resetPro(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function plugin() {
	return new JsonPayloadDeltaPlugin(App.createConfigured__({ files: { 'old.json': '{}', 'new.json': '{"a":1}' } }) as never, manifest as never);
}
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}
function enablePro() { bindPro({ isPro: () => true, onChange: () => () => undefined } as never); }

describe('review regressions', () => {
	it('keeps spaces in ignored keys and shows the other changed key', () => {
		const ignore = parseIgnore('/a \r\n/ \n');
		expect(ignore).toEqual(['/a ', '/ ']);
		expect(compareText('{"a":1,"a ":1," ":1}', '{"a":2,"a ":2," ":2}', ignore).rows).toEqual([
			{ kind: 'changed', path: '/a', old: 1, new: 2 },
		]);
	});
	it('keeps both profiles when saves overlap', async () => {
		const p = plugin(); enablePro();
		const pending = deferred();
		const save = vi.spyOn(p, 'saveData').mockImplementationOnce(() => pending.promise).mockResolvedValue(undefined);
		const first = p.saveProfile({ name: 'First', oldPath: 'old.json', newPath: 'new.json', ignore: [] });
		const second = p.saveProfile({ name: 'Second', oldPath: 'old.json', newPath: 'new.json', ignore: ['/a'] });
		pending.resolve(); await Promise.all([first, second]);
		expect(p.settings.profiles.map((profile) => profile.name)).toEqual(['First', 'Second']);
		expect(save.mock.calls.at(-1)?.[0]).toEqual(p.settings);
	});
	it('can save again after a failed profile write', async () => {
		const p = plugin(); enablePro();
		vi.spyOn(p, 'saveData').mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
		await expect(p.saveProfile({ name: 'Failed', oldPath: 'old.json', newPath: 'new.json', ignore: [] })).rejects.toThrow('Disk full');
		await p.saveProfile({ name: 'Saved', oldPath: 'old.json', newPath: 'new.json', ignore: [] });
		expect(p.settings.profiles.map((profile) => profile.name)).toEqual(['Saved']);
	});
	it('does not start a timer when layout becomes ready after unload', async () => {
		const p = plugin();
		let ready!: () => unknown;
		vi.spyOn(p.app.workspace, 'onLayoutReady').mockImplementation((callback) => { ready = callback; });
		const interval = vi.spyOn(window, 'setInterval').mockReturnValue(123);
		await p.onload(); p.onunload(); ready();
		expect(interval).not.toHaveBeenCalled();
	});
	it('does not select a saved pair after the user changes a source', async () => {
		const p = plugin(); enablePro(); p.openCompare();
		const m = p.modal!; m.oldPath = 'old.json'; m.newPath = 'new.json'; m.draftName = 'First'; m.reset();
		const pending = deferred();
		const save = vi.spyOn(p, 'saveProfile').mockImplementation(() => pending.promise);
		const button = [...m.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Save profile')!;
		button.click(); expect(save).toHaveBeenCalledOnce();
		const source = m.contentEl.querySelector<HTMLSelectElement>('[data-side="oldPath"]')!;
		source.value = 'new.json'; source.dispatchEvent(new Event('change'));
		pending.resolve(); await pending.promise; await Promise.resolve();
		expect(m.profileName).toBe(''); expect(m.oldPath).toBe('new.json'); m.close();
	});
	it('loads and creates a free report with network calls refused', async () => {
		const p = plugin();
		const request = vi.mocked(obsidian.requestUrl);
		vi.spyOn(window, 'setInterval').mockReturnValue(123);
		vi.spyOn(p.app.workspace, 'onLayoutReady').mockImplementation((callback) => { callback(); });
		await p.onload();
		const settings = new JsonPayloadDeltaSettingTab(p.app, p).getSettingDefinitions();
		expect(settings[0]).toMatchObject({ name: 'Comparison limits' });
		const comparison = await p.compare('old.json', 'new.json');
		const file = await p.createReport(comparison);
		expect(await p.app.vault.read(file)).toContain('1 changes.');
		expect(request).not.toHaveBeenCalled(); p.onunload();
	});
	it('selects the latest profile when two dialog saves overlap', async () => {
		const p = plugin(); enablePro(); p.openCompare();
		const m = p.modal!; m.oldPath = 'old.json'; m.newPath = 'new.json'; m.draftName = 'First'; m.reset();
		const first = deferred(), second = deferred();
		vi.spyOn(p, 'saveProfile').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
		const button = [...m.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Save profile')!;
		button.click(); m.draftName = 'Second'; button.click();
		first.resolve(); await first.promise; await Promise.resolve();
		second.resolve(); await second.promise; await Promise.resolve();
		expect(m.profileName).toBe('Second'); m.close();
	});
	it('keeps a report snapshot after a source edit', async () => {
		const p = plugin();
		const before = await p.compare('old.json', 'new.json');
		const source = p.app.vault.getAbstractFileByPath('new.json')!;
		await p.app.vault.delete(source); await p.app.vault.create('new.json', '{"a":2}');
		const file = await p.createReport(before);
		expect(await p.app.vault.read(file)).toBe(report(before.delta, 'old.json', 'new.json'));
		expect((await p.compare('old.json', 'new.json')).delta.rows[0]?.new).toBe(2);
	});
	it('accepts exactly 2 MiB of UTF-8 and rejects the next character', () => {
		const value = 'é'.repeat((MAX_BYTES - 2) / 2);
		expect(parseStrict(JSON.stringify(value))).toBe(value);
		expect(() => parseStrict(JSON.stringify(value + 'é'))).toThrow('Source exceeds 2 MiB');
	});
	it.each(['{}', '[]', '"text"', '0.25', 'true', 'null'])('accepts the root value %s', (text) => {
		expect(parseStrict(text)).toEqual(JSON.parse(text));
	});
	it.each(['{"a":1,}', '{a:1}', '// comment\n{}'])('rejects non JSON syntax %s', (text) => {
		expect(() => parseStrict(text)).toThrow('Invalid strict JSON');
	});
	it('shows a removed object as one value', () => {
		expect(compareText('{"a":{"b":1}}', '{}').rows).toEqual([{ kind: 'removed', path: '/a', old: { b: 1 } }]);
	});
	it.each([
		['{}', '{"user":{"age":20}}', 'added'],
		['{"user":{"age":20}}', '{}', 'removed'],
		['{"user":{"age":20}}', '{"user":null}', 'changed'],
	])('shows an %s to %s parent change despite a child ignore', (old, next, kind) => {
		expect(compareText(old!, next!, ['/user/age']).rows).toMatchObject([{ kind, path: '/user' }]);
	});
	it('applies profile name, count, and pointer limits without losing saved pairs', async () => {
		const p = plugin(); enablePro(); vi.spyOn(p, 'saveData').mockResolvedValue(undefined);
		const profile = { name: 'x'.repeat(80), oldPath: 'old.json', newPath: 'new.json', ignore: Array.from({ length: 100 }, (_, i) => '/' + i) };
		await p.saveProfile(profile);
		await expect(p.saveProfile({ ...profile, name: 'x'.repeat(81) })).rejects.toThrow('80 characters');
		await expect(p.saveProfile({ ...profile, ignore: [...profile.ignore, '/extra'] })).rejects.toThrow('JSON Pointer');
		for (let i = 1; i < 50; i++) await p.saveProfile({ ...profile, name: String(i) });
		await expect(p.saveProfile({ ...profile, name: 'extra' })).rejects.toThrow('50 saved profiles');
		await p.saveProfile({ ...profile, ignore: [] });
		expect(p.settings.profiles).toHaveLength(50);
		expect(p.settings.profiles.find((p) => p.name === profile.name)?.ignore).toEqual([]);
	});
	it('sends only the sponsor query when a signed-in account needs a check', async () => {
		const p = plugin();
		p.app.secretStorage.setSecret('json-payload-delta-github-token', 'gho_' + '0'.repeat(36));
		p.app.saveLocalStorage('json-payload-delta-github-sponsors', { status: 'unchecked' });
		vi.spyOn(window, 'setInterval').mockReturnValue(123);
		vi.spyOn(p.app.workspace, 'onLayoutReady').mockImplementation((callback) => { callback(); });
		const request = vi.mocked(obsidian.requestUrl);
		await p.onload(); await p.pro!.refresh();
		const comparison = await p.compare('old.json', 'new.json'); await p.createReport(comparison);
		expect(request).toHaveBeenCalledOnce();
		const sent = request.mock.calls[0]![0] as obsidian.RequestUrlParam;
		expect(sent.url).toBe('https://api.github.com/graphql');
		expect(JSON.parse(sent.body as string)).toMatchObject({ variables: { login: 'theluckystrike' } });
		expect(sent.body).not.toContain('old.json'); expect(sent.body).not.toContain('new.json');
		p.onunload();
	});
});
