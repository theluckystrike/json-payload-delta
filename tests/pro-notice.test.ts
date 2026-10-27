import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import JsonPayloadDeltaPlugin from '../src/main';
import { PRO_PROFILES, bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select the Saved profiles (Pro) controls of the compare window. Save profile and a saved pair show
// the shared Pro notice with the "Sponsor on GitHub" button. No profile is saved or selected.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'json-payload-delta' },
	} as unknown as SponsorsManager;
}

function setup(pro: boolean) {
	const p = new JsonPayloadDeltaPlugin(App.createConfigured__({ files: { 'old.json': '{}', 'new.json': '{"a":1}' } }) as never, manifest as never);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const saveData = vi.spyOn(p, 'saveData').mockResolvedValue(undefined);
	return { p, shown, saveData };
}
const saveButton = (el: HTMLElement) => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Save profile')!;
const row = (el: HTMLElement, name: string) => [...el.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name)!;

describe('Saved profiles (Pro) in the compare window', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects Save profile or a saved pair gets the Pro notice with a Sponsor button, and nothing is saved or selected', async () => {
		const { p, shown, saveData } = setup(false);
		// A lapsed sponsor keeps a saved pair in the list.
		p.settings = { profiles: [{ name: 'Kept', oldPath: 'old.json', newPath: 'new.json', ignore: ['/a'] }] };
		const before = JSON.stringify(p.settings);
		p.openCompare();
		const m = p.modal!; m.oldPath = 'old.json'; m.newPath = 'new.json'; m.reset();
		const saveProfile = vi.spyOn(p, 'saveProfile');
		// The draft fields and the button can be selected.
		expect(row(m.contentEl, 'Profile name (Pro)').querySelector('input')!.disabled).toBe(false);
		expect(row(m.contentEl, 'Ignore pointer paths (Pro)').querySelector('textarea')!.disabled).toBe(false);
		m.draftName = 'Draft';
		expect(saveButton(m.contentEl).disabled).toBe(false);
		saveButton(m.contentEl).click();
		const select = row(m.contentEl, 'Saved file pairs (Pro)').querySelector('select')!;
		expect(select.disabled).toBe(false);
		select.value = 'Kept'; select.dispatchEvent(new Event('change'));
		expect(shown).toEqual([
			{ text: `${PRO_PROFILES} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${PRO_PROFILES} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(saveProfile).not.toHaveBeenCalled();
		expect(saveData).not.toHaveBeenCalled();
		expect(JSON.stringify(p.settings)).toBe(before);
		// The dropdown shows its true value: no saved profile. The ignore paths of the pair do not load.
		expect(m.profileName).toBe('');
		expect(row(m.contentEl, 'Saved file pairs (Pro)').querySelector('select')!.value).toBe('');
		expect(m.draftIgnore).toBe('');
		// The free comparison still runs.
		await m.preview();
		expect(m.comparison?.delta.rows.length).toBe(1);
		m.close();
	});

	it('a Pro user who selects Save profile saves the pair, with no Pro notice', async () => {
		const { p, shown } = setup(true);
		p.openCompare();
		const m = p.modal!; m.oldPath = 'old.json'; m.newPath = 'new.json'; m.draftName = 'First'; m.reset();
		saveButton(m.contentEl).click();
		await vi.waitFor(() => { expect(p.settings.profiles.map((x) => x.name)).toEqual(['First']); });
		expect(shown).toEqual([]);
		m.close();
	});
});
