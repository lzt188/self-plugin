#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { primitivesAuthority } from "./strict-primitives.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const client = readFileSync(join(root, "lib", "client.js"), "utf8");
const runtimePackage = "@deepseek-ai/dsh-client-ui-primitives";
const { version: servedVersion, checked } = primitivesAuthority();
assert.ok(servedVersion !== null, "the installed client UI primitives build must be resolvable");
assert.equal(
	pkg.dependencies?.[runtimePackage],
	servedVersion,
	`${runtimePackage} must pin the exact version the profile serves (${servedVersion}) — a mismatch means lib/client.js was written against a different icon API than the one dsh web injects`
);
assert.ok(
	pkg.dsh?.client?.inject?.includes(runtimePackage),
	`${runtimePackage} must remain in dsh.client.inject`
);
assert.ok(
	client.includes(`require("${runtimePackage}")`),
	"package contract test must track the real client import"
);

console.log("ok package declares and injects client UI runtime dependency");
