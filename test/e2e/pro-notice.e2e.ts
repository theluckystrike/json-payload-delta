import { browser, expect } from '@wdio/globals';
import type { SponsorsManager } from '../../src/license/index';
import type JsonPayloadDeltaPlugin from '../../src/main';
import { pluginId } from './load';

// A free user can select Save profile in the Saved profiles (Pro) part of the compare window. The select shows the
// shared Pro notice with the "Sponsor on GitHub" button and saves nothing. A Pro user saves the pair.
type Host = { plugins: { plugins: Record<string, JsonPayloadDeltaPlugin & { pro: SponsorsManager }> } };
const LEAD = 'Saved profiles need Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled, id) => {
		const pro = (app as unknown as Host).plugins.plugins[id]!.pro;
		if (!enabled) { pro.signOut(); return pro.isPro(); }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
		return pro.isPro();
	}, on, pluginId);
}

async function openWindow(): Promise<void> {
	await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
	await browser.executeObsidianCommand(`${pluginId}:compare`);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, id) => !!(app as unknown as Host).plugins.plugins[id]!.modal?.contentEl.isConnected, pluginId), { timeout: 10000, timeoutMsg: 'The compare window did not open' });
	await browser.executeObsidian(({ app }, id) => {
		const m = (app as unknown as Host).plugins.plugins[id]!.modal!;
		m.oldPath = 'old.json'; m.newPath = 'new.json'; m.reset();
		m.contentEl.querySelector('details')!.open = true;
	}, pluginId);
}

/** Types a profile name, selects Save profile, then reads the notices and the saved data. */
async function save(name: string) {
	const field = browser.$('//div[contains(@class,"setting-item")][.//div[contains(@class,"setting-item-name") and text()="Profile name (Pro)"]]//input');
	await field.click();
	await browser.keys(name);
	await browser.$('button=Save profile').click();
	await browser.pause(500);
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as Host).plugins.plugins[id]!;
		return {
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			profiles: p.settings.profiles.map((x) => x.name),
			saved: JSON.stringify((await p.loadData()) ?? {}),
		};
	}, pluginId);
}

describe('Saved profiles (Pro) in the compare window', function () {
	let original = '';
	before(async () => {
		original = await browser.executeObsidian(({ app }, id) => JSON.stringify((app as unknown as Host).plugins.plugins[id]!.settings), pluginId);
	});
	afterEach(async () => {
		await browser.executeObsidian(async ({ app }, id, original) => {
			const p = (app as unknown as Host).plugins.plugins[id]!;
			p.modal?.close();
			p.settings = JSON.parse(original) as typeof p.settings;
			await p.saveData(p.settings);
		}, pluginId, original);
		await setPro(false);
	});

	it('a free user who selects Save profile gets a Pro notice with a Sponsor button, and nothing is saved', async () => {
		expect(await setPro(false)).toBe(false);
		await openWindow();
		const before = await browser.executeObsidian(async ({ app }, id) => JSON.stringify((await (app as unknown as Host).plugins.plugins[id]!.loadData()) ?? {}), pluginId);
		const after = await save('Weekly');
		if (!after.notices.some((n) => n.text.includes(LEAD) && n.sponsor === 1)) throw new Error(`No Pro notice after Save profile: ${JSON.stringify(after.notices)}`);
		expect(after.profiles).toEqual(JSON.parse(original).profiles.map((x: { name: string }) => x.name));
		expect(after.saved).toBe(before);
	});

	it('a Pro user who selects Save profile saves the pair, with no Sponsor notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openWindow();
		const after = await save('Weekly');
		expect(after.profiles).toContain('Weekly');
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
