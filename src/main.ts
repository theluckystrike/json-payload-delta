import { Notice, Plugin, TFile, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, JsonPayloadDeltaSettingTab, normalizeSettings, type JsonPayloadDeltaSettings, type Profile } from './settings';
import { MAX_BYTES, compareText, report, validPointer, type Delta } from './delta';
import { CompareModal } from './modal';
export interface Comparison { delta: Delta; oldPath: string; newPath: string; ignore: string[] }
export default class JsonPayloadDeltaPlugin extends Plugin {
	settings: JsonPayloadDeltaSettings = { profiles: [...DEFAULT_SETTINGS.profiles] };
	pro: SponsorsManager | null = null;
	modal: CompareModal | null = null;
	private profileSave: Promise<void> = Promise.resolve();
	async onload(): Promise<void> {
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new JsonPayloadDeltaSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => { tab.update(); this.modal?.reset(); }));
		this.register(() => this.modal?.close());
		this.addCommand({ id: 'compare', name: 'Compare JSON files', callback: () => this.openCompare() });
		this.app.workspace.onLayoutReady(() => {
			if (this.pro !== pro) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { this.pro = null; resetPro(); }
	openCompare(): void { this.modal?.close(); this.modal = new CompareModal(this); this.modal.open(); }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	private source(path: string): TFile {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'json') throw new Error('Choose a JSON file from the vault.');
		if (file.stat.size > MAX_BYTES) throw new Error('Source exceeds 2 MiB.');
		return file;
	}
	async compare(oldPath: string, newPath: string, profileName = ''): Promise<Comparison> {
		const old = this.source(oldPath), next = this.source(newPath);
		let ignore: string[] = [];
		if (profileName) {
			if (!isPro()) throw new Error('Saved profiles need Pro. Use the file choices for a free comparison.');
			const profile = this.settings.profiles.find((p) => p.name === profileName);
			if (!profile || profile.oldPath !== old.path || profile.newPath !== next.path) throw new Error('The saved profile does not match the selected files.');
			ignore = [...profile.ignore];
		}
		const oldText = await this.app.vault.read(old), newText = await this.app.vault.read(next);
		return { delta: compareText(oldText, newText, ignore), oldPath: old.path, newPath: next.path, ignore };
	}
	async saveProfile(profile: Profile): Promise<void> {
		const save = this.profileSave.then(() => this.writeProfile(profile));
		this.profileSave = save.catch(() => undefined);
		await save;
	}
	private async writeProfile(profile: Profile): Promise<void> {
		if (!isPro()) throw new Error('Saved profiles need Pro.');
		if (!profile.name.trim() || profile.name.length > 80) throw new Error('Use a profile name from 1 to 80 characters.');
		if (profile.ignore.length > 100 || profile.ignore.some((p) => !validPointer(p))) throw new Error('Invalid JSON Pointer paths.');
		this.source(profile.oldPath); this.source(profile.newPath);
		const exists = this.settings.profiles.some((p) => p.name === profile.name);
		if (!exists && this.settings.profiles.length >= 50) throw new Error('The limit is 50 saved profiles.');
		const profiles = this.settings.profiles.filter((p) => p.name !== profile.name);
		profiles.push({ ...profile, ignore: [...profile.ignore] });
		await this.saveData({ profiles }); this.settings = { profiles };
	}
	async createReport(comparison: Comparison): Promise<TFile> {
		const body = report(comparison.delta, comparison.oldPath, comparison.newPath, comparison.ignore);
		for (let n = 1; n <= 10000; n++) {
			const path = normalizePath('JSON Delta' + (n === 1 ? '' : ' ' + n) + '.md');
			if (this.app.vault.getAbstractFileByPath(path)) continue;
			try { return await this.app.vault.create(path, body); }
			catch (error) { if (!this.app.vault.getAbstractFileByPath(path)) throw error; }
		}
		throw new Error('No free report path was found.');
	}
	showError(error: unknown): void { new Notice(error instanceof Error ? error.message : String(error)); }
}
