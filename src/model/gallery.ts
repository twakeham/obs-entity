/**
 * The bundled packs the gallery offers (and the first-run picker): types, groups, views and workflows for a few common
 * uses. Workflows come in switched off, like any pack's. General types (a person, an author, a topic) are `shared`:
 * installing a second pack that has one reuses the first's.
 */
import { CRM_PACK, STARTER_PACK, type PackView, type TypePack } from "./packs";
import type { EntityTypeDef, FieldDef } from "./types";
import type { FilterGroup } from "./views";
import type { WorkflowDef, WorkflowStep, WorkflowTrigger } from "./workflows";

// ---------------------------------------------------------------- helpers

const f = (key: string, label: string, kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });
const rel = (key: string, label: string, targets: string[], extra: Partial<FieldDef> = {}): FieldDef => f(key, label, "relation", { targets, ...extra });
const type = (t: Omit<EntityTypeDef, "builtIn" | "template"> & { template?: string }): EntityTypeDef => ({ template: `${t.name}.md`, builtIn: false, ...t });
const NONE: FilterGroup = { mode: "all", items: [] };
const wf = (id: string, name: string, scope: string[], trigger: WorkflowTrigger, steps: WorkflowStep[], extra: Partial<WorkflowDef> = {}): WorkflowDef => ({ id, name, on: false, scope, trigger, when: NONE, steps, ...extra });
const view = (name: string, def: Record<string, unknown>): PackView => ({ name, view: def });
/** "When <field> becomes <value>, set <date field> to today." */
const stamp = (id: string, name: string, typeKey: string, status: string, dateField: string): WorkflowDef =>
	wf(id, name, [typeKey], { kind: "changed", field: "status", to: [status] }, [{ kind: "set", field: dateField, value: "", fixed: "today" }]);

/** A person: shared by the packs that have people. */
const PERSON = (group: string): EntityTypeDef =>
	type({
		key: "person",
		name: "Person",
		plural: "People",
		icon: "user",
		color: "#2196f3",
		group,
		shortcuts: ["p"],
		sections: ["Overview", "Notes"],
		card: { subtitle: ["role"] },
		fields: [f("role", "Role", "text", { inModal: true }), f("email", "Email", "url", { inModal: true }), f("phone", "Phone", "text")],
	});

/** An author: shared by Reading & library and Research. */
const AUTHOR = (group: string): EntityTypeDef =>
	type({
		key: "author",
		name: "Author",
		plural: "Authors",
		icon: "feather",
		color: "#795548",
		group,
		shortcuts: ["au"],
		sections: ["About", "Notes"],
		card: { subtitle: ["affiliation"] },
		fields: [f("affiliation", "Affiliation", "text", { inModal: true }), f("website", "Website", "url")],
	});

/** A topic: shared by Research and Personal knowledge. */
const TOPIC = (group: string): EntityTypeDef =>
	type({
		key: "topic",
		name: "Topic",
		plural: "Topics",
		icon: "hash",
		color: "#009688",
		group,
		shortcuts: ["tp"],
		sections: ["Overview", "Notes"],
		parentFields: ["broader"],
		card: { subtitle: ["summary"] },
		fields: [f("summary", "Summary", "textarea", { inModal: true }), rel("broader", "Broader topic", ["topic"], { inverse: "Narrower topics" })],
	});

// ---------------------------------------------------------------- Starter

const STARTER: TypePack = {
	...STARTER_PACK,
	icon: "shapes",
	description: "A general start: people, organisations, places, projects and notes, linked together. Good for most vaults; change it as you go.",
	shared: ["person"],
	views: [
		view("People", { kind: "table", types: ["person"], columns: ["name", "role", "works_for", "email", "phone"], sort: [{ by: "name", dir: "asc" }] }),
		view("Projects", { kind: "board", types: ["project"], columns: ["name", "status", "owner", "due", "client"], board: { cardFields: ["owner", "due"] } }),
	],
};

// ---------------------------------------------------------------- Basic CRM

const deal = CRM_PACK.types.find((t) => t.key === "deal")!;
const CRM: TypePack = {
	...CRM_PACK,
	icon: "handshake",
	description: "Contacts, companies, deals in a pipeline, and the calls, emails and meetings you have with them.",
	types: [
		...CRM_PACK.types.filter((t) => t.key !== "deal"),
		{ ...deal, fields: [...deal.fields.slice(0, 1), f("stage", "Stage", "select", { options: ["Lead", "Qualified", "Proposal", "Negotiation"], inModal: true }), ...deal.fields.slice(1)] },
		type({
			key: "interaction",
			name: "Interaction",
			plural: "Interactions",
			icon: "message-square",
			color: "#ff9800",
			group: "sales",
			shortcuts: ["int"],
			sections: ["Summary", "Follow-up"],
			card: { subtitle: ["kind", "date"] },
			statuses: ["logged", "follow-up", "done"],
			fields: [
				f("date", "Date", "date", { inModal: true, defaultFrom: { kind: "relative", spec: "today" } }),
				f("kind", "Kind", "select", { options: ["Call", "Email", "Meeting", "Note"], inModal: true }),
				rel("contacts", "Contacts", ["contact"], { multiple: true, inverse: "Interactions", inModal: true }),
				rel("deal", "Deal", ["deal"], { inverse: "Interactions" }),
			],
		}),
	],
	views: [
		view("Pipeline", {
			kind: "board",
			types: ["deal"],
			columns: ["name", "stage", "company", "value", "close_date"],
			formats: { value: "currency" },
			summary: { value: "sum" },
			filters: { all: [{ field: "status", op: "any-of", value: ["open"] }] },
			board: { buckets: "stage", cardFields: ["company", "value", "close_date"] },
		}),
		view("Contacts", { kind: "table", types: ["contact"], columns: ["name", "role", "works_at", "email"], sort: [{ by: "name", dir: "asc" }] }),
		view("Companies", {
			kind: "table",
			types: ["company"],
			columns: ["name", "industry", "website", { rollup: { via: "in:deal.company", agg: "count" }, label: "Deals", id: "deals" }, { rollup: { via: "in:deal.company", agg: "sum", field: "value" }, label: "Deal value", id: "deal_value" }],
			formats: { deal_value: "currency" },
			sort: [{ by: "name", dir: "asc" }],
		}),
		view("Recent interactions", { kind: "table", types: ["interaction"], columns: ["name", "date", "kind", "contacts", "deal", "status"], sort: [{ by: "date", dir: "desc" }] }),
	],
	workflows: [
		wf("wf-crm-won", "Deal won", ["deal"], { kind: "changed", field: "status", to: ["won"] }, [
			{ kind: "set", field: "close_date", value: "", fixed: "today" },
			{ kind: "notice", text: "Won {[Name]}." },
		]),
		wf("wf-crm-log-call", "Log a call", ["contact"], { kind: "manual", label: "Log a call", icon: "phone" }, [
			{
				kind: "create",
				type: "interaction",
				name: '{format(today(), "YYYY-MM-DD")} call with {[Name]}',
				fields: [{ field: "kind", value: "", fixed: "Call" }],
				link: { dir: "from-new", field: "contacts" },
				template: true,
				open: "tab",
				exists: "new",
				as: "New interaction",
			},
		]),
	],
};

// ---------------------------------------------------------------- Project delivery

const DELIVERY: TypePack = {
	obsEntitiesPack: 1,
	id: "project-delivery",
	name: "Project delivery",
	icon: "folder-kanban",
	description: "Projects with milestones and tasks, plus the risks, meetings and decisions around them. Boards, a portfolio, a risk register and an overdue list.",
	shared: ["person"],
	groups: [
		{ key: "team", name: "Team", icon: "users", statuses: ["active", "away", "left"] },
		{ key: "delivery", name: "Delivery", icon: "rocket", statuses: ["planned", "active", "on-hold", "done"] },
		{ key: "governance", name: "Governance", icon: "scale", statuses: ["open", "closed"] },
	],
	types: [
		PERSON("team"),
		type({
			key: "project",
			name: "Project",
			plural: "Projects",
			icon: "folder-kanban",
			color: "#ff9800",
			group: "delivery",
			folderMode: "own",
			shortcuts: ["proj"],
			sections: ["Goal", "Scope", "Plan", "Notes"],
			parentFields: ["parent_project"],
			statuses: ["proposal", "planned", "active", "on-hold", "cancelled", "done"],
			card: { subtitle: ["description"] },
			fields: [
				f("description", "Description", "textarea", { inModal: true }),
				rel("owner", "Owner", ["person"], { inverse: "Owns projects", inModal: true }),
				rel("team", "Team", ["person"], { multiple: true, inverse: "Projects" }),
				f("priority", "Priority", "select", { options: ["Low", "Medium", "High"], inModal: true }),
				f("start", "Start", "date"),
				f("due", "Due", "date", { inModal: true }),
				rel("parent_project", "Parent project", ["project"], { inverse: "Sub-projects" }),
			],
		}),
		type({
			key: "milestone",
			name: "Milestone",
			plural: "Milestones",
			icon: "flag",
			color: "#9c27b0",
			group: "delivery",
			sections: ["Definition of done", "Notes"],
			parentFields: ["project"],
			statuses: ["planned", "in-progress", "done"],
			card: { subtitle: ["due"] },
			fields: [rel("project", "Project", ["project"], { inverse: "Milestones", required: true, inModal: true }), f("due", "Due", "date", { inModal: true }), rel("owner", "Owner", ["person"], { inverse: "Owns milestones" })],
		}),
		type({
			key: "task",
			name: "Task",
			plural: "Tasks",
			icon: "square-check",
			color: "#4caf50",
			group: "delivery",
			shortcuts: ["t"],
			sections: ["Details", "Notes"],
			parentFields: ["milestone", "project"],
			statuses: ["todo", "in-progress", "blocked", "review", "done"],
			card: { subtitle: ["due"] },
			fields: [
				rel("project", "Project", ["project"], { inverse: "Tasks", inModal: true }),
				rel("milestone", "Milestone", ["milestone"], { inverse: "Tasks" }),
				rel("assignee", "Assignee", ["person"], { inverse: "Tasks", inModal: true }),
				f("priority", "Priority", "select", { options: ["Low", "Medium", "High"], inModal: true }),
				f("estimate", "Estimate (h)", "number"),
				f("due", "Due", "date", { inModal: true }),
				f("completed", "Completed", "date"),
				rel("blocked_by", "Blocked by", ["task"], { multiple: true, inverse: "Blocks" }),
			],
		}),
		type({
			key: "risk",
			name: "Risk",
			plural: "Risks",
			icon: "triangle-alert",
			color: "#f44336",
			group: "governance",
			sections: ["Description", "Mitigation plan"],
			statuses: ["open", "monitoring", "mitigated", "closed"],
			card: { subtitle: ["likelihood", "impact"] },
			fields: [
				rel("project", "Project", ["project"], { inverse: "Risks", inModal: true }),
				rel("owner", "Owner", ["person"], { inverse: "Owns risks" }),
				f("likelihood", "Likelihood", "select", { options: ["Low", "Medium", "High"], inModal: true }),
				f("impact", "Impact", "select", { options: ["Low", "Medium", "High"], inModal: true }),
				f("raised", "Raised", "date", { defaultFrom: { kind: "relative", spec: "today" } }),
				f("mitigation", "Mitigation", "textarea"),
			],
		}),
		type({
			key: "meeting",
			name: "Meeting",
			plural: "Meetings",
			icon: "calendar-days",
			color: "#3f51b5",
			group: "governance",
			sections: ["Agenda", "Notes", "Actions"],
			statuses: ["scheduled", "held", "cancelled"],
			card: { subtitle: ["date"] },
			fields: [
				f("date", "Date", "date", { inModal: true, defaultFrom: { kind: "relative", spec: "today" } }),
				rel("project", "Project", ["project"], { inverse: "Meetings", inModal: true }),
				rel("attendees", "Attendees", ["person"], { multiple: true, inverse: "Meetings" }),
				f("outcome", "Outcome", "textarea"),
			],
		}),
		type({
			key: "decision",
			name: "Decision",
			plural: "Decisions",
			icon: "gavel",
			color: "#607d8b",
			group: "governance",
			sections: ["Context", "Decision", "Consequences"],
			statuses: ["proposed", "accepted", "superseded"],
			card: { subtitle: ["decided_on"] },
			fields: [
				rel("project", "Project", ["project"], { inverse: "Decisions", inModal: true }),
				rel("meeting", "Meeting", ["meeting"], { inverse: "Decisions" }),
				rel("owner", "Owner", ["person"], { inverse: "Decisions" }),
				f("decided_on", "Decided on", "date", { inModal: true }),
				f("rationale", "Rationale", "textarea"),
			],
		}),
	],
	views: [
		view("Project portfolio", {
			kind: "table",
			types: ["project"],
			columns: [
				"name",
				"status",
				"owner",
				"priority",
				"due",
				{ rollup: { via: "in:task.project", agg: "count" }, label: "Tasks", id: "tasks" },
				{ rollup: { via: "in:task.project", agg: "percent-done" }, label: "Done", id: "done" },
				{ rollup: { via: "in:risk.project", agg: "count", where: { all: [{ field: "status", op: "none-of", value: ["closed"] }] } }, label: "Open risks", id: "risks" },
			],
			formats: { due: "relative" },
			sort: [{ by: "due", dir: "asc" }],
			filters: { all: [{ field: "status", op: "none-of", value: ["done", "cancelled"] }] },
		}),
		view("Task board", { kind: "board", types: ["task"], columns: ["name", "status", "project", "assignee", "priority", "due"], board: { cardFields: ["project", "assignee", "due"] } }),
		view("Overdue", {
			kind: "table",
			types: ["task", "milestone"],
			columns: ["name", "type", "status", "due", "project", "assignee", "owner"],
			sort: [{ by: "due", dir: "asc" }],
			group: [{ by: "project" }],
			filters: { all: [{ field: "due", op: "before", value: "today" }, { field: "status", op: "none-of", value: ["done"] }] },
		}),
		view("Risk register", {
			kind: "table",
			types: ["risk"],
			columns: ["name", "status", "project", "owner", "likelihood", "impact", "raised", "mitigation"],
			wrap: ["mitigation"],
			sort: [{ by: "raised", dir: "desc" }],
			filters: { all: [{ field: "status", op: "none-of", value: ["closed"] }] },
			highlight: [
				{ target: "likelihood", when: { all: [{ field: "likelihood", op: "any-of", value: ["High"] }] }, style: { fill: "red" } },
				{ target: "likelihood", when: { all: [{ field: "likelihood", op: "any-of", value: ["Medium"] }] }, style: { fill: "orange" } },
				{ target: "impact", when: { all: [{ field: "impact", op: "any-of", value: ["High"] }] }, style: { fill: "red" } },
				{ target: "impact", when: { all: [{ field: "impact", op: "any-of", value: ["Medium"] }] }, style: { fill: "orange" } },
			],
		}),
		view("Delivery calendar", { kind: "calendar", types: ["task", "milestone", "meeting"], columns: ["name", "status", "project"], calendar: { dates: { task: "due", milestone: "due", meeting: "date" } } }),
		view("Decision log", { kind: "table", types: ["decision"], columns: ["name", "status", "decided_on", "project", "owner", "rationale"], wrap: ["rationale"], sort: [{ by: "decided_on", dir: "desc" }] }),
	],
	workflows: [
		stamp("wf-dl-task-done", "Record when a task is done", "task", "done", "completed"),
		wf("wf-dl-overdue", "Tag overdue tasks", ["task"], { kind: "date", field: "due", offset: 1, at: "09:00", limit: 50 }, [{ kind: "tag", op: "add", tag: "overdue" }], {
			when: { mode: "all", items: [{ field: "status", op: "none-of", value: ["done"] }] },
		}),
		wf(
			"wf-dl-log-meeting",
			"Log a meeting",
			[],
			{
				kind: "form",
				title: "Log a meeting",
				button: "Log meeting",
				icon: "notebook-pen",
				fields: [
					f("date", "Date", "date", { required: true, defaultFrom: { kind: "relative", spec: "today" } }),
					rel("project", "Project", ["project"], { required: true }),
					rel("attendees", "Attendees", ["person"], { multiple: true }),
					f("summary", "Summary", "textarea", { required: true, description: "It becomes the meeting's outcome, and a line on the project." }),
				],
			},
			[
				{
					kind: "create",
					type: "meeting",
					name: '{format([Date], "YYYY-MM-DD")} {name(first([Project]))}',
					fields: [
						{ field: "date", value: "[Date]" },
						{ field: "project", value: "[Project]" },
						{ field: "attendees", value: "[Attendees]" },
						{ field: "outcome", value: "[Summary]" },
						{ field: "status", value: "", fixed: "held" },
					],
					template: true,
					open: "no",
					exists: "new",
					as: "New meeting",
				},
				{ kind: "append", text: '- {format([Date], "D MMM YYYY")}: [[{name(first([New meeting]))}]]: {[Summary]}', where: "heading", heading: "## Meetings", on: "Project" },
				{ kind: "notice", text: "Logged {name(first([New meeting]))}." },
			],
			{ command: true },
		),
	],
};

// ---------------------------------------------------------------- Reading & library

const READING: TypePack = {
	obsEntitiesPack: 1,
	id: "reading-library",
	name: "Reading & library",
	icon: "book-open",
	description: "Books, their authors and series, and the quotes you keep. A reading list, a bookshelf board and what you've finished.",
	shared: ["author"],
	groups: [{ key: "library", name: "Library", icon: "library", statuses: ["active", "archived"] }],
	types: [
		type({
			key: "book",
			name: "Book",
			plural: "Books",
			icon: "book-open",
			color: "#e91e63",
			group: "library",
			shortcuts: ["b"],
			sections: ["Summary", "Thoughts", "Notes"],
			statuses: ["to-read", "reading", "finished", "abandoned"],
			card: { subtitle: ["rating"] },
			fields: [
				rel("authors", "Authors", ["author"], { multiple: true, inverse: "Books", inModal: true }),
				rel("series", "Series", ["series"], { inverse: "Books" }),
				f("number", "Number in series", "number"),
				f("genres", "Genres", "multiselect", { options: ["Fiction", "Non-fiction", "Biography", "History", "Science", "Fantasy", "Mystery", "Business"], inModal: true }),
				f("rating", "Rating", "select", { options: ["1", "2", "3", "4", "5"] }),
				f("pages", "Pages", "number"),
				f("started", "Started", "date"),
				f("finished", "Finished", "date"),
				f("isbn", "ISBN", "text"),
			],
		}),
		AUTHOR("library"),
		type({ key: "series", name: "Series", plural: "Series", icon: "layers", color: "#673ab7", group: "library", sections: ["About"], card: { subtitle: ["summary"] }, fields: [f("summary", "Summary", "textarea", { inModal: true })] }),
		type({
			key: "quote",
			name: "Quote",
			plural: "Quotes",
			icon: "quote",
			color: "#9e9e9e",
			group: "library",
			sections: ["Quote", "Why it stays with me"],
			parentFields: ["book"],
			card: { subtitle: ["page"] },
			fields: [rel("book", "Book", ["book"], { inverse: "Quotes", inModal: true }), f("page", "Page", "number", { inModal: true }), f("text", "Text", "textarea", { inModal: true })],
		}),
	],
	views: [
		view("Reading list", { kind: "table", types: ["book"], columns: ["name", "authors", "series", "genres", "pages"], sort: [{ by: "name", dir: "asc" }], filters: { all: [{ field: "status", op: "any-of", value: ["to-read"] }] } }),
		view("Bookshelf", { kind: "board", types: ["book"], columns: ["name", "status", "authors", "rating"], board: { cardFields: ["authors", "rating"] } }),
		view("Finished this year", {
			kind: "table",
			types: ["book"],
			columns: ["name", "authors", "rating", "finished", "pages"],
			summary: { name: "count", pages: "sum" },
			sort: [{ by: "finished", dir: "desc" }],
			filters: { all: [{ field: "finished", op: "after", value: "-1y" }] },
		}),
		view("Quotes", { kind: "table", types: ["quote"], columns: ["name", "book", "page", "text"], wrap: ["text"], sort: [{ by: "book", dir: "asc" }] }),
	],
	workflows: [
		stamp("wf-rd-started", "Started reading", "book", "reading", "started"),
		stamp("wf-rd-finished", "Finished reading", "book", "finished", "finished"),
		wf("wf-rd-quote", "Add a quote", ["book"], { kind: "manual", label: "Add a quote", icon: "quote" }, [
			{ kind: "create", type: "quote", name: "{[Name]} quote", fields: [], link: { dir: "from-new", field: "book" }, template: true, open: "tab", exists: "new", as: "New quote" },
		]),
	],
};

// ---------------------------------------------------------------- Research

const RESEARCH: TypePack = {
	obsEntitiesPack: 1,
	id: "research",
	name: "Research",
	icon: "microscope",
	description: "Papers, their authors and topics, and your notes on them: summaries, findings and questions. A reading queue and papers by topic.",
	shared: ["author", "topic"],
	groups: [{ key: "research", name: "Research", icon: "microscope", statuses: ["active", "archived"] }],
	types: [
		type({
			key: "paper",
			name: "Paper",
			plural: "Papers",
			icon: "file-text",
			color: "#03a9f4",
			group: "research",
			shortcuts: ["pa"],
			sections: ["Summary", "Methods", "Findings", "Notes"],
			statuses: ["to-read", "reading", "read", "cited"],
			card: { subtitle: ["year", "venue"] },
			fields: [
				rel("authors", "Authors", ["author"], { multiple: true, inverse: "Papers", inModal: true }),
				f("year", "Year", "number", { inModal: true }),
				f("venue", "Venue", "text"),
				f("url", "Link", "url", { inModal: true }),
				f("doi", "DOI", "text"),
				rel("topics", "Topics", ["topic"], { multiple: true, inverse: "Papers" }),
				f("read_on", "Read on", "date"),
			],
		}),
		AUTHOR("research"),
		TOPIC("research"),
		type({
			key: "research_note",
			name: "Research note",
			plural: "Research notes",
			icon: "notebook-pen",
			color: "#8bc34a",
			group: "research",
			shortcuts: ["rn"],
			sections: ["Note"],
			parentFields: ["paper"],
			card: { subtitle: ["kind"] },
			fields: [
				f("kind", "Kind", "select", { options: ["Summary", "Finding", "Question", "Idea"], inModal: true }),
				rel("paper", "Paper", ["paper"], { inverse: "Notes", inModal: true }),
				rel("topics", "Topics", ["topic"], { multiple: true, inverse: "Research notes" }),
			],
		}),
	],
	views: [
		view("Reading queue", { kind: "table", types: ["paper"], columns: ["name", "authors", "year", "venue", "topics"], sort: [{ by: "year", dir: "desc" }], filters: { all: [{ field: "status", op: "any-of", value: ["to-read", "reading"] }] } }),
		view("Papers by topic", { kind: "table", types: ["paper"], columns: ["name", "status", "authors", "year", "venue"], group: [{ by: "topics" }], sort: [{ by: "year", dir: "desc" }] }),
		view("Research notes", { kind: "table", types: ["research_note"], columns: ["name", "kind", "paper", "topics", "created"], sort: [{ by: "created", dir: "desc" }] }),
	],
	workflows: [
		stamp("wf-rs-read", "Record when a paper is read", "paper", "read", "read_on"),
		wf("wf-rs-note", "Add a note", ["paper"], { kind: "manual", label: "Add a note", icon: "notebook-pen" }, [
			{ kind: "create", type: "research_note", name: "{[Name]} note", fields: [{ field: "kind", value: "", fixed: "Summary" }], link: { dir: "from-new", field: "paper" }, template: true, open: "tab", exists: "new", as: "New note" },
		]),
	],
};

// ---------------------------------------------------------------- Personal knowledge

const KNOWLEDGE: TypePack = {
	obsEntitiesPack: 1,
	id: "personal-knowledge",
	name: "Personal knowledge",
	icon: "brain",
	description: "Ideas that grow from seed to evergreen, the sources they came from, the topics they're about and the people behind them.",
	shared: ["person", "topic"],
	groups: [{ key: "knowledge", name: "Knowledge", icon: "brain", statuses: ["active", "archived"] }],
	types: [
		type({
			key: "idea",
			name: "Idea",
			plural: "Ideas",
			icon: "lightbulb",
			color: "#ffc107",
			group: "knowledge",
			shortcuts: ["idea"],
			sections: ["Idea", "Why it matters", "Connections"],
			statuses: ["seed", "growing", "evergreen"],
			card: { subtitle: ["captured"] },
			fields: [
				rel("topics", "Topics", ["topic"], { multiple: true, inverse: "Ideas", inModal: true }),
				rel("sources", "Sources", ["source"], { multiple: true, inverse: "Ideas", inModal: true }),
				rel("related_ideas", "Related ideas", ["idea"], { multiple: true, symmetric: true, inverse: "Related ideas" }),
				f("captured", "Captured", "date"),
			],
		}),
		type({
			key: "source",
			name: "Source",
			plural: "Sources",
			icon: "bookmark",
			color: "#ff5722",
			group: "knowledge",
			shortcuts: ["src"],
			sections: ["Summary", "Highlights"],
			statuses: ["to-explore", "exploring", "done"],
			card: { subtitle: ["kind"] },
			fields: [
				f("kind", "Kind", "select", { options: ["Book", "Article", "Podcast", "Video", "Course", "Conversation"], inModal: true }),
				rel("by", "By", ["person"], { multiple: true, inverse: "Sources" }),
				f("url", "Link", "url", { inModal: true }),
				rel("topics", "Topics", ["topic"], { multiple: true, inverse: "Sources" }),
				f("consumed", "Finished", "date"),
			],
		}),
		TOPIC("knowledge"),
		PERSON("knowledge"),
	],
	views: [
		view("Idea garden", { kind: "board", types: ["idea"], columns: ["name", "status", "topics", "sources"], board: { cardFields: ["topics"] } }),
		view("Sources", { kind: "table", types: ["source"], columns: ["name", "kind", "status", "by", "topics", "consumed"], sort: [{ by: "consumed", dir: "desc" }] }),
		view("Evergreen ideas", { kind: "table", types: ["idea"], columns: ["name", "topics", "sources", "related_ideas"], sort: [{ by: "name", dir: "asc" }], filters: { all: [{ field: "status", op: "any-of", value: ["evergreen"] }] } }),
	],
	workflows: [
		wf("wf-pk-captured", "Date new ideas", ["idea"], { kind: "created" }, [{ kind: "set", field: "captured", value: "", fixed: "today" }]),
		wf("wf-pk-evergreen", "Make evergreen", ["idea"], { kind: "manual", label: "Make evergreen", icon: "sprout" }, [{ kind: "set", field: "status", value: "", fixed: "evergreen" }]),
	],
};

// ---------------------------------------------------------------- Home & assets

const HOME: TypePack = {
	obsEntitiesPack: 1,
	id: "home-assets",
	name: "Home & assets",
	icon: "house",
	description: "What you own, room by room, where you bought it and what it cost, and the warranties on it, with a reminder before they run out.",
	groups: [{ key: "home", name: "Home", icon: "house", statuses: ["in-use", "stored", "broken", "gone"] }],
	types: [
		type({
			key: "item",
			name: "Item",
			plural: "Items",
			icon: "package",
			color: "#795548",
			group: "home",
			shortcuts: ["it"],
			sections: ["Details", "Care"],
			card: { subtitle: ["category"] },
			fields: [
				rel("room", "Room", ["room"], { inverse: "Items", inModal: true }),
				f("category", "Category", "select", { options: ["Appliance", "Electronics", "Furniture", "Tool", "Vehicle", "Other"], inModal: true }),
				f("purchased", "Purchased", "date", { inModal: true }),
				f("price", "Price", "number", { format: "currency", inModal: true }),
				rel("supplier", "Bought from", ["supplier"], { inverse: "Sold" }),
				f("serial", "Serial number", "text"),
				f("manual", "Manual", "url"),
			],
		}),
		type({ key: "room", name: "Room", plural: "Rooms", icon: "door-open", color: "#607d8b", group: "home", sections: ["Notes"], statuses: ["active"], fields: [f("floor", "Floor", "text", { inModal: true })] }),
		type({
			key: "warranty",
			name: "Warranty",
			plural: "Warranties",
			icon: "shield-check",
			color: "#4caf50",
			group: "home",
			sections: ["Terms", "Claims"],
			parentFields: ["item"],
			statuses: ["active", "expired", "claimed"],
			card: { subtitle: ["expires"] },
			fields: [
				rel("item", "Item", ["item"], { inverse: "Warranties", required: true, inModal: true }),
				rel("supplier", "Provider", ["supplier"], { inverse: "Warranties" }),
				f("expires", "Expires", "date", { required: true, inModal: true }),
				f("reference", "Reference", "text"),
				f("document", "Document", "url"),
			],
		}),
		type({
			key: "supplier",
			name: "Supplier",
			plural: "Suppliers",
			icon: "truck",
			color: "#ff9800",
			group: "home",
			sections: ["Notes"],
			statuses: ["active", "former"],
			card: { subtitle: ["phone"] },
			fields: [f("website", "Website", "url", { inModal: true }), f("phone", "Phone", "text", { inModal: true }), f("email", "Email", "url")],
		}),
	],
	views: [
		view("Inventory", {
			kind: "table",
			types: ["item"],
			columns: ["name", "category", "status", "purchased", "price", "supplier"],
			formats: { price: "currency" },
			summary: { name: "count", price: "sum" },
			group: [{ by: "room" }],
			sort: [{ by: "name", dir: "asc" }],
			filters: { all: [{ field: "status", op: "none-of", value: ["gone"] }] },
		}),
		view("Warranties", {
			kind: "table",
			types: ["warranty"],
			columns: ["name", "item", "supplier", "expires", "reference", "status"],
			sort: [{ by: "expires", dir: "asc" }],
			filters: { all: [{ field: "status", op: "any-of", value: ["active"] }] },
			highlight: [{ target: "expires", when: { all: [{ field: "expires", op: "before", value: "+30d" }] }, style: { fill: "orange" } }],
		}),
		view("Warranty calendar", { kind: "calendar", types: ["warranty"], columns: ["name", "item"], calendar: { dates: { warranty: "expires" } } }),
	],
	workflows: [
		wf(
			"wf-hm-expiring",
			"Warranty about to expire",
			["warranty"],
			{ kind: "date", field: "expires", offset: -30, at: "09:00", limit: 50 },
			[
				{ kind: "tag", op: "add", tag: "expiring-soon" },
				{ kind: "notice", text: "The {[Name]} warranty runs out in 30 days." },
			],
			{ when: { mode: "all", items: [{ field: "status", op: "any-of", value: ["active"] }] } },
		),
		wf("wf-hm-expired", "Warranty expired", ["warranty"], { kind: "date", field: "expires", offset: 1, at: "09:00", limit: 50 }, [{ kind: "set", field: "status", value: "", fixed: "expired" }, { kind: "tag", op: "remove", tag: "expiring-soon" }], {
			when: { mode: "all", items: [{ field: "status", op: "any-of", value: ["active"] }] },
		}),
	],
};

/** The packs the gallery offers, in order. */
export const GALLERY: TypePack[] = [STARTER, CRM, DELIVERY, READING, RESEARCH, KNOWLEDGE, HOME];
