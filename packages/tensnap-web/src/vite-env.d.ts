/// <reference types="vite/client" />

declare module '*.mjs' {
	export const messages: Record<string, string>;
}

declare const __APP_VERSION__: string;
