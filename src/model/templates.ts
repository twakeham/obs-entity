import type { EntityTypeDef } from "./types";

export interface TemplateContext {
	name: string;
	type: EntityTypeDef;
	/** field values as display strings, keyed by field key */
	fields?: Record<string, string>;
	/** date formatter (e.g. moment): receives a format string, returns the formatted current date */
	formatDate: (format: string) => string;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][\w]*)(?::([^}]*))?\s*\}\}/g;

/**
 * Render a template. Supported placeholders:
 *   {{name}} {{title}} {{type}} {{date}} {{date:FORMAT}} {{time}} {{<field_key>}}
 * Unknown placeholders are left untouched so other template engines can still process them.
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
	const fieldKeys = new Set(ctx.type.fields.map((f) => f.key));
	return template.replace(PLACEHOLDER, (match, rawKey: string, arg: string | undefined) => {
		switch (rawKey.toLowerCase()) {
			case "name":
			case "title":
				return ctx.name;
			case "type":
				return ctx.type.name;
			case "date":
				return ctx.formatDate(arg?.trim() || "YYYY-MM-DD");
			case "time":
				return ctx.formatDate(arg?.trim() || "HH:mm");
		}
		if (fieldKeys.has(rawKey)) return ctx.fields?.[rawKey] ?? "";
		return match;
	});
}

export const GENERIC_SECTIONS = ["Overview", "Details", "Notes"];

/**
 * Built-in default template for a type, used when no template file exists in the vault.
 * No H1: Obsidian's inline title already shows the note name.
 */
export function defaultTemplate(type: EntityTypeDef): string {
	const sections = type.sections && type.sections.length > 0 ? type.sections : GENERIC_SECTIONS;
	return sections.map((s) => `## ${s}\n\n`).join("").trimEnd() + "\n";
}
