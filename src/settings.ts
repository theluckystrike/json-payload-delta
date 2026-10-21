import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import { validPointer } from './delta';
import type JsonPayloadDeltaPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface Profile { name: string; oldPath: string; newPath: string; ignore: string[] }
export interface JsonPayloadDeltaSettings { profiles: Profile[] }
export const DEFAULT_SETTINGS: JsonPayloadDeltaSettings = { profiles: [] };
export function normalizeSettings(saved: unknown): JsonPayloadDeltaSettings {
	const profiles: Profile[] = [];
	if (saved && typeof saved === 'object' && 'profiles' in saved && Array.isArray(saved.profiles)) {
		for (const value of saved.profiles as unknown[]) {
			if (!value || typeof value !== 'object') continue;
			const p = value as Partial<Profile>;
			if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || typeof p.oldPath !== 'string' || typeof p.newPath !== 'string' || !Array.isArray(p.ignore) || p.ignore.length > 100 || p.ignore.some((x) => typeof x !== 'string' || !validPointer(x))) continue;
			if (profiles.some((x) => x.name === p.name)) continue;
			profiles.push({ name: p.name, oldPath: p.oldPath, newPath: p.newPath, ignore: [...p.ignore] });
			if (profiles.length === 50) break;
		}
	}
	return { profiles };
}
export class JsonPayloadDeltaSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private owner: JsonPayloadDeltaPlugin) { super(app, owner); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Comparison limits', desc: 'Each file: 2 MiB and 64 nesting levels. A preview shows up to 1,000 changes. Open Compare JSON files to choose sources and manage saved profiles.' },
			...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
		];
	}
}
