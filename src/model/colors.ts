/**
 * Colours for choice values and statuses: one of a small palette that follows the theme (Obsidian's --color-*
 * variables). Unset means the standard look: plain choices, and statuses coloured by their name (`statusTone`).
 */
import type { EntityTypeDef, FieldDef, GroupDef } from "./types";

export const PALETTE = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "grey"] as const;
export type PaletteColor = (typeof PALETTE)[number];
export const PALETTE_LABELS: Record<PaletteColor, string> = { red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple", pink: "Pink", grey: "Grey" };

export const isPaletteColor = (v: unknown): v is PaletteColor => typeof v === "string" && (PALETTE as readonly string[]).includes(v);

/** Colour per value (choices or statuses), as stored. */
export type ColorMap = Partial<Record<string, PaletteColor>>;

/** A value's colour in a map: its exact name, else ignoring case (a note may write "high" for "High"). */
function lookup(map: ColorMap | undefined, value: string): PaletteColor | null {
	if (!map) return null;
	const exact = map[value];
	if (isPaletteColor(exact)) return exact;
	const lower = value.toLowerCase();
	for (const [k, c] of Object.entries(map)) if (k.toLowerCase() === lower && isPaletteColor(c)) return c;
	return null;
}

/** A choice value's colour on a choice / multiple-choice field (null: the standard look). */
export const choiceColor = (f: Pick<FieldDef, "colors"> | undefined, value: string): PaletteColor | null => lookup(f?.colors, value);

/**
 * A status's colour (null: the standard look, coloured by name): the type's own colours (types with their own
 * statuses), else its group's.
 */
export function statusColor(status: string, type: Pick<EntityTypeDef, "group" | "statusColors"> | undefined, groups: Pick<GroupDef, "key" | "statusColors">[]): PaletteColor | null {
	if (!type) return null;
	return lookup(type.statusColors, status) ?? lookup(groups.find((g) => g.key === type.group)?.statusColors, status);
}

/** A status's colour for several types at once (a board's buckets, a filter): the first that sets one. */
export function statusColorAmong(status: string, types: Pick<EntityTypeDef, "group" | "statusColors">[], groups: Pick<GroupDef, "key" | "statusColors">[]): PaletteColor | null {
	for (const t of types) {
		const c = statusColor(status, t, groups);
		if (c) return c;
	}
	return null;
}

const STATUS_TONES: Record<string, string> = {
	done: "done",
	complete: "done",
	completed: "done",
	won: "done",
	active: "active",
	open: "active",
	"in-progress": "active",
	customer: "active",
	"on-hold": "hold",
	blocked: "hold",
	lead: "hold",
	prospect: "hold",
	archived: "closed",
	abandoned: "closed",
	lost: "closed",
	inactive: "closed",
	former: "closed",
};

/** Colour family for a status word (draft/idea and unknown words are neutral). */
export function statusTone(status: string | null): string {
	return (status && STATUS_TONES[status.toLowerCase()]) || "neutral";
}

const TONE_COLORS: Record<string, PaletteColor | null> = { done: "green", active: "blue", hold: "orange", closed: "grey", neutral: null };

/** A status's colour where one is needed (charts): its set colour, else its tone's (null for neutral statuses). */
export const statusPaint = (status: string, types: Pick<EntityTypeDef, "group" | "statusColors">[], groups: Pick<GroupDef, "key" | "statusColors">[]): PaletteColor | null =>
	statusColorAmong(status, types, groups) ?? TONE_COLORS[statusTone(status)] ?? null;

/** A map with a value's colour set (or cleared, with null); undefined when nothing is left. */
export function withColor(map: ColorMap | undefined, value: string, color: PaletteColor | null): ColorMap | undefined {
	const next: ColorMap = { ...(map ?? {}) };
	if (color) next[value] = color;
	else delete next[value];
	return Object.keys(next).length ? next : undefined;
}

/** Only the colours of values still listed (choices or statuses removed lose theirs); undefined when none. */
export function pruneColors(map: ColorMap | undefined, values: string[]): ColorMap | undefined {
	if (!map) return undefined;
	const keep = Object.fromEntries(Object.entries(map).filter(([k, c]) => values.includes(k) && isPaletteColor(c)));
	return Object.keys(keep).length ? keep : undefined;
}

/** The map with a value renamed (its colour follows it). */
export function renameColor(map: ColorMap | undefined, from: string, to: string): ColorMap | undefined {
	if (!map || from === to || !(from in map)) return map;
	const next: ColorMap = {};
	for (const [k, c] of Object.entries(map)) if (k !== from) next[k] = c;
	if (to && !(to in next)) next[to] = map[from];
	return Object.keys(next).length ? next : undefined;
}
