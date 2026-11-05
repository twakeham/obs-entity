import { AbstractInputSuggest, type App } from "obsidian";
import { choiceColor, type ColorMap } from "../../model/colors";

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
	colors: () => ColorMap | undefined;
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
		el.createSpan({ cls: choicePillClass(this.opts.colors(), value), text: value });
	}

	selectSuggestion(value: string): void {
		this.setValue("");
		this.close();
		this.opts.onPick(value);
	}
}
