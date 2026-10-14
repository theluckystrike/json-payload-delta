export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface DeltaRow { kind: 'added' | 'removed' | 'changed'; path: string; old?: Json; new?: Json }
export interface Delta { rows: DeltaRow[]; incomplete: boolean }
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_DEPTH = 64;
export const MAX_ROWS = 1000;

/** Check limits before JSON.parse. This also checks numbers in repeated keys. */
export function parseStrict(text: string): Json {
	if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Source exceeds 2 MiB.');
	let quoted = false;
	let escaped = false;
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (quoted) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') quoted = false;
			continue;
		}
		if (ch === '"') { quoted = true; continue; }
		if (ch === '{' || ch === '[') {
			if (++depth > MAX_DEPTH) throw new Error('Source exceeds 64 nesting levels.');
		} else if (ch === '}' || ch === ']') depth--;
		else if (ch === '-' || /[0-9]/.test(ch)) {
			const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i))?.[0];
			if (!token) continue;
			const value = Number(token);
			if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Number limit: use finite numbers and safe integers.');
			i += token.length - 1;
		}
	}
	try { return JSON.parse(text) as Json; }
	catch { throw new Error('Invalid strict JSON. Check the source file.'); }
}
export function escapePointer(key: string): string { return key.replace(/~/g, '~0').replace(/\//g, '~1'); }
export function validPointer(path: string): boolean { return (path === '' || path.startsWith('/')) && !/~(?![01])/.test(path); }
export function parseIgnore(text: string): string[] {
	const paths = text.split(/\r?\n/).filter((p) => p.trim().length > 0);
	if (paths.length > 100 || paths.some((p) => !validPointer(p))) throw new Error('Use at most 100 JSON Pointer paths, one per line. Escape ~ as ~0 and / as ~1.');
	return [...new Set(paths)];
}
function object(value: Json): value is { [key: string]: Json } { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function compareJson(old: Json, next: Json, ignore: string[] = []): Delta {
	if (ignore.some((p) => !validPointer(p))) throw new Error('Invalid JSON Pointer.');
	const result: Delta = { rows: [], incomplete: false };
	const add = (row: DeltaRow) => {
		if (result.rows.length === MAX_ROWS) result.incomplete = true;
		else result.rows.push(row);
	};
	const walk = (a: Json | undefined, b: Json | undefined, path: string) => {
		if (result.incomplete || ignore.some((p) => path === p || path.startsWith(p + '/'))) return;
		if (a === undefined) { add({ kind: 'added', path, new: b! }); return; }
		if (b === undefined) { add({ kind: 'removed', path, old: a }); return; }
		if (Array.isArray(a) && Array.isArray(b)) {
			for (let i = 0; i < Math.max(a.length, b.length) && !result.incomplete; i++) walk(a[i], b[i], path + '/' + i);
		} else if (object(a) && object(b)) {
			const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
			for (const key of keys) {
				walk(Object.prototype.hasOwnProperty.call(a, key) ? a[key] : undefined, Object.prototype.hasOwnProperty.call(b, key) ? b[key] : undefined, path + '/' + escapePointer(key));
				if (result.incomplete) break;
			}
		} else if (a !== b) add({ kind: 'changed', path, old: a, new: b });
	};
	walk(old, next, '');
	return result;
}
export function compareText(old: string, next: string, ignore: string[] = []): Delta { return compareJson(parseStrict(old), parseStrict(next), ignore); }
export function literal(value: Json | undefined): string { return value === undefined ? '(missing)' : JSON.stringify(value, null, 2); }
/** A fence longer than the backticks in its text keeps Markdown and HTML literal. */
export function fence(text: string): string {
	const size = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length + 1), 3);
	const marks = '`'.repeat(size);
	return marks + '\n' + text + '\n' + marks;
}
export function report(delta: Delta, oldPath: string, newPath: string, ignore: string[] = []): string {
	const link = (path: string) => path.split('/').map(encodeURIComponent).join('/');
	const lines = ['# JSON Payload Delta', '', '[Old source](<' + link(oldPath) + '>)', '[New source](<' + link(newPath) + '>)', '', delta.incomplete ? 'Incomplete report: only the first 1,000 changes are shown.' : delta.rows.length ? String(delta.rows.length) + ' changes.' : 'No changes.', '', 'Object key order is ignored. Array items are compared by index. The empty pointer is the root.', ''];
	if (ignore.length) lines.push('Ignored pointer paths:', fence(ignore.join('\n')), '');
	for (const row of delta.rows) {
		lines.push('## ' + row.kind, '', 'JSON Pointer:', fence(row.path), '', 'Old value:', fence(literal(row.old)), '', 'New value:', fence(literal(row.new)), '');
	}
	return lines.join('\n');
}
