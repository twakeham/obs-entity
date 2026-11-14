import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { h } from "vue";
import HeroFeatures from "./HeroFeatures.vue";
import Showcase from "./Showcase.vue";

export default {
	extends: DefaultTheme,
	// The home page: the main features beside the hero text, and the screenshots full width under it.
	Layout: () => h(DefaultTheme.Layout, null, { "home-hero-image": () => h(HeroFeatures), "home-hero-after": () => h(Showcase) }),
} satisfies Theme;
