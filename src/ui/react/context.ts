import { createContext, useContext, useSyncExternalStore } from "react";
import type EntitiesPlugin from "../../main";

export const PluginContext = createContext<EntitiesPlugin | null>(null);

export function usePlugin(): EntitiesPlugin {
	const plugin = useContext(PluginContext);
	if (!plugin) throw new Error("PluginContext missing");
	return plugin;
}

/** Re-render whenever the relation index is rebuilt (which follows every entity/metadata change). */
export function useRelationsVersion(): number {
	const plugin = usePlugin();
	return useSyncExternalStore(
		(cb) => {
			const ref = plugin.relations.on("updated", cb);
			return () => plugin.relations.offref(ref);
		},
		() => plugin.relations.version,
	);
}
