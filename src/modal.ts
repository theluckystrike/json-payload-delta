import { Modal, Setting } from 'obsidian';
import type JsonPayloadDeltaPlugin from './main';
import type { Comparison } from './main';
import { literal, parseIgnore } from './delta';
import { isPro } from './pro';
/** Use one suffix for the paid feature labels. */
function proName(label: string): string { return `${label} (Pro)`; }
export class CompareModal extends Modal {
	oldPath = '';
	newPath = '';
	profileName = '';
	draftName = '';
	draftIgnore = '';
	comparison: Comparison | null = null;
	private revision = 0;
	private busy = false;
	constructor(private plugin: JsonPayloadDeltaPlugin) { super(plugin.app); }
	onOpen(): void { this.render(); }
	onClose(): void { this.revision++; this.contentEl.empty(); if (this.plugin.modal === this) this.plugin.modal = null; }
	reset(): void { this.revision++; this.comparison = null; this.render(); }
	private render(): void {
		const el = this.contentEl;
		el.empty(); el.addClass('json-payload-delta');
		this.titleEl.setText(this.plugin.manifest.name);
		el.createEl('p', { text: 'Choose two vault JSON files. Object key order is ignored. Array items use their index.' });
		const files = this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === 'json').sort((a, b) => a.path.localeCompare(b.path));
		for (const side of ['oldPath', 'newPath'] as const) {
			new Setting(el).setName(side === 'oldPath' ? 'Old JSON file' : 'New JSON file').addDropdown((d) => {
				d.addOption('', 'Choose a file');
				for (const file of files) d.addOption(file.path, file.path);
				d.setValue(this[side]).onChange((value) => { this[side] = value; this.profileName = ''; this.reset(); });
				d.selectEl.setAttribute('data-side', side);
			});
		}
		const details = el.createEl('details', { cls: 'jpd-profiles' });
		details.open = isPro() && !!(this.profileName || this.draftName);
		details.createEl('summary', { text: proName('Saved profiles') });
		const proEl = details.createDiv();
		new Setting(proEl).setName(proName('Saved file pairs')).addDropdown((d) => {
			d.addOption('', 'No saved profile');
			for (const p of this.plugin.settings.profiles) d.addOption(p.name, p.name);
			d.setValue(this.profileName).setDisabled(!isPro()).onChange((name) => {
				const p = this.plugin.settings.profiles.find((p) => p.name === name);
				this.profileName = name;
				if (p) { this.oldPath = p.oldPath; this.newPath = p.newPath; this.draftName = p.name; this.draftIgnore = p.ignore.join('\n'); }
				this.reset();
			});
		});
		new Setting(proEl).setName(proName('Profile name')).addText((t) => t.setValue(this.draftName).setDisabled(!isPro()).onChange((v) => { this.draftName = v; }));
		new Setting(proEl).setName(proName('Ignore pointer paths')).setDesc('One path per line. Save the profile to apply these paths and their children.').addTextArea((t) => t.setValue(this.draftIgnore).setDisabled(!isPro()).onChange((v) => { this.draftIgnore = v; }));
		new Setting(proEl).setName(proName('Save file pair')).addButton((b) => b.setButtonText('Save profile').setDisabled(!isPro() || this.busy).onClick(async () => {
			const revision = ++this.revision;
			const name = this.draftName.trim();
			try {
				await this.plugin.saveProfile({ name, oldPath: this.oldPath, newPath: this.newPath, ignore: parseIgnore(this.draftIgnore) });
				if (revision !== this.revision || !isPro()) return;
				this.profileName = name; this.reset();
			} catch (error) { if (revision === this.revision) this.error(error); }
		}));
		new Setting(el).setName('Compare sources').addButton((b) => b.setButtonText('Preview changes').setCta().setDisabled(this.busy).onClick(() => this.preview()));
		new Setting(el).setName('New report note').addButton((b) => b.setButtonText('Create report').setDisabled(this.busy || !this.comparison).onClick(() => this.saveReport()));
		if (!this.comparison) return;
		const { delta, ignore } = this.comparison;
		const preview = el.createDiv({ cls: 'jpd-preview' });
		preview.createEl('p', { cls: 'jpd-summary', text: delta.incomplete ? 'Incomplete report: only the first 1,000 changes are shown.' : delta.rows.length ? delta.rows.length + ' changes.' : 'No changes.' });
		if (ignore.length) preview.createEl('pre', { text: 'Ignored paths: ' + ignore.join(', ') });
		for (const row of delta.rows) {
			const item = preview.createDiv({ cls: 'jpd-row' });
			item.createEl('strong', { text: row.kind + ' ' + (row.path || '(root)') });
			item.createDiv({ text: 'Old value' }); item.createEl('pre', { text: literal(row.old) });
			item.createDiv({ text: 'New value' }); item.createEl('pre', { text: literal(row.new) });
		}
	}
	private error(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.contentEl.createEl('p', { cls: 'jpd-error', text: message }); this.plugin.showError(error);
	}
	async preview(): Promise<void> {
		if (this.busy) return;
		this.busy = true; this.comparison = null; const revision = ++this.revision; this.render();
		try {
			const result = await this.plugin.compare(this.oldPath, this.newPath, this.profileName);
			if (revision === this.revision) this.comparison = result;
		} catch (error) {
			if (revision === this.revision) { this.busy = false; this.render(); this.error(error); return; }
		}
		this.busy = false; if (this.contentEl.isConnected) this.render();
	}
	async saveReport(): Promise<void> {
		if (this.busy || !this.comparison) return;
		this.busy = true; this.render();
		try {
			const file = await this.plugin.createReport(this.comparison);
			this.close(); await this.app.workspace.openLinkText(file.path, '', false);
		} catch (error) { this.busy = false; this.render(); this.error(error); }
	}
}
