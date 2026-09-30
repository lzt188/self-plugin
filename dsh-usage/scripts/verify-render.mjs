/**
 * verify-render.mjs — mount UsagePanel in jsdom against a primitives module
 * that mirrors the browser exactly, and assert the dock comes up.
 *
 * The bundled offline suites used to serve `primitives` from a Proxy whose
 * `get` trap fabricated a component for ANY requested name, so an icon that
 * the installed @deepseek-ai/dsh-client-ui-primitives build does not export
 * resolved to a perfectly good function and every render stayed green. In the
 * real browser the same lookup is `undefined`, React throws
 * `Element type is invalid: expected a string ... but got: undefined` out of
 * `UsagePanel`, and the entire `sidebar.footer.action` slot entry dies — no
 * dock, no balance panel, no usage popup, no heatmap, and nothing on the
 * server side to blame.
 *
 * The strict export set comes from scripts/strict-primitives.mjs, which reads
 * the build the profile actually serves.
 *
 * Usage: node scripts/verify-render.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { buildStrictPrimitives, primitivesAuthority } from "./strict-primitives.mjs";

const clientSource = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
const asked = [...new Set([...clientSource.matchAll(/primitives\.([A-Za-z0-9_$]+)/g)].map((m) => m[1]))].sort();
const { version, libPath, checked } = primitivesAuthority();
const { primitives, unexported } = buildStrictPrimitives(React, asked);

console.log(`${checked.map((entry) => entry.version).filter(Boolean).join(", ")} available -> strict set from ${version}`);
console.log(`${libPath}\n`);
for (const name of asked) {
	console.log(`  ${name.padEnd(28)} ${primitives[name] === undefined ? "UNDEFINED" : "ok"}`);
}
if (unexported.length > 0) {
	console.log(`\nFAIL: lib/client.js references ${unexported.length} primitives export(s) the served build lacks: ${unexported.join(", ")}`);
	process.exit(1);
}

const dom = new JSDOM(
	'<!doctype html><html><body><aside class="dsh-sidebar"><div id="root"></div></aside></body></html>',
	{ url: "https://localhost/", pretendToBeVisual: true }
);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const media = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
globalThis.matchMedia = media;
dom.window.matchMedia = media;
dom.window.ResizeObserver = globalThis.ResizeObserver;

const errors = [];
const capture = (message) => { if (typeof message === "string") errors.push(message); };
dom.window.console.error = capture;
globalThis.console.error = capture;

const jsxRuntime = await import("react/jsx-runtime");
globalThis.window.__ModuleLoader__ = { load: (declaration) => { globalThis.__DECL__ = declaration; } };
dom.window.eval(clientSource);
if (!globalThis.__DECL__) throw new Error("bundle did not register on the loader");
const mod = globalThis.__DECL__.factory((name) => {
	if (name === "react") return React;
	if (name === "react/jsx-runtime") return jsxRuntime;
	if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error(`unexpected require: ${name}`);
});

let html = "";
try {
	const root = createRoot(document.getElementById("root"));
	// `wide` is what the sidebar footer action actually receives.
	await act(async () => { root.render(React.createElement(mod.UsagePanel, { wide: true, t: (key) => key })); });
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
	html = document.getElementById("root").innerHTML;
	await act(async () => { root.unmount(); });
} catch (error) {
	console.log(`\nFAIL: UsagePanel render threw:\n${error.message}`);
	process.exit(1);
}

const icons = html.split("data-icon=").length - 1;
console.log(`\nrendered ${html.length} chars`);
console.log(`  .u_dock mounted   : ${html.includes('class="u_dock"')}`);
console.log(`  dock icon nodes   : ${icons}`);
console.log(`  invalid-type msgs : ${errors.filter((e) => e.includes("type is invalid")).length}`);

const ok = html.includes('class="u_dock"') && icons > 0;
console.log(ok ? "\nRESULT: OK" : "\nRESULT: BROKEN");
process.exit(ok ? 0 : 1);
