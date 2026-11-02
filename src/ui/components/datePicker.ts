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