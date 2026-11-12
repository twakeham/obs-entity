/**
 * The flagship example pack: a system-neutral fantasy campaign manager. It's meant to show what the plugin does, so it
 * uses every field kind (roll-ups and formulas too), layouts with frames, columns, tabs, conditions and workflow buttons,
 * validation rules, smart defaults, coloured and valued choices, labelled and two-way links, nesting and folder rules,
 * templates with views inside them, views of every layout with summaries, highlights, data bars and colour scales, and
 * workflows of every trigger with most kinds of step.
 */
import type { LayoutField, LayoutNode } from "./formLayout";
import type { PackView, TypePack } from "./packs";
import type { EntityTypeDef, FieldDef } from "./types";
import type { FilterGroup } from "./views";
import type { WorkflowDef, WorkflowStep, WorkflowTrigger } from "./workflows";

const f = (key: string, label: string, kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });
const rel = (key: string, label: string, targets: string[], extra: Partial<FieldDef> = {}): FieldDef => f(key, label, "relation", { targets, ...extra });
const roll = (key: string, label: string, rollup: NonNullable<FieldDef["rollup"]>, extra: Partial<FieldDef> = {}): FieldDef => f(key, label, "rollup", { rollup, ...extra });
const fx = (key: string, label: string, formula: string, extra: Partial<FieldDef> = {}): FieldDef => f(key, label, "formula", { formula, ...extra });
const type = (t: Omit<EntityTypeDef, "builtIn" | "template"> & { template?: string }): EntityTypeDef => ({ template: `${t.name}.md`, builtIn: false, ...t });
const NONE: FilterGroup = { mode: "all", items: [] };
const where = (field: string, op: string, value?: unknown): FilterGroup => ({ mode: "all", items: [{ field, op, ...(value !== undefined ? { value } : {}) }] });
const wf = (id: string, name: string, scope: string[], trigger: WorkflowTrigger, steps: WorkflowStep[], extra: Partial<WorkflowDef> = {}): WorkflowDef => ({ id, name, on: false, scope, trigger, when: NONE, steps, ...extra });
/** A view note: `path` is where it is in the pack, so the workflows offered on it follow it. */
const view = (name: string, def: Record<string, unknown>): PackView => ({ name, path: `Views/${name}.md`, view: def });
const VIEW = (name: string) => `Views/${name}.md`;
const field = (key: string, extra: Partial<Omit<LayoutField, "kind" | "key">> = {}): LayoutField => ({ kind: "field", key, ...extra });
const cols = (...columns: LayoutNode[][]): LayoutNode => ({ kind: "columns", columns });

/** A view block in a template: the notes of a type that link to this note through `via`. */
const embedded = (types: string[], via: string, columns: string[], extra = ""): string =>
	["```entity-view", "kind: table", `types: [${types.join(", ")}]`, `columns: [${columns.join(", ")}]`, "filters:", "  all:", `    - field: ${via}`, "      op: links-any", '      value: ["{this}"]', ...(extra ? [extra] : []), "```"].join("\n");

const LEVEL = { Low: "green", Moderate: "yellow", High: "orange", Deadly: "red" } as const;

// ---------------------------------------------------------------- types

const TYPES: EntityTypeDef[] = [
	type({
		key: "campaign",
		name: "Campaign",
		plural: "Campaigns",
		icon: "crown",
		color: "#9c27b0",
		group: "table",
		folderMode: "own",
		shortcuts: ["camp"],
		sections: ["Pitch", "Session log"],
		statuses: ["planning", "active", "on-hold", "finished"],
		statusColors: { planning: "blue", active: "green", "on-hold": "yellow", finished: "grey" },
		card: { subtitle: ["system", "schedule"] },
		fields: [
			f("system", "System", "text", { inModal: true, description: "The rules you play with.", default: "Any" }),
			f("abbreviation", "Short name", "text", { inModal: true, rules: { pattern: "^[A-Z0-9]{2,6}$", patternMessage: "2 to 6 capital letters or digits, e.g. COS." } }),
			f("schedule", "Schedule", "select", { options: ["Weekly", "Fortnightly", "Monthly", "Irregular"], inModal: true }),
			f("start", "Started", "date", { defaultFrom: { kind: "relative", spec: "today" } }),
			f("end", "Ended", "date", { rules: { compare: { op: "after", field: "start" } } }),
			f("table_rules", "Table rules", "list", { description: "Safety tools, house rules, expectations." }),
			roll("party_size", "Party size", { via: "in:pc.campaign", agg: "count", where: { mode: "all", items: [{ field: "status", op: "any-of", value: ["active"] }] } }),
			roll("sessions_played", "Sessions played", { via: "in:session.campaign", agg: "count", where: { mode: "all", items: [{ field: "status", op: "any-of", value: ["played"] }] } }),
			roll("hours_played", "Hours played", { via: "in:session.campaign", agg: "sum", field: "duration" }, { format: "#,##0.# h" }),
			roll("next_session", "Next session", { via: "in:session.campaign", agg: "earliest", field: "date", where: { mode: "all", items: [{ field: "status", op: "any-of", value: ["planned"] }] } }, { format: "relative" }),
			roll("open_quests", "Open quests", { via: "in:quest.campaign", agg: "count", where: { mode: "all", items: [{ field: "status", op: "any-of", value: ["active"] }] } }),
		],
	}),
	type({
		key: "session",
		name: "Session",
		plural: "Sessions",
		icon: "dices",
		color: "#3f51b5",
		group: "table",
		folderMode: "parent",
		parentFields: ["campaign"],
		shortcuts: ["ses"],
		sections: ["Prep", "Recap", "Loose threads"],
		statuses: ["planned", "played", "cancelled"],
		statusColors: { planned: "blue", played: "green", cancelled: "grey" },
		card: { subtitle: ["number", "date"] },
		fields: [
			rel("campaign", "Campaign", ["campaign"], { inverse: "Sessions", required: true, inModal: true }),
			f("number", "Number", "number", { defaultFrom: { kind: "auto" }, rules: { integer: true, min: 1 }, inModal: true }),
			f("date", "Date", "date", { defaultFrom: { kind: "relative", spec: "today+7d" }, format: "ddd D MMM YYYY", inModal: true }),
			f("duration", "Duration (h)", "number", { rules: { min: 0, max: 24 }, format: "#,##0.# h" }),
			f("in_world_date", "In-world date", "text", { description: "When it happens in the story." }),
			rel("pcs", "Party present", ["pc"], { multiple: true, inverse: "Sessions" }),
			rel("npcs", "NPCs met", ["npc"], { multiple: true, inverse: "Appeared in" }),
			rel("locations", "Places visited", ["location"], { multiple: true, inverse: "Visited in" }),
			f("summary", "Summary", "textarea", { rules: { requiredWhen: { all: [{ field: "status", op: "any-of", value: ["played"] }] } } }),
			f("highlights", "Highlights", "list"),
			rel("mvp", "Player of the night", ["pc"], { inverse: "MVP in" }),
			f("xp_awarded", "XP each", "number", { rules: { min: 0, integer: true } }),
		],
		form: {
			layout: {
				items: [
					{
						kind: "tabs",
						tabs: [
							{
								caption: "Session",
								icon: "dices",
								items: [cols([field("number")], [field("date")], [field("duration")]), field("campaign"), field("in_world_date", { placeholder: "e.g. the 3rd of Frostfall" }), field("summary", { rows: 5 })],
							},
							{ caption: "Who and where", icon: "users", items: [field("pcs"), field("npcs"), field("locations")] },
							{
								caption: "Recap",
								icon: "sparkles",
								when: { all: [{ field: "status", op: "any-of", value: ["played"] }] },
								items: [field("highlights"), cols([field("mvp")], [field("xp_awarded")]), field("wf:wf-tt-number-title")],
							},
						],
					},
				],
			},
		},
	}),
	type({
		key: "pc",
		name: "Player character",
		plural: "Player characters",
		icon: "shield",
		color: "#4caf50",
		group: "cast",
		shortcuts: ["pc"],
		sections: ["Backstory", "Goals", "Notes"],
		statuses: ["active", "retired", "dead"],
		statusColors: { active: "green", retired: "blue", dead: "red" },
		card: { subtitle: ["ancestry", "class", "level"] },
		fields: [
			f("player", "Player", "text", { required: true, inModal: true }),
			rel("campaign", "Campaign", ["campaign"], { inverse: "Party", inModal: true }),
			f("ancestry", "Ancestry", "select", { options: ["Human", "Elf", "Dwarf", "Halfling", "Gnome", "Orc", "Other"], inModal: true }),
			f("class", "Class", "select", { options: ["Fighter", "Wizard", "Rogue", "Cleric", "Ranger", "Bard", "Druid", "Paladin", "Other"], inModal: true }),
			f("level", "Level", "number", { default: 1, rules: { integer: true, min: 1, max: 20 }, inModal: true }),
			f("xp", "XP", "number", { default: 0, rules: { min: 0, integer: true }, format: "#,##0" }),
			f("hp", "Hit points", "number", { rules: { integer: true, min: 0 } }),
			f("max_hp", "Max hit points", "number", { rules: { integer: true, min: 1 } }),
			fx("hp_percent", "Health", "if([max_hp] > 0, round([hp] / [max_hp] * 100), 0)", { format: "percent" }),
			f("languages", "Languages", "multiselect", { options: ["Common", "Elvish", "Dwarvish", "Draconic", "Infernal", "Sylvan", "Thieves' cant"], rules: { maxItems: 6 } }),
			rel("bonds", "Bonds", ["pc", "npc"], { multiple: true, labelled: true, inverse: "Bonds", description: "Who matters to them, and how: label each link (rival, mentor, sibling)." }),
			rel("factions", "Allegiances", ["faction"], { multiple: true, inverse: "Allies in the party" }),
			f("sheet", "Character sheet", "url", { format: "domain" }),
			roll("inventory_value", "Inventory value", { via: "in:item.holder", agg: "sum", field: "value" }, { format: "#,##0 gp" }),
			roll("carried", "Carried weight", { via: "in:item.holder", agg: "sum", field: "weight" }, { format: "#,##0.# lb" }),
		],
		form: {
			layout: {
				items: [
					{
						kind: "frame",
						caption: "Character",
						icon: "shield",
						color: "green",
						header: "solid",
						items: [cols([field("player"), field("campaign")], [field("ancestry"), field("class")]), cols([field("level")], [field("xp")]), cols([field("wf:wf-tt-award-xp")], [field("wf:wf-tt-level-up")])],
					},
					{ kind: "frame", caption: "Health", icon: "heart-pulse", color: "red", style: "filled", items: [cols([field("hp")], [field("max_hp")], [field("hp_percent", { readOnly: true })])] },
					{
						kind: "tabs",
						tabs: [
							{ caption: "Story", icon: "scroll", items: [field("bonds"), field("factions"), field("languages")] },
							{ caption: "Gear", icon: "backpack", items: [cols([field("inventory_value")], [field("carried")]), field("sheet")] },
						],
					},
				],
			},
		},
	}),
	type({
		key: "npc",
		name: "NPC",
		plural: "NPCs",
		icon: "user-round",
		color: "#ff9800",
		group: "cast",
		shortcuts: ["npc"],
		sections: ["Description", "Secrets", "Notes"],
		statuses: ["alive", "missing", "dead"],
		statusColors: { alive: "green", missing: "yellow", dead: "grey" },
		card: { subtitle: ["role"] },
		fields: [
			f("role", "Role", "text", { inModal: true }),
			f("attitude", "Attitude", "select", {
				options: ["Hostile", "Unfriendly", "Neutral", "Friendly", "Allied"],
				colors: { Hostile: "red", Unfriendly: "orange", Neutral: "grey", Friendly: "green", Allied: "blue" },
				valued: true,
				values: { Hostile: -2, Unfriendly: -1, Neutral: 0, Friendly: 1, Allied: 2 },
				showValues: true,
				default: "Neutral",
				inModal: true,
			}),
			rel("faction", "Faction", ["faction"], { inverse: "Members", inModal: true }),
			rel("location", "Based at", ["location"], { inverse: "Residents", inModal: true }),
			rel("relationships", "Relationships", ["npc", "pc"], { multiple: true, labelled: true, inverse: "Known by" }),
			f("voice", "Voice and mannerisms", "text"),
			f("secret", "Secret", "textarea", { description: "What the players don't know yet." }),
			f("first_met", "First met", "date"),
			f("last_seen", "Last seen", "date", { format: "relative" }),
		],
		form: {
			layout: {
				items: [
					cols([field("role"), field("attitude")], [field("faction"), field("location")]),
					{
						kind: "tabs",
						tabs: [
							{ caption: "Roleplay", icon: "drama", items: [field("voice", { placeholder: "Gravelly, never finishes a sentence" }), field("relationships"), field("wf:wf-tt-give-quest")] },
							{ caption: "GM only", icon: "eye-off", items: [field("secret", { rows: 4 })] },
							{ caption: "History", icon: "hourglass", items: [cols([field("first_met")], [field("last_seen")])] },
						],
					},
				],
			},
		},
	}),
	type({
		key: "faction",
		name: "Faction",
		plural: "Factions",
		icon: "castle",
		color: "#f44336",
		group: "world",
		shortcuts: ["fac"],
		sections: ["Goals", "Resources", "Notes"],
		statuses: ["rising", "steady", "waning", "destroyed"],
		card: { subtitle: ["kind"] },
		fields: [
			f("kind", "Kind", "select", { options: ["Guild", "Cult", "Noble house", "Military", "Merchant", "Criminal", "Religious", "Other"], inModal: true }),
			rel("leader", "Leader", ["npc"], { inverse: "Leads", inModal: true }),
			rel("headquarters", "Headquarters", ["location"], { inverse: "Headquarters of" }),
			f("influence", "Influence", "select", { options: ["Local", "Regional", "National", "Global"], valued: true, values: { Local: 1, Regional: 2, National: 3, Global: 4 } }),
			f("standing", "Party standing", "number", { default: 0, rules: { integer: true, min: -10, max: 10 }, description: "From -10 (sworn enemies) to 10 (champions)." }),
			fx("reputation", "Reputation", 'ifs([standing] >= 5, "Revered", [standing] >= 1, "Friendly", [standing] <= -5, "Hated", [standing] <= -1, "Distrusted", "Neutral")'),
			f("goals", "Goals", "list"),
			rel("allies", "Allies", ["faction"], { multiple: true, symmetric: true, inverse: "Allies" }),
			rel("rivals", "Rivals", ["faction"], { multiple: true, symmetric: true, inverse: "Rivals" }),
			roll("members", "Members", { via: "in:npc.faction", agg: "count" }),
		],
	}),
	type({
		key: "location",
		name: "Location",
		plural: "Locations",
		icon: "map-pin",
		color: "#009688",
		group: "world",
		shortcuts: ["loc"],
		sections: ["Description", "Points of interest", "Here"],
		parentFields: ["part_of"],
		statuses: ["unexplored", "explored", "cleared"],
		card: { subtitle: ["kind"] },
		fields: [
			f("kind", "Kind", "select", { options: ["Plane", "Continent", "Region", "City", "Town", "Village", "Dungeon", "Building", "Room", "Landmark"], inModal: true }),
			rel("part_of", "Part of", ["location"], { inverse: "Contains", inModal: true }),
			f("danger", "Danger", "select", {
				options: ["Safe", "Low", "Moderate", "High", "Deadly"],
				colors: { Safe: "green", ...LEVEL },
				valued: true,
				values: { Safe: 0, Low: 1, Moderate: 2, High: 3, Deadly: 4 },
				inModal: true,
			}),
			rel("controlled_by", "Controlled by", ["faction"], { inverse: "Territory" }),
			f("population", "Population", "number", { rules: { integer: true, min: 0 }, format: "#,##0" }),
			f("discovered", "Discovered by the party", "boolean", { format: "yesno" }),
			f("map", "Map", "url", { format: "text:Open map" }),
		],
	}),
	type({
		key: "quest",
		name: "Quest",
		plural: "Quests",
		icon: "scroll",
		color: "#ffc107",
		group: "table",
		folderMode: "parent",
		parentFields: ["campaign"],
		shortcuts: ["q"],
		sections: ["Hook", "Objectives", "Outcome"],
		statuses: ["rumoured", "active", "completed", "failed"],
		statusColors: { rumoured: "purple", active: "blue", completed: "green", failed: "red" },
		card: { subtitle: ["priority"] },
		fields: [
			rel("campaign", "Campaign", ["campaign"], { inverse: "Quests", inModal: true }),
			f("priority", "Priority", "select", { options: ["Main", "Side", "Personal"], colors: { Main: "red", Side: "blue", Personal: "purple" }, inModal: true }),
			rel("giver", "Quest giver", ["npc"], { inverse: "Quests given", inModal: true }),
			rel("location", "Where", ["location"], { inverse: "Quests here" }),
			f("objectives", "Objectives", "list"),
			f("reward_gold", "Gold reward", "number", { rules: { min: 0 }, format: "#,##0 gp" }),
			f("xp_reward", "XP reward", "number", { rules: { min: 0, integer: true } }),
			rel("reward_items", "Item rewards", ["item"], { multiple: true, inverse: "Reward for" }),
			f("deadline", "Deadline", "date"),
			fx("days_left", "Days left", 'dateDiff(today(), [deadline], "days")'),
			f("completed_on", "Completed", "date"),
		],
	}),
	type({
		key: "item",
		name: "Item",
		plural: "Items",
		icon: "gem",
		color: "#e91e63",
		group: "world",
		shortcuts: ["it"],
		sections: ["Description", "History"],
		parentFields: ["holder"],
		statuses: ["owned", "lost", "destroyed"],
		card: { subtitle: ["rarity", "kind"] },
		fields: [
			f("kind", "Kind", "select", { options: ["Weapon", "Armour", "Potion", "Scroll", "Wondrous", "Treasure", "Tool", "Other"], inModal: true }),
			f("rarity", "Rarity", "select", {
				options: ["Common", "Uncommon", "Rare", "Very rare", "Legendary"],
				colors: { Common: "grey", Uncommon: "green", Rare: "blue", "Very rare": "purple", Legendary: "orange" },
				valued: true,
				values: { Common: 1, Uncommon: 2, Rare: 3, "Very rare": 4, Legendary: 5 },
				inModal: true,
			}),
			rel("holder", "Carried by", ["pc"], { inverse: "Inventory", inModal: true }),
			rel("location", "Kept at", ["location"], { inverse: "Items here" }),
			f("value", "Value", "number", { rules: { min: 0 }, format: "#,##0 gp" }),
			f("weight", "Weight", "number", { rules: { min: 0 }, format: "#,##0.# lb" }),
			f("magical", "Magical", "boolean"),
			f("attuned", "Attuned", "boolean", { format: "check" }),
			f("properties", "Properties", "multiselect", { options: ["Cursed", "Sentient", "Two-handed", "Finesse", "Consumable", "Light", "Heavy"] }),
		],
		form: {
			layout: {
				items: [
					cols([field("kind"), field("rarity")], [field("holder"), field("location")]),
					cols([field("value")], [field("weight")]),
					{ kind: "frame", caption: "Magic", icon: "wand-sparkles", color: "purple", collapsible: true, when: { all: [{ field: "magical", op: "checked" }] }, items: [field("attuned", { label: "beside" }), field("properties")] },
					field("magical", { label: "beside", help: { text: "Tick to show its magic." } }),
					field("wf:wf-tt-drop-item"),
				],
			},
		},
	}),
	type({
		key: "creature",
		name: "Creature",
		plural: "Creatures",
		icon: "skull",
		color: "#795548",
		group: "world",
		shortcuts: ["cr"],
		sections: ["Description", "Tactics", "Loot"],
		statuses: ["known", "legend"],
		card: { subtitle: ["kind", "challenge"] },
		fields: [
			f("kind", "Kind", "select", { options: ["Beast", "Undead", "Fiend", "Dragon", "Humanoid", "Aberration", "Construct", "Elemental", "Fey", "Monstrosity"], inModal: true }),
			f("challenge", "Challenge", "number", { rules: { min: 0, max: 30 }, inModal: true }),
			f("hp", "Hit points", "number", { rules: { integer: true, min: 1 } }),
			f("armour", "Armour", "number", { rules: { integer: true, min: 0 } }),
			rel("habitat", "Habitat", ["location"], { multiple: true, inverse: "Creatures" }),
			f("abilities", "Abilities", "list"),
			f("source", "Stat block", "url", { format: "domain" }),
		],
	}),
	type({
		key: "encounter",
		name: "Encounter",
		plural: "Encounters",
		icon: "swords",
		color: "#b71c1c",
		group: "table",
		folderMode: "parent",
		parentFields: ["session"],
		shortcuts: ["enc"],
		sections: ["Set-up", "Tactics", "Aftermath"],
		statuses: ["prepared", "run", "skipped"],
		statusColors: { prepared: "blue", run: "green", skipped: "grey" },
		card: { subtitle: ["difficulty"] },
		fields: [
			rel("session", "Session", ["session"], { inverse: "Encounters", inModal: true }),
			rel("location", "Where", ["location"], { inverse: "Encounters", inModal: true }),
			rel("creatures", "Creatures", ["creature", "npc"], { multiple: true, labelled: true, inverse: "Encounters", rules: { minItems: 1 }, description: "Label each with how many, e.g. ×3.", inModal: true }),
			f("difficulty", "Difficulty", "select", { options: ["Trivial", "Low", "Moderate", "High", "Deadly"], colors: { Trivial: "grey", ...LEVEL }, valued: true, values: { Trivial: 0, Low: 1, Moderate: 2, High: 3, Deadly: 4 }, inModal: true }),
			roll("total_challenge", "Total challenge", { via: "field:creatures", agg: "sum", field: "challenge" }),
			fx("risk", "Risk", "value([difficulty]) * max(1, [total_challenge])"),
			f("outcome", "Outcome", "select", { options: ["Victory", "Retreat", "Defeat", "Avoided"], rules: { requiredWhen: { all: [{ field: "status", op: "any-of", value: ["run"] }] } } }),
			f("xp", "XP", "number", { rules: { min: 0, integer: true } }),
		],
	}),
	type({
		key: "lore",
		name: "Lore",
		plural: "Lore",
		icon: "book-marked",
		color: "#607d8b",
		group: "world",
		shortcuts: ["lore"],
		sections: ["What's said", "What's true"],
		statuses: ["hidden", "hinted", "revealed"],
		statusColors: { hidden: "grey", hinted: "yellow", revealed: "green" },
		card: { subtitle: ["category"] },
		fields: [
			f("category", "Category", "select", { options: ["History", "Religion", "Legend", "Prophecy", "Rumour", "Secret"], inModal: true }),
			f("reliability", "Reliability", "select", { options: ["False", "Doubtful", "Likely", "True"], colors: { False: "red", Doubtful: "orange", Likely: "yellow", True: "green" }, valued: true, values: { False: 0, Doubtful: 1, Likely: 2, True: 3 } }),
			rel("about", "About", ["*"], { multiple: true, inverse: "Lore", inModal: true }),
			rel("revealed_in", "Revealed in", ["session"], { inverse: "Lore revealed" }),
			f("recorded", "Recorded", "date"),
		],
	}),
];

// ---------------------------------------------------------------- templates (with views inside them)

const TEMPLATES: Record<string, string> = {
	campaign: [
		"## Pitch",
		"",
		"## Party",
		embedded(["pc"], "campaign", ["name", "player", "ancestry", "class", "level", "hp_percent"], "sort: [{ by: level, dir: desc }]"),
		"",
		"## Sessions",
		embedded(["session"], "campaign", ["name", "number", "date", "status", "duration", "xp_awarded"], "sort: [{ by: number, dir: desc }]\nsummary: { duration: sum, xp_awarded: sum }"),
		"",
		"## Open quests",
		embedded(["quest"], "campaign", ["name", "priority", "giver", "deadline", "reward_gold"], "sort: [{ by: deadline, dir: asc }]"),
		"",
		"## Session log",
		"",
	].join("\n"),
	location: ["## Description", "", "## Points of interest", "", "## Here", embedded(["location"], "part_of", ["name", "kind", "danger", "population"]), "", "### Who lives here", embedded(["npc"], "location", ["name", "role", "attitude", "faction"]), ""].join("\n"),
	faction: ["## Goals", "", "## Members", embedded(["npc"], "faction", ["name", "role", "attitude", "location", "status"], "sort: [{ by: name, dir: asc }]"), "", "## Notes", ""].join("\n"),
};

// ---------------------------------------------------------------- views

const VIEWS: PackView[] = [
	view("Party", {
		kind: "table",
		types: ["pc"],
		columns: ["name", "player", "ancestry", "class", "level", "xp", "hp", "max_hp", "hp_percent", "inventory_value", "status"],
		freeze: "name",
		density: "comfortable",
		summary: { level: "avg", xp: "sum", inventory_value: "sum" },
		sort: [{ by: "level", dir: "desc" }],
		filters: { all: [{ field: "status", op: "any-of", value: ["active"] }] },
		highlight: [
			{ name: "Health", kind: "bar", target: "hp_percent", when: { all: [] }, style: {}, bar: { color: "green", min: 0, max: 100 } },
			{ name: "Wounded", target: "hp_percent", when: { all: [{ field: "hp_percent", op: "<", value: 25 }] }, style: { text: "red", bold: true, icon: "heart-pulse" } },
		],
		workflowBar: true,
	}),
	view("Session log", {
		kind: "table",
		types: ["session"],
		columns: ["name", "number", "date", "status", "duration", "pcs", "summary", "xp_awarded"],
		fill: "summary",
		wrap: ["summary"],
		wrapLines: 3,
		formats: { date: "ddd D MMM YYYY" },
		summary: { name: "count", duration: "sum", xp_awarded: "sum" },
		group: [{ by: "campaign" }],
		sort: [{ by: "number", dir: "desc" }],
		highlight: [{ target: "row", when: { all: [{ field: "status", op: "any-of", value: ["cancelled"] }] }, style: { text: "grey", strike: true } }],
	}),
	view("Campaign calendar", {
		kind: "calendar",
		types: ["session", "quest"],
		columns: ["name", "status", "campaign"],
		calendar: { dates: { session: "date", quest: "deadline" }, colorBy: "status" },
	}),
	view("Quest board", {
		kind: "board",
		types: ["quest"],
		columns: ["name", "status", "priority", "giver", "deadline", "days_left", "reward_gold", "campaign"],
		board: { buckets: "status", swimlanes: "priority", cardFields: ["giver", "deadline", "reward_gold"], cardSubtitle: true },
		highlight: [{ target: "days_left", when: { all: [{ field: "days_left", op: "<", value: 7 }, { field: "status", op: "any-of", value: ["active"] }] }, style: { fill: "orange", icon: "hourglass" } }],
	}),
	view("NPC directory", {
		kind: "table",
		types: ["npc"],
		columns: ["name", "role", "attitude", "faction", "location", "last_seen", "status"],
		group: [{ by: "faction" }],
		sort: [{ by: "name", dir: "asc" }],
		summary: { name: "count" },
		highlight: [{ target: "row", when: { all: [{ field: "status", op: "any-of", value: ["dead"] }] }, style: { text: "grey", strike: true } }],
	}),
	view("Factions", {
		kind: "table",
		types: ["faction"],
		columns: ["name", "kind", "influence", "standing", "reputation", "leader", "headquarters", "members", "status"],
		sort: [{ by: "standing", dir: "desc" }],
		highlight: [{ name: "Standing", kind: "scale", target: "standing", when: { all: [] }, style: {}, scale: { colors: ["red", "yellow", "green"], min: -10, mid: 0, max: 10 } }],
	}),
	view("World atlas", {
		kind: "table",
		types: ["location"],
		columns: ["name", "kind", "tree-path", "danger", "controlled_by", "population", "discovered", "status"],
		// Choices sort in their order (Plane, Continent, Region, City …): broadest places first.
		sort: [
			{ by: "kind", dir: "asc" },
			{ by: "name", dir: "asc" },
		],
		summary: { population: "sum" },
	}),
	view("Treasury", {
		kind: "table",
		types: ["item"],
		columns: ["name", "kind", "rarity", "value", "weight", "attuned", "location"],
		group: [{ by: "holder" }],
		sort: [{ by: "value", dir: "desc" }],
		summary: { value: "sum", weight: "sum" },
		filters: { all: [{ field: "status", op: "any-of", value: ["owned"] }] },
		highlight: [{ name: "Value", kind: "bar", target: "value", when: { all: [] }, style: {}, bar: { color: "yellow", gradient: true } }],
	}),
	view("Bestiary", {
		kind: "table",
		types: ["creature"],
		columns: ["name", "kind", "challenge", "hp", "armour", "habitat"],
		group: [{ by: "kind" }],
		sort: [{ by: "challenge", dir: "desc" }],
		highlight: [{ name: "Challenge", kind: "scale", target: "challenge", when: { all: [] }, style: {}, scale: { colors: ["green", "yellow", "red"] } }],
	}),
	view("Encounter planner", {
		kind: "board",
		types: ["encounter"],
		columns: ["name", "status", "session", "location", "difficulty", "total_challenge", "risk", "creatures"],
		board: { buckets: "status", swimlanes: "difficulty", cardFields: ["session", "location", "total_challenge"], cardLabels: true },
	}),
	view("Lore and secrets", {
		kind: "table",
		types: ["lore"],
		columns: ["name", "category", "reliability", "about", "revealed_in", "status"],
		group: [{ by: "status" }],
		sort: [{ by: "recorded", dir: "desc" }],
	}),
];

// ---------------------------------------------------------------- workflows

const ACTIVE_PLANNED: FilterGroup = where("status", "any-of", ["planned"]);

const WORKFLOWS: WorkflowDef[] = [
	// A form that starts on its own: from the ribbon, a command, and the Session log's toolbar.
	wf(
		"wf-tt-log-session",
		"Log a session",
		[],
		{
			kind: "form",
			title: "Log a session",
			button: "Log it",
			icon: "dices",
			fields: [
				rel("campaign", "Campaign", ["campaign"], { required: true }),
				f("date", "Date", "date", { required: true, defaultFrom: { kind: "relative", spec: "today" } }),
				f("title", "Title", "text", { required: true, description: "What happened, in a few words: it names the session note." }),
				f("summary", "Summary", "textarea"),
				rel("present", "Party present", ["pc"], { multiple: true }),
				rel("met", "NPCs met", ["npc"], { multiple: true }),
				f("xp_each", "XP each", "number", { default: 0, rules: { min: 0, integer: true } }),
			],
			layout: {
				items: [
					{ kind: "frame", caption: "Session", icon: "dices", items: [cols([field("campaign")], [field("date")]), field("title", { placeholder: "The siege of Greyhold" }), field("summary", { rows: 4 })] },
					{ kind: "frame", caption: "Who was there", icon: "users", items: [field("present"), field("met"), field("xp_each")] },
				],
			},
		},
		[
			{
				kind: "create",
				type: "session",
				name: "{[Title]}",
				fields: [
					{ field: "campaign", value: "[Campaign]" },
					{ field: "date", value: "[Date]" },
					{ field: "summary", value: "[Summary]" },
					{ field: "pcs", value: "[Party present]" },
					{ field: "npcs", value: "[NPCs met]" },
					{ field: "xp_awarded", value: "[XP each]" },
					{ field: "status", value: "", fixed: "played" },
				],
				template: true,
				open: "tab",
				exists: "new",
				as: "New session",
			},
			{ kind: "each", formula: "[Party present]", items: "notes", itemType: "pc", when: NONE, as: "Hero", steps: [{ kind: "set", field: "xp", value: "[xp] + [XP each]" }] },
			{ kind: "each", formula: "[NPCs met]", items: "notes", itemType: "npc", when: NONE, as: "Contact", steps: [{ kind: "set", field: "last_seen", value: "[Date]" }] },
			{ kind: "append", text: '- {format([Date], "D MMM YYYY")}: [[{name(first([New session]))}]]: {[Summary]}', where: "heading", heading: "## Session log", on: "Campaign" },
			{ kind: "notice", text: "Logged {name(first([New session]))}: {count([Party present])} heroes got {[XP each]} XP." },
		],
		{ command: true, ribbon: true, isolated: true, views: [VIEW("Session log")] },
	),
	// When a field changes: a variable, loops over linked notes, adding text to another note.
	wf("wf-tt-wrap-up", "Session wrap-up", ["session"], { kind: "changed", field: "status", to: ["played"] }, [
		{ kind: "var", name: "Session title", value: "[Name]" },
		{ kind: "var", name: "Played on", value: "[date]" },
		{ kind: "linked", source: { dir: "out", field: "npcs" }, when: NONE, as: "NPC", steps: [{ kind: "set", field: "last_seen", value: "[Played on]" }] },
		{
			kind: "linked",
			source: { dir: "out", field: "campaign" },
			when: NONE,
			as: "Its campaign",
			steps: [{ kind: "append", text: '- {format([Played on], "D MMM YYYY")}: [[{[Session title]}]]', where: "heading", heading: "## Session log" }],
		},
		{ kind: "notice", text: "Wrapped up {[Session title]}." },
	]),
	wf("wf-tt-quest-done", "Quest completed", ["quest"], { kind: "changed", field: "status", to: ["completed"] }, [
		{ kind: "set", field: "completed_on", value: "", fixed: "today" },
		{ kind: "tag", op: "remove", tag: "lead" },
		{ kind: "if", test: "formula", when: NONE, formula: "[xp_reward] > 0", steps: [{ kind: "notice", text: "Award {[xp_reward]} XP for {[Name]}." }], otherwise: [] },
	]),
	// Asking first, then moving the note.
	wf("wf-tt-fallen", "Lay the fallen to rest", ["npc"], { kind: "changed", field: "status", to: ["dead"] }, [
		{ kind: "tag", op: "add", tag: "fallen" },
		{ kind: "ask", text: "Move {[Name]} to the Graveyard folder?" },
		{ kind: "move", to: "folder", folder: "Graveyard" },
	]),
	// When a note is created.
	wf("wf-tt-new-npc", "Date new NPCs", ["npc"], { kind: "created" }, [
		{ kind: "set", field: "first_met", value: "", fixed: "today" },
		{ kind: "tag", op: "add", tag: "new-face" },
	]),
	wf("wf-tt-new-lore", "Date new lore", ["lore"], { kind: "created" }, [{ kind: "set", field: "recorded", value: "", fixed: "today" }]),
	// Buttons: a question, a calculation, running another workflow.
	wf(
		"wf-tt-award-xp",
		"Award XP",
		["pc"],
		{ kind: "manual", label: "Award XP", icon: "sparkles" },
		[
			{ kind: "input", text: "How much XP?", as: "Gained", default: "100" },
			{ kind: "set", field: "xp", value: "[xp] + number([Gained])" },
			{ kind: "if", test: "formula", when: NONE, formula: "[xp] >= [level] * 1000", steps: [{ kind: "run", workflow: "wf-tt-level-up" }], otherwise: [] },
		],
		{ command: true, views: [VIEW("Party")] },
	),
	wf(
		"wf-tt-level-up",
		"Level up",
		["pc"],
		{ kind: "manual", label: "Level up", icon: "trending-up", confirm: "Raise this character's level by one?" },
		[
			{ kind: "set", field: "level", value: "min(20, [level] + 1)" },
			{ kind: "notice", text: "{[Name]} reaches level {[level]}." },
		],
		{ views: [VIEW("Party")], when: where("level", "<", 20) },
	),
	// One run for the whole selection, going through each selected note.
	wf(
		"wf-tt-long-rest",
		"Long rest",
		["pc"],
		{ kind: "manual", label: "Long rest", icon: "bed", selection: "once" },
		[
			{ kind: "each", formula: "[Selected notes]", items: "notes", itemType: "pc", when: NONE, as: "Hero", steps: [{ kind: "set", field: "hp", value: "[max_hp]" }] },
			{ kind: "notice", text: "{count([Selected notes])} heroes rest and recover." },
		],
		{ views: [VIEW("Party")] },
	),
	// Creating a note linked to this one.
	wf("wf-tt-give-quest", "Give a quest", ["npc"], { kind: "manual", label: "Give a quest", icon: "scroll" }, [
		{
			kind: "create",
			type: "quest",
			name: "{[Name]}'s request",
			fields: [{ field: "status", value: "", fixed: "rumoured" }],
			link: { dir: "from-new", field: "giver" },
			template: true,
			open: "tab",
			exists: "new",
			as: "New quest",
		},
		{ kind: "tag", op: "add", tag: "lead", on: "New quest" },
	]),
	// Finding a note, then linking to it.
	wf(
		"wf-tt-schedule",
		"Schedule for the next session",
		["encounter"],
		{ kind: "manual", label: "Next session", icon: "calendar-plus" },
		[
			{ kind: "find", types: ["session"], when: ACTIVE_PLANNED, sort: { by: "date", dir: "asc" }, keep: "first", as: "Next session" },
			{
				kind: "if",
				test: "formula",
				when: NONE,
				formula: "count([Next session]) > 0",
				steps: [
					{ kind: "link", op: "add", field: "session", target: "[Next session]" },
					{ kind: "notice", text: "{[Name]} is planned for {name(first([Next session]))}." },
				],
				otherwise: [{ kind: "notice", text: "No session is planned yet." }],
			},
		],
		{ views: [VIEW("Encounter planner")] },
	),
	// Clearing a field.
	wf("wf-tt-drop-item", "Drop it", ["item"], { kind: "manual", label: "Drop it", icon: "footprints" }, [
		{ kind: "clear", field: "holder" },
		{ kind: "set", field: "attuned", value: "", fixed: false },
	]),
	// Renaming the note.
	wf("wf-tt-number-title", "Number the title", ["session"], { kind: "manual", label: "Number the title", icon: "hash" }, [
		{ kind: "if", test: "formula", when: NONE, formula: 'not(startsWith([Name], "Session "))', steps: [{ kind: "rename", name: "Session {[number]} – {[Name]}" }], otherwise: [] },
	]),
	// On a schedule, and on a date.
	wf("wf-tt-prep", "Prep reminder", ["session"], { kind: "schedule", every: "week", at: "18:00", day: 5, hours: 0, limit: 20 }, [{ kind: "tag", op: "add", tag: "prep" }, { kind: "notice", text: "Prep {[Name]}: it's on {format([date], \"dddd D MMM\")}." }], {
		when: { mode: "all", items: [{ field: "status", op: "any-of", value: ["planned"] }, { field: "date", op: "between", value: ["today", "+7d"] }] },
	}),
	wf("wf-tt-game-day", "Game day", ["session"], { kind: "date", field: "date", offset: 0, at: "09:00", limit: 20 }, [{ kind: "tag", op: "remove", tag: "prep" }, { kind: "notice", text: "Game day: {[Name]}." }], { when: ACTIVE_PLANNED }),
	wf("wf-tt-deadline", "Quest deadline near", ["quest"], { kind: "date", field: "deadline", offset: -3, at: "09:00", limit: 20 }, [{ kind: "tag", op: "add", tag: "urgent" }, { kind: "notice", text: "{[Name]} is due in 3 days." }], {
		when: where("status", "any-of", ["active"]),
	}),
];

export const TTRPG_PACK: TypePack = {
	obsEntitiesPack: 1,
	id: "ttrpg",
	name: "TTRPG campaign",
	icon: "swords",
	description:
		"Run a tabletop campaign: sessions, the party, NPCs, factions, a world of nested places, quests, treasure, a bestiary, encounters and lore. The showcase pack: forms with tabs, health bars and colour scales, boards, a calendar, and workflows that log sessions, award XP and remind you to prep.",
	groups: [
		{ key: "table", name: "At the table", icon: "dices", statuses: ["planned", "active", "done"] },
		{ key: "cast", name: "Cast", icon: "users", statuses: ["alive", "dead"] },
		{ key: "world", name: "World", icon: "map", statuses: ["known", "forgotten"] },
	],
	types: TYPES,
	views: VIEWS,
	workflows: WORKFLOWS,
	templates: TEMPLATES,
};
