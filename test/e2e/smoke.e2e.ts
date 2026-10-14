import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
import type JsonPayloadDeltaPlugin from '../../src/main';
describe(`${pluginId} desktop workflow`, function () {
	it('loads and reloads without console errors', async () => {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('opens the command and previews index and pointer changes', async () => {
		await browser.executeObsidianCommand(`${pluginId}:compare`);
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, JsonPayloadDeltaPlugin> } }).plugins.plugins['json-payload-delta']!;
			return !!p.modal?.contentEl.isConnected;
		}), { timeout: 10000 });
		const result = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, JsonPayloadDeltaPlugin> } }).plugins.plugins['json-payload-delta']!;
			const m = p.modal!; m.oldPath = 'old.json'; m.newPath = 'new.json'; await m.preview();
			return { count: m.comparison?.delta.rows.length, paths: m.comparison?.delta.rows.map((r) => r.path), images: m.contentEl.querySelectorAll('img').length };
		});
		expect(result).toEqual({ count: 7, paths: ['/a~1b/~0x', '/generatedAt', '/items/0', '/items/1', '/newField', '/retired', '/user/age'], images: 0 });
	});
	it('writes a numbered report and keeps sources unchanged', async () => {
		const result = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, JsonPayloadDeltaPlugin> } }).plugins.plugins['json-payload-delta']!;
			if (!app.vault.getAbstractFileByPath('JSON Delta.md')) await app.vault.create('JSON Delta.md', 'Existing report');
			const before = await p.compare('old.json', 'new.json');
			const f = await p.createReport(before);
			const after = await p.compare('old.json', 'new.json');
			return { path: f.path, same: JSON.stringify(before) === JSON.stringify(after), hasLinks: (await app.vault.read(f)).includes('[Old source](<old.json>)') };
		});
		expect(result).toEqual({ path: 'JSON Delta 2.md', same: true, hasLinks: true });
	});
	it('keeps HTML and backticks literal in preview and report', async () => {
		const result = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, JsonPayloadDeltaPlugin> } }).plugins.plugins['json-payload-delta']!;
			const attack = '<img src="https://example.com/x"> and ```';
			await app.vault.create('literal-old.json', '"before"'); await app.vault.create('literal-new.json', JSON.stringify(attack));
			p.openCompare(); const m = p.modal!; m.oldPath = 'literal-old.json'; m.newPath = 'literal-new.json'; await m.preview();
			const f = await p.createReport(m.comparison!); const text = await app.vault.read(f);
			return { literal: m.contentEl.textContent?.includes(JSON.stringify(attack, null, 2)), images: m.contentEl.querySelectorAll('img').length, fence: text.includes('````'), value: text.includes(JSON.stringify(attack)) };
		});
		expect(result).toEqual({ literal: true, images: 0, fence: true, value: true });
	});
	it('rejects a parse error and blocks a Pro profile without a sponsor state', async () => {
		const result = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, JsonPayloadDeltaPlugin> } }).plugins.plugins['json-payload-delta']!;
			await app.vault.create('bad.json', '1e999');
			const count = app.vault.getFiles().length; let parse = false, locked = false;
			try { await p.compare('old.json', 'bad.json'); } catch { parse = true; }
			try { await p.saveProfile({ name: 'Locked', oldPath: 'old.json', newPath: 'new.json', ignore: [] }); } catch { locked = true; }
			return { parse, locked, unchanged: count === app.vault.getFiles().length };
		});
		expect(result).toEqual({ parse: true, locked: true, unchanged: true });
	});
});
