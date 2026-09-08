#!/usr/bin/env node
/**
 * dsh-usage — offline server tests.
 * Mock plugin context + fake HTTPS transport; no harness, no network.
 * DSH_HOME is redirected to a temp dir so the usage cache never touches
 * the real profile.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, BALANCE_PATH, PROVIDERS_PATH, USAGE_PATH, isLoopbackAddress } from "../lib/index.js";
import { isPrivateAddress, safeFetch } from "../lib/safe-fetch.js";
import { resetClaudeState } from "../lib/claude.js";

const testHome = await mkdtemp(join(tmpdir(), "dsh-usage-test-"));
process.env.DSH_HOME = testHome;

let passed = 0;
async function test(name, fn) {
	try {
		await fn();
		passed += 1;
		console.log(`ok ${name}`);
	} catch (error) {
		console.error(`FAIL ${name}`);
		throw error;
	}
}

const SETTINGS = {
	get: (ns) => {
		if (ns === "llm-deepseek") return { apiKeyEnv: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com" };
		if (ns === "llm-pi-ai") return { providers: { ark: { displayName: "Ark", apiKeyEnv: "ARK_API_KEY", baseURL: "https://ark.example.com" } } };
		return void 0;
	}
};

function credentials(keys = {}) {
	return { resolve: async (ref) => ({ value: keys[ref] ?? "" }) };
}

function fakeTransport(respond, record = {}) {
	return {
		httpsRequest: (url, options, callback) => {
			record.url = url;
			record.options = options;
			record.calls = (record.calls ?? 0) + 1;
			const req = new EventEmitter();
			req.end = () => {};
			req.destroy = (err) => { record.destroyed = err; };
			queueMicrotask(() => {
				const res = respond(url, options);
				const response = new EventEmitter();
				response.statusCode = res.statusCode;
				response.headers = res.headers ?? {};
				callback(response);
				response.emit("data", Buffer.from(res.body ?? ""));
				response.emit("end");
			});
			return req;
		},
		httpRequest: () => {
			throw new Error("http transport must not be used");
		}
	};
}

const publicLookup = async () => [{ address: "1.2.3.4", family: 4 }];

async function boot(overrides = {}) {
	resetClaudeState();
	const routes = [];
	const effects = [];
	const claudeDir = overrides.claudeDir ?? join(testHome, "no-claude-here");
	const ctx = {
		credentials: void 0,
		webServer: { register: (entry) => routes.push(entry) },
		effect: (fn, label) => {
			const cleanup = fn();
			effects.push({ label, cleanup });
		},
		logger: { warn: () => {}, info: () => {}, debug: () => {} },
		get: (service) => ({
			settings: overrides.settings ?? SETTINGS,
			credentials: overrides.credentials ?? credentials({ DEEPSEEK_API_KEY: "sk-test" }),
			sessions: overrides.sessions ?? { list: () => [] },
			sessionPersistence: overrides.persistence ?? { listSnapshots: async () => [], list: async () => [] }
		})[service]
	};
	await apply(ctx, {}, {
		disableBackgroundRefresh: true,
		claudeDir,
		claudeCachePath: join(testHome, "claude-cache.json"),
		...(overrides.deps ?? {})
	});
	return { routes, effects };
}

function handlerOf(routes, path) {
	const route = routes.find((entry) => entry.path === path);
	assert.ok(route !== void 0, `route ${path} registered`);
	return route.handler;
}

async function call(handler, { method = "GET", url = "/", peer = "127.0.0.1", host = "localhost" } = {}) {
	const res = {
		status: null,
		headers: null,
		body: "",
		writeHead(status, headers) {
			this.status = status;
			this.headers = headers;
		},
		end(body) {
			this.body += body ?? "";
		}
	};
	const req = { method, url, headers: { host }, socket: { remoteAddress: peer } };
	await handler(req, res);
	return res;
}

function parsed(res) {
	return JSON.parse(res.body);
}

//#region routing & fence

await test("apply registers exactly three exact routes", async () => {
	const { routes } = await boot();
	assert.deepEqual(routes.map((r) => r.path).sort(), [BALANCE_PATH, PROVIDERS_PATH, USAGE_PATH].sort());
	for (const route of routes) assert.equal(route.kind, "exact");
});

await test("non-GET methods are refused with 405", async () => {
	const { routes } = await boot();
	const res = await call(handlerOf(routes, BALANCE_PATH), { method: "POST" });
	assert.equal(res.status, 405);
	assert.equal(parsed(res).error, "method-not-allowed");
});

await test("non-loopback peer is refused with 403", async () => {
	const { routes } = await boot();
	const res = await call(handlerOf(routes, BALANCE_PATH), { peer: "10.0.0.1", host: "example.com" });
	assert.equal(res.status, 403);
});

await test("loopback peer with localhost host passes the fence", async () => {
	const { routes } = await boot();
	const res = await call(handlerOf(routes, BALANCE_PATH), { peer: "127.0.0.1", host: "localhost" });
	assert.equal(res.status, 200);
});

//#endregion

//#region balance endpoint

await test("balance: successful DeepSeek query pins DNS and returns normalized view", async () => {
	const record = {};
	const { routes } = await boot({
		deps: {
			lookup: publicLookup,
			transport: fakeTransport(() => ({
				statusCode: 200,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] })
			}), record)
		}
	});
	const res = await call(handlerOf(routes, BALANCE_PATH), { url: "/api/usage/balance?provider=deepseek-official" });
	assert.equal(res.status, 200);
	const body = parsed(res);
	assert.equal(body.ok, true);
	assert.equal(body.account.status, "ok");
	assert.equal(body.account.balance.total, "110.00");
	assert.equal(body.account.balance.currency, "CNY");
	assert.equal(body.account.balance.toppedUp, "100.00");
	assert.equal(String(record.url), "https://api.deepseek.com/user/balance");
	assert.equal(record.options.headers.authorization, "Bearer sk-test");
	assert.equal(record.options.servername, "api.deepseek.com");
	assert.equal(record.options.method, "GET");
	assert.equal(res.body.includes("sk-test"), false, "no key in the response");
});

await test("balance: missing credential → not-configured with the ref name", async () => {
	const { routes } = await boot({ credentials: credentials({}) });
	const res = await call(handlerOf(routes, BALANCE_PATH), { url: "/api/usage/balance?provider=deepseek-official" });
	const body = parsed(res);
	assert.equal(body.ok, true);
	assert.equal(body.account.status, "not-configured");
	assert.deepEqual(body.account.missingCredentials, ["DEEPSEEK_API_KEY"]);
	assert.equal(body.account.balance, null);
});

await test("balance: provider without a scheme is unsupported", async () => {
	const { routes } = await boot();
	const res = await call(handlerOf(routes, BALANCE_PATH), { url: "/api/usage/balance?provider=ark" });
	const body = parsed(res);
	assert.equal(body.ok, true);
	assert.equal(body.account.mode, "unsupported");
	assert.equal(body.account.scheme, null);
	assert.equal(body.account.status, "pending");
});

await test("balance: unknown provider → unknown-provider", async () => {
	const { routes } = await boot();
	const res = await call(handlerOf(routes, BALANCE_PATH), { url: "/api/usage/balance?provider=nope" });
	assert.equal(parsed(res).error, "unknown-provider");
});

await test("balance: result is cached; refresh=1 forces a second upstream query", async () => {
	const record = {};
	const transport = fakeTransport(() => ({
		statusCode: 200,
		body: JSON.stringify({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "42.00" }] })
	}), record);
	const { routes } = await boot({ deps: { lookup: publicLookup, transport } });
	const handler = handlerOf(routes, BALANCE_PATH);
	const first = await call(handler, { url: "/api/usage/balance?provider=deepseek-official" });
	assert.equal(parsed(first).account.balance.total, "42.00");
	const second = await call(handler, { url: "/api/usage/balance?provider=deepseek-official" });
	assert.equal(parsed(second).account.balance.total, "42.00");
	assert.equal(record.calls, 1, "second call served from cache");
	const forced = await call(handler, { url: "/api/usage/balance?provider=deepseek-official&refresh=1" });
	assert.equal(parsed(forced).account.balance.total, "42.00");
	assert.equal(record.calls, 2, "refresh=1 re-queries upstream");
});

await test("balance: unauthorized upstream maps to unauthorized status", async () => {
	const { routes } = await boot({
		deps: {
			lookup: publicLookup,
			transport: fakeTransport(() => ({ statusCode: 401, body: "{}" }))
		}
	});
	const res = await call(handlerOf(routes, BALANCE_PATH), { url: "/api/usage/balance?provider=deepseek-official" });
	assert.equal(parsed(res).account.status, "unauthorized");
});

//#endregion

//#region providers endpoint

await test("providers: lists official route, pi-ai profiles, and legacy entries", async () => {
	const { routes } = await boot();
	const res = await call(handlerOf(routes, PROVIDERS_PATH));
	const body = parsed(res);
	assert.equal(body.ok, true);
	const ids = body.providers.map((p) => p.id);
	assert.ok(ids.includes("deepseek-official"));
	assert.ok(ids.includes("ark"));
	assert.ok(ids.includes("openrouter"));
	assert.ok(ids.includes("zai"));
	const deepseek = body.providers.find((p) => p.id === "deepseek-official");
	assert.equal(deepseek.scheme, "deepseek");
	assert.equal(deepseek.configured, true);
	const ark = body.providers.find((p) => p.id === "ark");
	assert.equal(ark.scheme, null);
});

//#endregion

//#region usage endpoint

function usageEvent(seq, time, turn, step, usage) {
	return { seq, time, type: "assistant/chunk", data: { turn, step, chunk: { type: "usage", usage } } };
}

await test("usage: empty sessions render an empty day list", async () => {
	const { routes } = await boot();
	const res = await call(handlerOf(routes, USAGE_PATH));
	const body = parsed(res);
	assert.equal(body.ok, true);
	assert.deepEqual(body.days, []);
	assert.equal(body.total.tokens, 0);
});

await test("usage: live session events fold into per-day totals", async () => {
	const events = [
		{ seq: 1, time: Date.now(), type: "request/header", data: { header: { config: { model: "deepseek-chat", provider: "deepseek-official" } } } },
		usageEvent(2, Date.now(), 1, 1, { inputTokens: 100, outputTokens: 50 })
	];
	const { routes } = await boot({ sessions: { list: () => [{ id: "test-live-fold", events }] } });
	const res = await call(handlerOf(routes, USAGE_PATH));
	const body = parsed(res);
	assert.equal(body.total.tokens, 150);
	assert.equal(body.days.length, 1);
	assert.equal(body.days[0].models[0].model, "deepseek-official/deepseek-chat");
});

await test("usage: incremental fold only processes appended events", async () => {
	const session = {
		id: "test-live-incremental",
		events: [
			{ seq: 1, time: Date.now(), type: "request/header", data: { header: { config: { model: "deepseek-chat", provider: "deepseek-official" } } } },
			usageEvent(2, Date.now(), 1, 1, { inputTokens: 100, outputTokens: 50 })
		]
	};
	const { routes } = await boot({ sessions: { list: () => [session] } });
	const handler = handlerOf(routes, USAGE_PATH);
	const first = await call(handler);
	assert.equal(parsed(first).total.tokens, 150);
	session.events.push(usageEvent(3, Date.now(), 1, 2, { inputTokens: 10, outputTokens: 5 }));
	const second = await call(handler);
	assert.equal(parsed(second).total.tokens, 165);
});

await test("usage: persisted sessions fold via listSnapshots/readFrom", async () => {
	const events = [
		{ seq: 1, time: Date.now(), type: "request/header", data: { header: { config: { model: "deepseek-chat", provider: "deepseek-official" } } } },
		usageEvent(2, Date.now(), 1, 1, { inputTokens: 40, outputTokens: 20 })
	];
	const persistence = {
		listSnapshots: async () => [{ header: { id: "test-persisted" }, revision: "rev-1" }],
		readFrom: async (id, fromSeq) => ({ events: events.slice(fromSeq) })
	};
	const { routes } = await boot({ persistence });
	const res = await call(handlerOf(routes, USAGE_PATH));
	assert.equal(parsed(res).total.tokens, 60);
});

//#region usage endpoint — CURRENT harness API shapes
//
// The real `Session` keeps its log private behind `seq` + `snapshotEvents()`,
// `sessionPersistence.list()` returns `{ header, revision }` snapshots, and a
// stored log is read through an `open`/`read`/`close` handle. These tests pin
// those shapes so a future harness rename fails loudly here instead of
// returning HTTP 500 from the running GUI.

const SOURCE = { kind: "model", provider: "deepseek-official", model: "deepseek-chat" };

function v2Header(seq, time, model = "deepseek-chat", provider = "deepseek-official") {
	return { seq, time, type: "request/header", data: { header: { config: { model, provider } } } };
}

/** A v2 assistant settlement: usage rides `data.usage` AND the stream record. */
function v2Message(seq, time, turn, step, usage) {
	return {
		seq, time, type: "assistant/message",
		data: {
			turn, step, usage,
			message: { id: `m-${seq}`, role: "assistant", content: [], source: SOURCE },
			stream: [{ type: "chunk", time, chunk: { type: "usage", usage } }]
		}
	};
}

/** The live `Session` face: a private log behind `seq` + `snapshotEvents()`. */
function liveSession(id, events) {
	return {
		id,
		get seq() {
			return events.length;
		},
		snapshotEvents: (from = 0) => Object.freeze(events.slice(from))
	};
}

await test("usage: live sessions expose seq + snapshotEvents, not an events array", async () => {
	const now = Date.now();
	const session = liveSession("test-live-v2", [
		v2Header(0, now),
		v2Message(1, now, 1, 1, { inputTokens: 100, outputTokens: 50 })
	]);
	assert.equal(session.events, void 0, "the fake must match the real Session: no public events array");
	const { routes } = await boot({ sessions: { list: () => [session] } });
	const res = await call(handlerOf(routes, USAGE_PATH));
	const body = parsed(res);
	assert.equal(res.status, 200);
	assert.equal(body.ok, true, "aggregation must not throw on the current Session face");
	assert.equal(body.total.tokens, 150);
	assert.equal(body.days[0].models[0].model, "deepseek-official/deepseek-chat");
});

await test("usage: incremental live fold appends without double counting", async () => {
	const now = Date.now();
	const events = [v2Header(0, now), v2Message(1, now, 1, 1, { inputTokens: 100, outputTokens: 50 })];
	const { routes } = await boot({ sessions: { list: () => [liveSession("test-live-v2-inc", events)] } });
	const handler = handlerOf(routes, USAGE_PATH);
	assert.equal(parsed(await call(handler)).total.tokens, 150);
	events.push(v2Message(2, Date.now(), 1, 2, { inputTokens: 10, outputTokens: 5 }));
	assert.equal(parsed(await call(handler)).total.tokens, 165);
});

await test("usage: persisted sessions fold via list() snapshots and read handles", async () => {
	const now = Date.now();
	const events = [v2Header(0, now), v2Message(1, now, 1, 1, { inputTokens: 40, outputTokens: 20 })];
	const opened = [];
	const closed = [];
	const persistence = {
		list: async () => [{
			header: { version: 2, id: "test-persisted-v2", createdAt: now, isSeeded: false },
			revision: "rev-1",
			eventCount: events.length
		}],
		open: async (id, access) => {
			assert.equal(access, "read");
			opened.push(id);
			return {
				id,
				read: async (offset = 0) => events.filter((event) => event.seq >= offset),
				close: async () => {
					closed.push(id);
				}
			};
		}
	};
	const { routes } = await boot({ persistence });
	const handler = handlerOf(routes, USAGE_PATH);
	assert.equal(parsed(await call(handler)).total.tokens, 60);
	assert.deepEqual(opened, ["test-persisted-v2"]);
	assert.deepEqual(closed, ["test-persisted-v2"], "every opened read handle is closed");
	// An unchanged revision must short-circuit the second read entirely.
	await call(handler);
	assert.deepEqual(opened, ["test-persisted-v2"], "same revision re-reads nothing");
	// A new revision folds only the appended tail.
	events.push(v2Message(2, Date.now(), 1, 2, { inputTokens: 5, outputTokens: 5 }));
	const bumped = { ...persistence, list: async () => [{ header: { version: 2, id: "test-persisted-v2", createdAt: now, isSeeded: false }, revision: "rev-2", eventCount: 3 }] };
	const second = await boot({ persistence: bumped });
	assert.equal(parsed(await call(handlerOf(second.routes, USAGE_PATH))).total.tokens, 70);
});

await test("usage: response carries the claude channel (disabled when absent)", async () => {
	const { routes } = await boot();
	const res = await call(handlerOf(routes, USAGE_PATH));
	const body = parsed(res);
	assert.equal(body.ok, true);
	assert.deepEqual(body.claude, { enabled: false }, "no claude dir → disabled");
});

await test("usage: claude channel folds JSONL usage into the dual view", async () => {
	const claudeDir = join(testHome, "claude-real");
	mkdirSync(join(claudeDir, "projects"), { recursive: true });
	writeFileSync(join(claudeDir, "projects", "s.jsonl"), JSON.stringify({
		type: "assistant",
		timestamp: new Date().toISOString(),
		message: { model: "deepseek-v4-pro", usage: { input_tokens: 30, output_tokens: 10 } }
	}) + "\n");
	const { routes } = await boot({ claudeDir });
	const res = await call(handlerOf(routes, USAGE_PATH));
	const body = parsed(res);
	assert.equal(body.claude.enabled, true);
	assert.equal(body.claude.total.tokens, 40);
	assert.equal(body.claude.days.length, 1);
	assert.equal(body.claude.days[0].hours.length, 24);
});

//#endregion

//#region background refresh

await test("background refresh starts immediately and schedules a timer", async () => {
	const record = {};
	const timers = [];
	const { effects } = await boot({
		credentials: credentials({ DEEPSEEK_API_KEY: "sk-test", OPENROUTER_MANAGEMENT_KEY: "sk-mgmt", ZAI_API_KEY: "sk-z" }),
		deps: {
			disableBackgroundRefresh: false,
			lookup: publicLookup,
			transport: fakeTransport(() => ({
				statusCode: 200,
				body: JSON.stringify({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "9.00" }] })
			}), record),
			setInterval: (fn, ms) => {
				timers.push({ fn, ms });
				return { unref: () => {} };
			},
			clearInterval: () => {}
		}
	});
	const background = effects.find((entry) => entry.label === "usage: background refresh");
	assert.ok(background !== void 0, "background refresh effect registered");
	await background.cleanup.ready;
	assert.ok(record.calls >= 3, "startup refresh queried every scheme provider");
	assert.equal(timers.length, 1);
	assert.equal(timers[0].ms, 300000);
});

//#endregion

//#region safe-fetch policy

await test("safeFetch rejects http:// URLs", async () => {
	await assert.rejects(
		() => safeFetch("http://api.deepseek.com/user/balance", {}, { lookup: publicLookup }),
		(error) => error.providerStatus === "unsupported"
	);
});

await test("safeFetch rejects private DNS answers", async () => {
	await assert.rejects(
		() => safeFetch("https://api.deepseek.com/user/balance", {}, { lookup: async () => [{ address: "192.168.1.1", family: 4 }] }),
		(error) => error.providerStatus === "unsupported"
	);
});

await test("isPrivateAddress covers loopback, private, link-local, multicast, documentation", () => {
	assert.equal(isPrivateAddress("127.0.0.1"), true);
	assert.equal(isPrivateAddress("10.1.2.3"), true);
	assert.equal(isPrivateAddress("172.16.0.1"), true);
	assert.equal(isPrivateAddress("192.168.1.1"), true);
	assert.equal(isPrivateAddress("169.254.10.10"), true);
	assert.equal(isPrivateAddress("100.64.0.1"), true);
	assert.equal(isPrivateAddress("224.0.0.1"), true);
	assert.equal(isPrivateAddress("192.0.2.1"), true);
	assert.equal(isPrivateAddress("198.51.100.1"), true);
	assert.equal(isPrivateAddress("203.0.113.1"), true);
	assert.equal(isPrivateAddress("1.2.3.4"), false);
	assert.equal(isPrivateAddress("::1"), true);
	assert.equal(isPrivateAddress("fe80::1"), true);
	assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
	assert.equal(isPrivateAddress("::ffff:192.168.0.1"), true);
	assert.equal(isPrivateAddress("2001:db8::1"), true);
	assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
});

await test("isLoopbackAddress accepts IPv4, IPv4-mapped IPv6, and ::1", () => {
	assert.equal(isLoopbackAddress("127.0.0.1"), true);
	assert.equal(isLoopbackAddress("127.255.255.255"), true);
	assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
	assert.equal(isLoopbackAddress("::1"), true);
	assert.equal(isLoopbackAddress("10.0.0.1"), false);
	assert.equal(isLoopbackAddress("::ffff:10.0.0.1"), false);
	assert.equal(isLoopbackAddress(undefined), false);
});

//#endregion

await rm(testHome, { recursive: true, force: true });
console.log(`\n${passed} server tests passed`);
