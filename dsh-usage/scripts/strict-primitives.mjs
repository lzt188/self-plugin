/**
 * strict-primitives.mjs — a primitives mock that cannot hide a typo'd or
 * renamed icon export.
 *
 * Why this exists: the offline suites used to serve `primitives` from a Proxy
 * whose `get` trap fabricated a component for ANY requested name, so an
 * unexported icon resolved to a perfectly good function and the render stayed
 * green. In the browser the same lookup yields `undefined`, and React throws
 * `Element type is invalid: expected a string ... but got: undefined`, killing
 * the whole `sidebar.footer.action` slot entry — the dock, the balance panel,
 * the usage popup and the heatmap all disappear with no server-side trace.
 *
 * The strict set comes from the export list of the installed
 * @deepseek-ai/dsh-client-ui-primitives build that actually backs the profile:
 *
 *   <repo>/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js
 *   D:/Program Code/deepseek-harness/packages/client/ui-primitives/lib/index.js
 *
 * When both exist the higher version wins (the profile junctions into the
 * harness checkout, so a stale workspace copy must not relax the check), and a
 * disagreement is reported loudly rather than silently.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PKG = "@deepseek-ai/dsh-client-ui-primitives";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const CANDIDATES = [
	`${REPO}node_modules/${PKG}/lib/index.js`,
	`D:/Program Code/deepseek-harness/packages/client/ui-primitives/lib/index.js`
];

/** Parse the `export { a, b as c }` blocks of a built ESM file into names. */
export function exportNamesOf(source) {
	const names = new Set();
	for (const match of source.matchAll(/^export\s*\{([\s\S]*?)\}\s*;?\s*$/gm)) {
		for (const raw of match[1].split(",")) {
			const name = raw.trim().split(/\s+as\s+/).pop();
			if (name) names.add(name);
		}
	}
	return names;
}

/** Version of the package owning a built lib path, or null when unreadable. */
function versionOf(libPath) {
	try {
		const pkg = JSON.parse(readFileSync(`${libPath.replace("/lib/index.js", "/package.json")}`, "utf8"));
		return typeof pkg.version === "string" ? pkg.version : null;
	} catch {
		return null;
	}
}

/** Loose semver compare so a prerelease of the same triple still orders. */
function compareVersions(a, b) {
	const pa = String(a).split(/[.\-+]/).map((part) => (/^\d+$/.test(part) ? Number(part) : -1));
	const pb = String(b).split(/[.\-+]/).map((part) => (/^\d+$/.test(part) ? Number(part) : -1));
	for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
		const left = pa[i] ?? 0;
		const right = pb[i] ?? 0;
		if (left !== right) return left - right;
	}
	return 0;
}

/**
 * @returns {{ libPath: string|null, version: string|null, exported: Set<string>, checked: Array<{ path: string, version: string|null }> }}
 */
export function primitivesAuthority() {
	const checked = CANDIDATES
		.map((path) => ({ path, version: existsSync(path) ? versionOf(path) : null }))
		.filter((entry) => existsSync(entry.path));
	checked.sort((a, b) => (a.version === null ? 1 : b.version === null ? -1 : compareVersions(b.version, a.version)));
	if (checked.length > 1) {
		const drift = new Set(checked.map((entry) => entry.version));
		if (drift.size > 1) {
			console.warn(`[strict-primitives] ${PKG} version drift: ${checked.map((e) => `${e.version} @ ${e.path}`).join(", ")}`);
		}
	}
	if (checked.length === 0) return { libPath: null, version: null, exported: new Set(), checked: [] };
	const authority = checked[0];
	return {
		libPath: authority.path,
		version: authority.version,
		exported: exportNamesOf(readFileSync(authority.path, "utf8")),
		checked
	};
}

/**
 * Build the mock handed to the client bundle's `require`.
 * Names the installed build does not export are left `undefined` on purpose —
 * that is the browser behaviour the suites are meant to mirror.
 * @param {object} react - the react module under test.
 * @param {string[]} asked - names the bundle reads off `primitives`.
 */
export function buildStrictPrimitives(react, asked) {
	const { exported, version, libPath } = primitivesAuthority();
	const primitives = {
		Tooltip: function Tooltip(props) {
			return react.createElement(react.Fragment, null, props.children);
		}
	};
	for (const name of asked) {
		if (/^Icon/.test(name)) {
			primitives[name] = exported.has(name)
				? function Icon(props) {
					return react.createElement("span", { "data-icon": name, "data-size": props.size ?? null });
				}
				: undefined;
		}
	}
	return { primitives, version, libPath, unexported: asked.filter((name) => /^Icon/.test(name) && !exported.has(name)) };
}
