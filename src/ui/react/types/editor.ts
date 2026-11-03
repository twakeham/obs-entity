import { createContext, useContext } from "react";
import type { EntityInfo } from "../../../model/entity";
import type { FieldMeta, SampleNote, TypeDraft } from "../../../model/typeEditing";
import type { TypeIssue } from "../../../model/validation";
import type { EntityTypeDef, FieldKind, GroupDef } from "../../../model/types";

export type EditorTab = "general" | "fields" | "relationships" | "display" | "layout";

/** Everything the editor tabs need to read and change the type being edited. */
export interface EditorApi {
	draft: TypeDraft;
	/** apply a change to a copy of the draft (type + parallel field meta) */
	update: (fn: (t: EntityTypeDef, meta: FieldMeta[]) => void) => void;
	issues: TypeIssue[];
	/** issues at one location ("name", "field:2:key", …) */
	issuesAt: (at: string) => TypeIssue[];
	/** every type as currently edited (drafts in place of saved versions) */
	allTypes: EntityTypeDef[];
	groups: GroupDef[];
	/** open another type (optionally selecting one of its fields) */
	openType: (key: string, fieldKey?: string) => void;
	openGroup: (key: string) => void;
	fieldUid: string | null;
	setFieldUid: (uid: string | null) => void;
	setTab: (tab: EditorTab) => void;
	/** number of notes of this type */
	noteCount: number;
	/** example note used by previews */
	sample: SampleNote;
}

/** The sample as an entity of the draft type, for reusing card and picker logic. */
export function sampleEntity(type: EntityTypeDef, s: SampleNote, subtitle: string | null): EntityInfo {
	return { path: s.path ?? `__sample__/${s.name}.md`, name: s.name, type, status: s.status, subtitle, tags: [], mtime: 0, order: null, frontmatter: s.frontmatter };
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
	const api = useContext(EditorContext);
	if (!api) throw new Error("EditorContext missing");
	return api;
}

export const KIND_INFO: Record<FieldKind, { label: string; icon: string; desc: string }> = {
	text: { label: "Text", icon: "type", desc: "A single line of text" },
	textarea: { label: "Long text", icon: "align-left", desc: "Several lines of text" },
	number: { label: "Number", icon: "hash", desc: "A number, e.g. a budget" },
	date: { label: "Date", icon: "calendar", desc: "A date (YYYY-MM-DD)" },
	select: { label: "Choice", icon: "list-checks", desc: "One value from a fixed list" },
	multiselect: { label: "Multiple choice", icon: "list-todo", desc: "Several values from a fixed list" },
	list: { label: "List", icon: "list", desc: "Several free values" },
	boolean: { label: "Checkbox", icon: "check-square", desc: "Yes or no" },
	url: { label: "Link (URL)", icon: "globe", desc: "A web address or email" },
	relation: { label: "Relation", icon: "link", desc: "Links to other entities" },
	rollup: { label: "Roll-up", icon: "sigma", desc: "Worked out from linked notes: a count, total, latest date…" },
	formula: { label: "Formula", icon: "function-square", desc: "Worked out from this note's fields, e.g. days until due" },
};

export const KIND_ORDER: FieldKind[] = ["text", "textarea", "number", "date", "select", "multiselect", "list", "boolean", "url", "relation", "rollup", "formula"];
