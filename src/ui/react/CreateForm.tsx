import { Notice } from "obsidian";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { normaliseLayout, resolveLayout, type LabelPosition } from "../../model/formLayout";
import { fromFormFields, isEmptyValue, toFormFields, type EntityFormValues } from "../../model/frontmatter";
import { COMMON_KEYS, statusesFor, type EntityTypeDef } from "../../model/types";
import { emptyFormValues } from "../../services/entityFactory";
import { usePlugin } from "./context";
import { extraFrame, fieldControl, layoutNodes, ListControl, PropRow, StatusControl } from "./EntityForm";
import { Icon } from "./Icon";
import { KIND_INFO } from "./types/editor";

export interface CreateFormProps {
	type: EntityTypeDef;
	initial: EntityFormValues;
	/** the type editor's preview: the dialog as it looks, without creating anything */
	preview?: boolean;
	/** pick another type (the modal opens the type picker) */
	onPickType?: (done: (t: EntityTypeDef) => void) => void;
	onSubmit?: (type: EntityTypeDef, values: EntityFormValues) => Promise<void>;
	onCancel?: () => void;
	/** receives the dialog's "create now" (for Ctrl/Cmd+Enter anywhere in the modal) */
	onSubmitReady?: (submit: () => void) => void;
}

/** What the dialog edits: relations held like the properties form's controls hold them (wikilinks). */
interface DialogState {
	name: string;
	status: string;
	tags: string[];
	fields: Record<string, unknown>;
}

const hasValue = (v: unknown) => !isEmptyValue(v) && v !== false;

/**
 * The create dialog's form: name and status, then the type's fields (its layout's frames marked "Show in create
 * dialog", or the fields set to show in the dialog), "Show N more fields", tags, and where the note will go.
 */
export function CreateForm({ type: initialType, initial, preview, onPickType, onSubmit, onCancel, onSubmitReady }: CreateFormProps) {
	const plugin = usePlugin();
	const [type, setType] = useState(initialType);
	useEffect(() => setType(initialType), [initialType]);
	const [state, setState] = useState<DialogState>(() => ({ name: initial.name, status: initial.status, tags: initial.tags, fields: toFormFields(initialType, initial.fields) }));
	// Writes land in the ref at once, so a submit straight after a blur sees them.
	const stateRef = useRef(state);
	stateRef.current = state;
	const set = (patch: Partial<DialogState>) => {
		stateRef.current = { ...stateRef.current, ...patch };
		setState(stateRef.current);
	};
	const setField = (key: string, v: unknown) => set({ fields: { ...stateRef.current.fields, [key]: v } });
	const [showAll, setShowAll] = useState(false);
	const [busy, setBusy] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	const statuses = statusesFor(type, plugin.settings.groups);
	const status = statuses.includes(state.status) ? state.status : statuses[0];
	const values = (s: DialogState = stateRef.current): EntityFormValues => ({ name: s.name, status: statuses.includes(s.status) ? s.status : statuses[0], tags: s.tags, fields: fromFormFields(type, s.fields) });

	const submit = async () => {
		if (preview || busy) return;
		// Commit a text box that's still being typed in.
		const a = document.activeElement;
		if (a instanceof HTMLElement && rootRef.current?.contains(a) && a.matches("input, textarea")) a.blur();
		const s = stateRef.current;
		if (!s.name.trim()) {
			new Notice("Please enter a name.");
			return;
		}
		const missing = type.fields.filter((f) => f.required && !hasValue(s.fields[f.key])).map((f) => f.label);
		if (missing.length) {
			new Notice(`Required: ${missing.join(", ")}`);
			return;
		}
		setBusy(true);
		try {
			await onSubmit?.(type, values(s));
		} finally {
			setBusy(false);
		}
	};
	const submitRef = useRef(submit);
	submitRef.current = submit;
	useEffect(() => {
		onSubmitReady?.(() => void submitRef.current());
	}, [onSubmitReady]);

	const changeType = () =>
		onPickType?.((t) => {
			const blank = emptyFormValues(t, plugin.settings.groups);
			// Keep what's typed; fields the new type doesn't have are ignored when creating.
			set({ status: blank.status, fields: { ...toFormFields(t, blank.fields), ...stateRef.current.fields } });
			setType(t);
		});

	// ---- rows: the properties form's rows, all editable, descriptions shown
	const shownKeys = new Set<string>();
	/** a property's row (null for properties the dialog doesn't set: related, aliases, order, and status, which is at the top) */
	const propFor = (key: string, labelPos?: LabelPosition): ReactNode | null => {
		const f = type.fields.find((x) => x.key === key);
		if (f) {
			shownKeys.add(key);
			return (
				<PropRow key={key} k={key} label={f.label || f.key} icon={KIND_INFO[f.kind].icon} required={f.required} desc={f.description} showDesc problems={[]} empty={!hasValue(state.fields[key])} editable onFix={() => {}} labelPos={labelPos}>
					{fieldControl(f, { value: state.fields[key], editable: true, path: "", type, live: false, problems: [], onCommit: (v) => setField(key, v) })}
				</PropRow>
			);
		}
		if (key === COMMON_KEYS.tags) {
			shownKeys.add(key);
			return (
				<PropRow key={key} k={key} label="Tags" icon="tags" problems={[]} empty={!state.tags.length} editable onFix={() => {}} labelPos={labelPos}>
					<ListControl value={state.tags} editable label="Tags" tag onCommit={(v) => set({ tags: (Array.isArray(v) ? v : []).map((x) => String(x).replace(/^#/, "")) })} />
				</PropRow>
			);
		}
		return null;
	};

	const layout = type.form?.layout ? normaliseLayout(type.form.layout) : null;
	const resolved = layout ? resolveLayout(layout, type) : null;
	let body: ReactNode;
	let hidden = 0;
	if (!resolved) {
		// No layout: the fields set to show in the dialog, required ones, subtitle fields and any with a value.
		const subtitle = new Set(type.card?.subtitle ?? []);
		const visible = type.fields.filter((f) => showAll || f.inModal || f.required || subtitle.has(f.key) || hasValue(state.fields[f.key]));
		hidden = type.fields.length - visible.length;
		body = <div className="oe-form-rows">{visible.map((f) => propFor(f.key))}</div>;
	} else {
		// The layout's frames marked "Show in create dialog" (all of them with "Show more fields").
		const nodes = layoutNodes(resolved.items, propFor, { closed: new Set(), toggle: () => {}, flagged: () => false, include: (fr) => showAll || fr.create !== false });
		// Required fields, and ones already filled in, that aren't on show yet: asked for in a frame of their own.
		const outside = type.fields.filter((f) => !shownKeys.has(f.key));
		const needed = showAll ? [] : outside.filter((f) => f.required || hasValue(state.fields[f.key]));
		if (needed.length) nodes.push(extraFrame("required", needed.every((f) => f.required) ? "Required" : "Required and filled in", needed.map((f) => propFor(f.key)), "is-required"));
		// Fields that aren't placed, with "Show more fields".
		if (showAll && !layout!.hideUnplaced) {
			const others = resolved.unplaced.filter((k) => !shownKeys.has(k)).map((k) => propFor(k));
			if (others.length) nodes.push(extraFrame("other", "Other fields", others));
		}
		hidden = type.fields.filter((f) => !shownKeys.has(f.key)).length;
		body = <div className="oe-form-layout">{nodes}</div>;
	}

	const factoryValues = values(state);
	const folder = plugin.factory.folderFor(type, { ...factoryValues, name: factoryValues.name || type.name });

	return (
		<div ref={rootRef} className="oe-form oe-create-form is-editing" style={{ "--oe-type-color": type.color } as CSSProperties} data-entity-type={type.key}>
			<div className="oe-modal-header">
				<span className="oe-type-icon oe-type-icon-lg" style={{ "--oe-type-color": type.color } as CSSProperties}>
					<Icon name={type.icon} />
				</span>
				<h2>New {(type.name || "entity").toLowerCase()}</h2>
				{onPickType && (
					<button type="button" className="clickable-icon oe-change-type" aria-label="Change type" onClick={changeType}>
						<Icon name="repeat" />
					</button>
				)}
			</div>
			<div className="oe-form-rows oe-create-top">
				<PropRow k="name" label="Name" icon="text-cursor-input" problems={[]} empty={!state.name} editable onFix={() => {}}>
					<input
						type="text"
						className="oe-prop-input oe-create-name"
						placeholder={`${type.name} name`}
						aria-label="Name"
						value={state.name}
						autoFocus={!preview}
						onChange={(e) => set({ name: e.target.value })}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.nativeEvent.isComposing) {
								e.preventDefault();
								void submit();
							}
						}}
					/>
				</PropRow>
				<PropRow k="status" label="Status" icon="circle-dot" problems={[]} empty={false} editable onFix={() => {}}>
					<StatusControl type={type} value={status} editable problem={undefined} onCommit={(v) => set({ status: String(v ?? "") })} />
				</PropRow>
			</div>
			<div className="oe-form-body">{body}</div>
			{(hidden > 0 || showAll) && (
				<button type="button" className="oe-form-more" onClick={() => setShowAll(!showAll)}>
					{showAll ? "Show fewer fields" : `Show ${hidden} more field${hidden === 1 ? "" : "s"}`}
				</button>
			)}
			{!shownKeys.has(COMMON_KEYS.tags) && <div className="oe-form-rows oe-create-tags">{propFor(COMMON_KEYS.tags)}</div>}
			<div className="oe-create-folder">Will be created in {folder || "the vault root"}/</div>
			<div className="oe-create-buttons">
				<button type="button" onClick={onCancel} disabled={preview}>
					Cancel
				</button>
				<button type="button" className="mod-cta" onClick={() => void submit()} disabled={preview || busy}>
					Create
				</button>
			</div>
		</div>
	);
}
