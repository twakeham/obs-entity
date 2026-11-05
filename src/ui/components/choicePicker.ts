import { AbstractInputSuggest, type App } from "obsidian";
import { choiceColor, type ColorMap } from "../../model/colors";
import { choiceText, choiceTitle, choiceValue } from "../../model/choiceValues";
import type { FieldDef } from "../../model/types";

/** What a choice control needs from its field: colours, and the choices' values. */
export type ChoiceField = Pick<FieldDef, "kind" | "colors" | "valued" | "values" | "showValues">;

/** Classes for a choice's pill: tinted with its colour, else the darker grey pill. */
export const choicePillClass = (colors: ColorMap | undefined, value: string): string => {
	const c = choiceColor({ colors }, value);
	return `oe-pill oe-choice${c ? ` has-color oe-c-${c}` : ""}`;
};

export interface ChoiceSuggestOptions {
	/** the field's choices, in order */
	options: () => string[];
	/** choices not to offer (already picked, for multiple choice; the current one) */
	exclude: () => Set<string>;
	field: () => ChoiceField | undefined;
	onPick: (value: string) => void;
}

/** The choice dropdown: the field's choices as pills, filtered by what's typed (all of them when nothing is). */
export class ChoiceSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private opts: ChoiceSuggestOptions,
	) {
		super(app, inputEl);
		this.limit = 200;
	}

	getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		const skip = this.opts.exclude();
		return this.opts.options().filter((o) => !skip.has(o) && (!q || o.toLowerCase().includes(q)));
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.addClass("oe-choice-suggestion");
		const f = this.opts.field();
		const title = choiceTitle(f, value);
		el.createSpan({ cls: choicePillClass(f?.colors, value), text: choiceText(f, value), attr: title ? { title } : {} });
		// The value, faintly (unless the pill already shows it).
		const n = f?.showValues ? null : choiceValue(f, value);
		if (n !== null) el.createSpan({ cls: "oe-choice-value", text: String(n) });
	}

	selectSuggestion(value: string): void {
		this.setValue("");
		this.close();
		this.opts.onPick(value);
	}
}
