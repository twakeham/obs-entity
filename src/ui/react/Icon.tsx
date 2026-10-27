import { setIcon } from "obsidian";
import { useEffect, useRef } from "react";

export function Icon({ name, className }: { name: string; className?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (!ref.current) return;
		ref.current.empty();
		setIcon(ref.current, name || "file");
	}, [name]);
	return <span ref={ref} className={className ?? "oe-icon"} aria-hidden="true" />;
}
