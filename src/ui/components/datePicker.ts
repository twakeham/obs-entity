import { setIcon } from "obsidian";
import type { DateAdapter } from "../../model/dates";

/** Open a hidden native date input's picker, starting at `start` (YYYY-MM-DD) when given. */
export function openNativePicker(input: HTMLInputElement, start: string | null): void {
	input.value = start ?? "";
	try {
		input.showPicker();
	} catch {
		input.focus();
		input.click();
	}
}

/**
 * A calendar button that opens the browser's date picker; the picked date is written back in the
 * adapter's format. Returns null (and adds nothing) when the adapter has no picker.
 */
export function addDatePickerButton(parent: HTMLElement, dates: DateAdapter, get: () => string, set: (value: string) => void): HTMLElement | null {
	const { toPicker, fromPicker } = dates;
	if (!toPicker || !fromPicker) return null;
	const wrap = parent.createSpan({ cls: "oe-datepick" });
	const btn = wrap.createEl("button", { cls: "clickable-icon oe-datepick-btn", attr: { "aria-label": "Pick a date", type: "button" } });
	setIcon(btn, "calendar");
	const input = wrap.createEl("input", { cls: "oe-datepick-native", attr: { type: "date", tabindex: "-1", "aria-hidden": "true" } });
	input.addEventListener("change", () => {
		if (input.value) set(fromPicker.call(dates, input.value));
	});
	btn.addEventListener("click", (e) => {
		e.preventDefault();
		openNativePicker(input, toPicker.call(dates, get()));
	});
	return btn;
}
