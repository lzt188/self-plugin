#!/usr/bin/env node
/**
 * dsh-usage — jsdom end-to-end client test (v0.2 widget architecture).
 * Mounts the real bundle inside a DOM, feeds it mock endpoint data shaped
 * exactly like the live server responses, and drives the customization
 * flows: dock render → open panel → pin/collapse/hide/restore → theme
 * customization → provider switch → day drilldown. No browser, no network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { Simulate, act } from "react-dom/test-utils";

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "..", "lib", "client.js"), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

//#region environment

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
	url: "http://127.0.0.1:3080/",
	runScripts: "dangerously",
	pretendToBeVisual: true
});
const globals = {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	HTMLSelectElement: dom.window.HTMLSelectElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	SVGElement: dom.window.SVGElement,
	Event: dom.window.Event,
	MouseEvent: dom.window.MouseEvent,
	CustomEvent: dom.window.CustomEvent,
	Node: dom.window.Node,
	MessageChannel: dom.window.MessageChannel,
	getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
	requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
	cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
	IS_REACT_ACT_ENVIRONMENT: false
};
for (const [key, value] of Object.entries(globals)) {
	try {
		Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
	} catch {
		/* skip read-only built-ins */
	}
}

let declaration = null;
dom.window.__ModuleLoader__ = { load: (handoff) => { declaration = handoff; } };

//#endregion

//#region fixtures (mirror the live endpoint shapes)

const today = new Date();
const pad = (n) => String(n).padStart(2, "0");
const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const dayLabelOf = (date) => `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// Day 2 of the previous month: always ≥ 27 days back, so the 13-day recent
// cutoff and the current-month buckets never see it — only the heatmap's
// month paging does.
const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 2);
const prevMonthKey = `${prevMonth.getFullYear()}-${pad(prevMonth.getMonth() + 1)}-02`;

const PROVIDERS = [
	{ id: "deepseek-official", displayName: "DeepSeek", scheme: "deepseek", configured: true, status: "ok", fetchedAt: Date.now(), balance: { isAvailable: true, currency: "CNY", total: "128.00", granted: "0.00", toppedUp: "128.00" } },
	{ id: "openrouter", displayName: "OpenRouter", scheme: "openrouter", configured: false, status: "not-configured", fetchedAt: Date.now(), balance: null },
	{ id: "zai", displayName: "Z.ai", scheme: "zai", configured: false, status: "not-configured", fetchedAt: Date.now(), balance: null }
];
const ACCOUNT = { id: "deepseek-official", displayName: "DeepSeek", scheme: "deepseek", mode: "balance", status: "ok", balance: { isAvailable: true, currency: "CNY", total: "128.00", granted: "0.00", toppedUp: "128.00" }, fetchedAt: Date.now() };
const OPENROUTER_ACCOUNT = { id: "openrouter", displayName: "OpenRouter", scheme: "openrouter", mode: "balance", status: "not-configured", balance: null, missingCredentials: ["OPENROUTER_MANAGEMENT_KEY"], fetchedAt: Date.now() };
const USAGE = {
	ok: true,
	// Ascending by date, exactly like the live endpoint renders them.
	days: [
		{
			// Previous-month entry so the heatmap's ‹ arrow has somewhere to go.
			date: prevMonthKey,
			inputTokens: 20,
			outputTokens: 10,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			tokens: 30,
			cacheHitRate: 0,
			hours: (() => {
				const hours = new Array(24).fill(0);
				hours[9] = 30;
				return hours;
			})(),
			models: []
		},
		{
			date: todayKey,
			inputTokens: 100,
			outputTokens: 50,
			cacheReadTokens: 1000,
			cacheWriteTokens: 0,
			tokens: 1150,
			cacheHitRate: 87,
			hours: (() => {
				const hours = new Array(24).fill(0);
				hours[10] = 400;
				hours[11] = 750;
				return hours;
			})(),
			models: [{
				model: "deepseek-official/deepseek-v4-pro",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 1000,
				cacheWriteTokens: 0,
				tokens: 1150,
				cacheHitRate: 87,
				hours: (() => {
					const hours = new Array(24).fill(0);
					hours[10] = 400;
					hours[11] = 750;
					return hours;
				})()
			}]
		}
	],
	total: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, cacheWriteTokens: 0, tokens: 1150, cacheHitRate: 87 },
	claude: {
		enabled: true,
		files: 1,
		days: [{
			date: todayKey,
			inputTokens: 300,
			outputTokens: 120,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			tokens: 420,
			cacheHitRate: 0,
			hours: new Array(24).fill(0)
		}],
		total: { inputTokens: 300, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 420, cacheHitRate: 0 }
	},
	updatedAt: Date.now()
};

const fetchCalls = [];
const okResponse = (data) => ({ ok: true, status: 200, json: async () => data });
// tests may swap in a custom usage payload; restored via `usagePayload = USAGE`
let usagePayload = USAGE;
dom.window.fetch = async (input) => {
	const url = String(input);
	fetchCalls.push(url);
	if (url.includes("/api/usage/providers")) return okResponse({ ok: true, providers: PROVIDERS });
	if (url.includes("/api/usage/balance")) {
		const account = url.includes("openrouter") ? OPENROUTER_ACCOUNT : ACCOUNT;
		return okResponse({ ok: true, account });
	}
	if (url.includes("/api/usage/usage")) return okResponse(usagePayload);
	throw new Error(`unexpected fetch: ${url}`);
};

//#endregion

//#region primitives mock + bundle load

function iconComponent(name) {
	return function Icon(props) {
		return react.createElement("span", { "data-icon": name, "data-size": props.size ?? null });
	};
}
const primitives = new Proxy({}, {
	get: (_target, name) => name === "Tooltip"
		? function Tooltip(props) {
			return react.createElement(react.Fragment, null, props.children);
		}
		: iconComponent(String(name))
});
const mockRequire = (name) => {
	if (name === "react") return react;
	if (name === "react/jsx-runtime") return jsxRuntime;
	if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error(`unexpected require: ${name}`);
};

//#endregion

dom.window.eval(clientSource);
assert.ok(declaration !== null, "bundle registered on the mock sink");
const clientExports = declaration.factory(mockRequire);
const { UsagePanel } = clientExports;

// Dictionaries captured from the plugin body.
const captured = { dictionaries: null };
const captureCtx = {
	effect: (fn) => fn(),
	locale: { register: (ns, dicts) => { captured.dictionaries = dicts; } },
	slots: {
		inject: (_name, callback) => { callback(); },
		register: (spec) => spec
	}
};
clientExports.apply(captureCtx);
const t = (key) => captured.dictionaries?.zh[key] ?? key;
// Same interpolation the client applies (mirrors `interpolate`, so the test
// never hard-codes the final strings).
const tf = (key, params) => String(t(key)).replace(/\{(\w+)\}/g, (match, name) => params[name] !== void 0 ? String(params[name]) : match);

let currentRoot = null;
const freshMount = async () => {
	dom.window.localStorage.clear();
	if (currentRoot !== null) currentRoot.unmount();
	const container = document.getElementById("root");
	container.innerHTML = "";
	currentRoot = createRoot(container);
	currentRoot.render(react.createElement(UsagePanel, { wide: true, t }));
	// Wait for the dock's balance compact to settle instead of trusting a fixed
	// sleep: under load the providers → balance chain can take longer, and a
	// fixed timeout turns the whole suite into a coin flip.
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		await sleep(30);
		const value = q(".u_dockItem[data-widget=balance] .u_floatValue")?.textContent ?? "";
		if (value !== "" && value !== "–" && value !== "…") return;
	}
};

function setNativeValue(element, value) {
	const proto = Object.getPrototypeOf(element);
	const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
	setter.call(element, value);
}

const q = (selector) => document.querySelector(selector);
const qa = (selector) => [...document.querySelectorAll(selector)];

//#region flows

await test("dock renders pinned compacts with live values", async () => {
	await freshMount();
	const dock = q("[data-dsh-usage-dock]");
	assert.ok(dock !== null, "dock rendered");
	const items = qa(".u_dockItem");
	assert.equal(items.length, 4, "default pinned widgets: balance + today + month + hit");
	const balanceItem = q(".u_dockItem[data-widget=balance] .u_floatValue");
	assert.equal(balanceItem.textContent, "¥128.00");
	assert.equal(balanceItem.getAttribute("data-tone"), "ok", "healthy balance renders green");
	const todayItem = q(".u_dockItem[data-widget=today] .u_floatValue");
	assert.equal(todayItem.textContent, "1.1k");
	assert.ok(q(".u_dockItem[data-widget=month]") !== null, "month pinned by default");
	assert.ok(q(".u_dockItem[data-widget=hit]") !== null, "hit pinned by default");
});

await test("clicking a dock item opens the panel with all widgets", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const panel = q("[data-dsh-usage-panel]");
	assert.ok(panel !== null, "panel rendered");
	const widgets = qa("[data-dsh-usage-panel] .u_widget");
	assert.equal(widgets.length, 5, "main panel shows the five stat widgets (recent + heatmap live in the usage popup)");
	assert.ok(q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`) !== null, "usage popup trigger in the dock");
	assert.ok(panel.textContent.includes("¥128.00"), "balance detail shown");
	assert.ok(panel.textContent.includes(t("widget.today")), "today widget present");
	// Breakdown items must carry the real bucket values, not zeroes.
	const breakItems = [...q("[data-dsh-usage-panel] .u_widget[data-widget=today]").querySelectorAll(".u_statBreakItem")];
	assert.equal(breakItems.length, 3, "input/output/cacheRead items present");
	assert.deepEqual(breakItems.map((el) => el.textContent), ["输入 100", "输出 50", "缓存读 1.0k"], "bucket values populated");
});

await test("dual widget compares the DSH and Claude Code channels", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const dual = q("[data-dsh-usage-panel] .u_widget[data-widget=dual]");
	assert.ok(dual !== null, "dual widget present");
	const rows = qa("[data-dsh-usage-panel] .u_widget[data-widget=dual] .u_dualRow");
	assert.equal(rows.length, 2);
	// DSH 1150 / (1150 + 420) ≈ 73%; Claude ≈ 27%.
	assert.ok(rows[0].textContent.includes("DSH 通道"), "dsh channel row");
	assert.ok(rows[0].textContent.includes("73%"), "dsh share shown");
	assert.ok(rows[1].textContent.includes("Claude Code"), "claude channel row");
	assert.ok(rows[1].textContent.includes("27%"), "claude share shown");
	const bar = q("[data-dsh-usage-panel] .u_widget[data-widget=dual] .u_dualBar");
	assert.ok(bar !== null, "ratio bar rendered");
});

await test("heatmap popup shows the month grid with a numeric day header", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	// The heatmap lives in its own popup (opened from the dock trigger),
	// separate from the usage popup that carries the recent day list.
	q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.ok(q("[data-dsh-usage-heat]") !== null, "heatmap popup opened");
	const grid = q("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatGrid");
	assert.ok(grid !== null, "heatmap grid rendered");
	// The month view always renders the full 31-column geometry: short
	// months pad the tail with inert cells so the popup width never shifts.
	const cells = qa("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatCell");
	assert.equal(cells.length, 31 * 6, "31 day columns × 6 four-hour rows");
	const padCells = qa("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatPad");
	const dayCount = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
	assert.equal(cells.length - padCells.length, dayCount * 6, "only the real days are live cells");
	assert.equal(padCells.filter((cell) => cell.hasAttribute("aria-label")).length, 0, "padding cells carry no accessible label");
	const hourLabels = qa("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatHour");
	assert.equal(hourLabels.length, 6);
	assert.equal(hourLabels[0].textContent, "00");
	assert.equal(hourLabels[2].textContent, "08");
	assert.equal(hourLabels[5].textContent, "20");
	// Numeric day header (1 2 3 …) replaces the GitHub-style month marks.
	const weekLabels = qa("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatWeekLabel");
	assert.equal(weekLabels.length, 31);
	assert.deepEqual(weekLabels.slice(0, 3).map((label) => label.textContent), ["1", "2", "3"], "day numbers start at 1");
	assert.ok(weekLabels[dayCount - 1].textContent !== "", "last day of the month labeled");
	assert.ok(dayCount === 31 || weekLabels[30].textContent === "", "padding columns unlabeled");
	// Nav header: this month by default, month total on the right.
	const nav = q("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatNav");
	assert.ok(nav !== null, "month navigation rendered");
	const navBtns = qa("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatNavBtn");
	assert.equal(navBtns.length, 2, "prev + next arrows present");
	assert.equal(navBtns[1].disabled, true, "next arrow disabled on the current month");
	assert.ok(nav.textContent.includes(tf("heat.monthLabel", { year: today.getFullYear(), month: pad(today.getMonth() + 1) })), "current month labeled");
	// Today 10-12h has usage → row 2 (8-12h) today cell carries the aggregate.
	// The cells carry an accessible label instead of a native `title`: the
	// browser tooltip was slow and unstyled, so a custom bubble replaces it.
	assert.equal(cells.filter((cell) => cell.hasAttribute("title")).length, 0, "no native title tooltips left on the cells");
	const todayColumn = cells.filter((cell) => cell.getAttribute("aria-label")?.includes(todayKey));
	assert.equal(todayColumn.length, 6, "today column present");
	const hotCell = todayColumn.find((cell) => cell.getAttribute("aria-label")?.includes("08:00–12:00"));
	assert.ok(hotCell !== undefined, "8-12h cell present");
	assert.ok(hotCell.getAttribute("aria-label").includes("1,150"), "four-hour aggregate in the accessible label");
	assert.ok(todayColumn.some((cell) => cell.className.includes("u_heatToday")), "today column marked");
	// The popup header carries two compact chips — the month total sits on
	// the LEFT of today's chip. The nav row is now paging-only: prev/label/
	// next sit tight together with no edge spacers.
	const headChips = qa("[data-dsh-usage-heat] .u_heatmapPopHead > span");
	const totalChip = q("[data-dsh-usage-heat] .u_heatTotalChip");
	const todayChip = q("[data-dsh-usage-heat] .u_heatTodayChip");
	assert.ok(totalChip !== null, "month total chip in the popup head");
	assert.ok(todayChip !== null, "today chip in the popup head");
	assert.ok(totalChip.textContent.includes("1.1k"), "month total chip shows the aggregated value");
	assert.ok(totalChip.textContent.includes(t("heat.unit")), "month total chip labels the unit");
	assert.ok(totalChip.textContent.includes(t("heat.monthTotal")), "month total chip carries the label");
	assert.ok(headChips.indexOf(totalChip) >= 0 && headChips.indexOf(todayChip) >= 0, "both chips in the head");
	assert.ok(headChips.indexOf(totalChip) < headChips.indexOf(todayChip), "total chip sits to the left of the today chip");
	// No spacer siblings anymore: prev and next both live inside the same
	// flex row as the label.
	assert.equal(q("[data-dsh-usage-heat] .u_heatNavSide"), null, "no nav edge spacers");
	// "今" pill next to the month label confirms the user is on the current month.
	assert.ok(q("[data-dsh-usage-heat] .u_heatNavNow") !== null, "current-month pill next to the month label");
	// Caption now mentions the cell granularity AND the date range covered.
	const caption = q("[data-dsh-usage-heat] .u_heatCaption").textContent;
	assert.ok(/per cell|小时/.test(caption), "caption mentions cell granularity");
	assert.ok(caption.includes(`${pad(today.getMonth() + 1)}-01`), "caption mentions covered start date");
	assert.ok(caption.includes(`${pad(today.getMonth() + 1)}-${pad(dayCount)}`), "caption mentions covered end date");
});

await test("heatmap popup sizes itself to the grid instead of the whole slot", async () => {
	await freshMount();
	q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	const heat = q("[data-dsh-usage-heat]");
	assert.ok(heat !== null, "heatmap popup opened");
	// The frame hugs the heatmap: no fixed height, only the slot as an upper
	// bound, so the grid is never stranded in the middle of a panel-sized void.
	assert.equal(heat.style.height, "", "no fixed slot height on the heatmap popup");
	assert.ok(/^min\(\d+px,\s*82vh\)$/.test(heat.style.maxHeight), `slot acts as the max height (got ${heat.style.maxHeight})`);
	// The stylesheet is generated from the heat geometry constants, so the
	// popup width, the box cap and the grid columns always agree.
	const sheet = [...document.querySelectorAll("style")].map((el) => el.textContent).join("");
	const popWidth = Number(/\.u_heatmapPop\{[^}]*?width:(\d+)px/.exec(sheet)?.[1]);
	const boxWidth = Number(/\.u_heatBox\{[^}]*?width:min\(100%,(\d+)px\)/.exec(sheet)?.[1]);
	const columns = /\.u_heatGrid\{[^}]*?grid-template-columns:(\d+)px repeat\((\d+),minmax\(0,1fr\)\)/.exec(sheet);
	const gap = Number(/\.u_heatGrid\{[^}]*?gap:(\d+)px/.exec(sheet)?.[1]);
	assert.ok(Number.isFinite(popWidth) && Number.isFinite(boxWidth), "popup + box widths present in the stylesheet");
	assert.ok(columns !== null, "grid columns generated from the geometry");
	const gutter = Number(columns[1]);
	const cols = Number(columns[2]);
	assert.equal(cols, 31, "31 day columns (longest month)");
	// boxWidth = gutter + 31 × (cell + gap) → the cell edge must be a sane size.
	const cell = (boxWidth - gutter) / cols - gap;
	assert.ok(cell >= 10 && cell <= 24, `cell edge stays in the readable band (got ${cell}px)`);
	assert.equal(popWidth, boxWidth + 42, "popup width = grid width + body padding + borders");
	// The body no longer publishes measured layout variables: CSS owns the size.
	const body = q("[data-dsh-usage-heat] .u_heatmapPopBody");
	assert.equal(body.getAttribute("style"), null, "no inline layout variables on the body");
});

await test("hovering a heat cell shows the bubble instantly, with no native tooltip", async () => {
	await freshMount();
	q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.equal(q("[data-dsh-usage-heat-tip]"), null, "no bubble before hover");
	const cells = qa("[data-dsh-usage-heat] .u_heatCell");
	const hot = cells.find((cell) => cell.getAttribute("aria-label")?.includes(`${todayKey} 08:00–12:00`));
	assert.ok(hot !== undefined, "today 8-12h cell found");
	// One delegated handler on the grid: a mouseover on the cell bubbles up.
	await act(async () => {
		hot.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }));
		await new Promise((r) => setTimeout(r, 20));
	});
	const tip = q("[data-dsh-usage-heat-tip]");
	assert.ok(tip !== null, "bubble rendered on the first hover event (no delay timer)");
	assert.equal(tip.style.visibility, "", "placement resolved before paint");
	assert.ok(tip.textContent.includes("08:00–12:00"), "bubble shows the four-hour window");
	assert.ok(tip.textContent.includes("1,150"), "bubble shows the exact token count");
	assert.ok(tip.textContent.includes(t("heat.unit")), "bubble labels the unit");
	assert.ok(tip.querySelector(".u_heatTipDot") !== null, "bubble carries the level swatch");
	// Bubble also labels the weekday so a scan of the date column answers
	// "which day was that" without opening a calendar.
	const weekdayNode = tip.querySelector(".u_heatTipWeekday");
	assert.ok(weekdayNode !== null, "bubble carries a weekday chip");
	const todayDate = new Date(todayKey);
	const expectedWeekday = t(`heat.weekday.${todayDate.getDay()}`);
	assert.equal(weekdayNode.textContent, expectedWeekday, "bubble weekday matches today");
	// An empty cell reports "no usage" rather than a bare zero.
	const cold = cells.find((cell) => cell.getAttribute("aria-label")?.endsWith(" · 0"));
	assert.ok(cold !== undefined, "an empty cell exists in the window");
	await act(async () => {
		cold.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }));
		await new Promise((r) => setTimeout(r, 20));
	});
	assert.ok(q("[data-dsh-usage-heat-tip]").textContent.includes(t("heat.empty")), "empty cell bubble");
	// Leaving the grid drops the bubble.
	await act(async () => {
		q("[data-dsh-usage-heat] .u_heatGrid").dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true }));
		Simulate.mouseLeave(q("[data-dsh-usage-heat] .u_heatGrid"));
		await new Promise((r) => setTimeout(r, 20));
	});
	assert.equal(q("[data-dsh-usage-heat-tip]"), null, "bubble cleared on leave");
});

await test("heatmap month paging: arrows switch months and reset on close", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.ok(q("[data-dsh-usage-heat]") !== null, "heatmap popup opened");
	const navBtns = () => qa("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatNavBtn");
	const navText = () => q("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatNav").textContent;
	const backLabel = tf("heat.monthLabel", { year: today.getFullYear(), month: pad(today.getMonth() + 1) });
	const [prevBtn, nextBtn] = navBtns();
	assert.equal(nextBtn.disabled, true, "next disabled on the current month");
	assert.equal(prevBtn.disabled, false, "prev enabled while an older month holds data");
	// ‹ flips to the previous month: its own label and only its own total.
	prevBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
	const prevMonthLabel = tf("heat.monthLabel", { year: prevDate.getFullYear(), month: pad(prevDate.getMonth() + 1) });
	assert.ok(navText().includes(prevMonthLabel), "previous month labeled after prev click");
	assert.ok(navBtns()[1].disabled === false, "next re-enabled off the current month");
	// Month total moved from the nav row into the popup head: the chip is the
	// single source of truth for the current month's aggregated tokens.
	const headTotalText = q("[data-dsh-usage-heat] .u_heatTotalChip").textContent;
	assert.ok(headTotalText.includes("30"), "previous month total shown in the head chip");
	assert.ok(headTotalText.includes(t("heat.unit")), "head chip labels the unit");
	// Prev-month cells stay live for hover (fixture has usage on its day 2).
	const prevCells = qa("[data-dsh-usage-heat] .u_heatCell").filter((cell) => cell.getAttribute("aria-label")?.includes(prevMonthKey));
	assert.ok(prevCells.length === 6, "prev-month day-2 column present");
	assert.ok(prevCells.every((cell) => !cell.className.includes("u_heatToday")), "no column marked as today in the past month");
	// Reaching the oldest month with data disables prev.
	prevBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.equal(navBtns()[0].disabled, true, "prev disabled at the oldest month with data");
	// › walks back to the current month, which stops the walk.
	for (let step = 0; step < 3; step += 1) {
		const next = navBtns()[1];
		if (next === null || next.disabled) break;
		next.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(40);
	}
	assert.ok(navText().includes(backLabel), "walked back to the current month");
	assert.equal(navBtns()[1].disabled, true, "next disabled again on the current month");
	// Closing the popup resets the view to the current month.
	q(`[data-dsh-usage-heat] .u_iconButton[aria-label="${t("action.close")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.equal(q("[data-dsh-usage-heat]"), null, "heatmap popup closed");
	q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.ok(navText().includes(backLabel), "reopening lands on the current month again");
});

await test("heatmap keyboard paging: ← / → step months and Home returns to current", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	const navText = () => q("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatNav").textContent;
	const nowPill = () => q("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatNavNow");
	const fire = (key) => dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
	const backLabel = tf("heat.monthLabel", { year: today.getFullYear(), month: pad(today.getMonth() + 1) });
	assert.ok(nowPill() !== null, "current-month pill shown when opening on the current month");
	// ← steps one month back; the pill goes away because we left the current
	// month.
	fire("ArrowLeft");
	await sleep(40);
	const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
	const prevLabel = tf("heat.monthLabel", { year: prevDate.getFullYear(), month: pad(prevDate.getMonth() + 1) });
	assert.ok(navText().includes(prevLabel), "ArrowLeft steps to the previous month");
	assert.equal(nowPill(), null, "current-month pill hidden off the current month");
	// → walks back; Home snaps regardless of position.
	fire("ArrowRight");
	await sleep(40);
	assert.ok(navText().includes(backLabel), "ArrowRight steps back to the current month");
	assert.ok(nowPill() !== null, "current-month pill reappears on the current month");
	fire("ArrowLeft");
	fire("ArrowLeft");
	await sleep(40);
	assert.ok(!navText().includes(backLabel), "two ArrowLeft steps land two months back");
	fire("Home");
	await sleep(40);
	assert.ok(navText().includes(backLabel), "Home snaps the view back to the current month");
	assert.ok(nowPill() !== null, "current-month pill is back after Home");
});

await test("heatmap wheel paging: scroll up/down inside the popup steps months", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	const navText = () => q("[data-dsh-usage-heat] [data-widget=heatmap] .u_heatNav").textContent;
	const backLabel = tf("heat.monthLabel", { year: today.getFullYear(), month: pad(today.getMonth() + 1) });
	const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
	const prevLabel = tf("heat.monthLabel", { year: prevDate.getFullYear(), month: pad(prevDate.getMonth() + 1) });
	// Scroll UP (negative deltaY) inside the popup → previous month.
	const popup = q("[data-dsh-usage-heat]");
	const fireWheel = (deltaY, target) => {
		const event = new dom.window.WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
		(target ?? popup).dispatchEvent(event);
		return event;
	};
	const first = fireWheel(-80);
	await new Promise((r) => setTimeout(r, 40));
	assert.equal(first.defaultPrevented, true, "wheel inside the popup is consumed by paging");
	assert.ok(navText().includes(prevLabel), "scroll up steps to the previous month");
	// Scroll DOWN (positive deltaY) inside the popup → next month.
	fireWheel(80);
	await new Promise((r) => setTimeout(r, 40));
	assert.ok(navText().includes(backLabel), "scroll down walks back to the current month");
	// Wheel events OUTSIDE the popup must not change the month.
	const outside = fireWheel(-80, dom.window.document.body);
	await new Promise((r) => setTimeout(r, 40));
	assert.equal(outside.defaultPrevented, false, "wheel outside the popup stays untouched");
	assert.ok(navText().includes(backLabel), "wheel outside the popup does not step");
	// The handler is throttled: a single 30-unit nudge is below the step
	// threshold and should not flip months.
	fireWheel(-30);
	await new Promise((r) => setTimeout(r, 40));
	assert.ok(navText().includes(backLabel), "small wheel deltas under the step threshold are ignored");
});

await test("gear, usage popup, and heatmap popup all share one slot and stay independent", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	assert.equal(q("[data-dsh-usage-pop]"), null, "usage popup closed by default");
	assert.equal(q("[data-dsh-usage-heat]"), null, "heatmap popup closed by default");
	const usageTrigger = q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`);
	const heatTrigger = q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`);
	assert.ok(usageTrigger !== null, "usage popup trigger present in the dock");
	assert.ok(heatTrigger !== null, "heatmap popup trigger present in the dock");
	// Dock corner order: heatmap → usage → refresh → settings (left → right).
	const dockCornerButtons = [...qa("[data-dsh-usage-dock] .u_dockHeatmapPop, [data-dsh-usage-dock] .u_dockUsagePop, [data-dsh-usage-dock] .u_dockRefresh, [data-dsh-usage-dock] .u_dockSettings")]
		.map((b) => b.getAttribute("aria-label"));
	assert.equal(dockCornerButtons[0], t("action.heatmapPop"), "heatmap trigger sits leftmost in the dock");
	assert.equal(dockCornerButtons[1], t("action.usagePop"), "usage trigger sits between heatmap and refresh");
	assert.equal(dockCornerButtons[2], t("action.refresh"), "refresh sits between usage pop and settings");
	assert.equal(dockCornerButtons[3], t("panel.title"), "settings anchor sits rightmost in the dock");
	// The panel header carries no popup triggers; only refresh, customize, close remain.
	const headerButtons = [...qa("[data-dsh-usage-panel] .u_headerActions .u_iconButton")]
		.map((b) => b.getAttribute("aria-label"));
	assert.ok(!headerButtons.includes(t("action.usagePop")), "usage trigger removed from the panel header");
	assert.ok(!headerButtons.includes(t("action.heatmapPop")), "heatmap trigger removed from the panel header");
	const panelBox = q("[data-dsh-usage-panel]").getAttribute("style");
	q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	const pop = q("[data-dsh-usage-pop]");
	assert.ok(pop !== null, "usage popup opened");
	// One slot, two boxes: the popup replaces the balance panel and inherits its
	// exact geometry (same anchor + clamps, width comes from the shared CSS).
	assert.equal(q("[data-dsh-usage-panel]"), null, "balance panel closed while the popup shows");
	assert.equal(q("[data-dsh-usage-heat]"), null, "heatmap popup stays closed");
	assert.equal(pop.getAttribute("style"), panelBox, "usage popup uses the panel's anchor and clamps");
	assert.ok(pop.textContent.includes(t("widget.recent")), "usage popup carries the recent title");
	assert.ok(!pop.textContent.includes(t("widget.heatmap")), "usage popup drops the heatmap section");
	assert.ok(!pop.querySelector("[data-widget=heatmap]"), "no heatmap inside the usage popup");
	assert.ok(pop.querySelector("[data-widget=recent] .u_days") !== null, "usage log day list present");
	// Heatmap trigger replaces the usage popup in the same slot.
	// Re-query the trigger in case React replaced the DOM node.
	const latestHeatTrigger = q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`);
	await act(async () => {
		latestHeatTrigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await new Promise((r) => setTimeout(r, 50));
	});
	const heat = q("[data-dsh-usage-heat]");
	assert.ok(heat !== null, "heatmap popup opened");
	assert.equal(q("[data-dsh-usage-pop]"), null, "usage popup closed when heatmap opened");
	assert.equal(q("[data-dsh-usage-panel]"), null, "balance panel still closed");
	// Same anchor corner as the panel (left + bottom edge), but the frame is
	// sized to the heatmap: the slot only caps its height.
	assert.equal(heat.style.left, /left: ([^;]+);/.exec(panelBox)[1], "heatmap popup shares the panel's left edge");
	assert.equal(heat.style.bottom, /bottom: ([^;]+);/.exec(panelBox)[1], "heatmap popup shares the panel's bottom edge");
	assert.equal(heat.style.height, "", "heatmap popup hugs its content instead of filling the slot");
	assert.ok(heat.style.maxHeight.includes("82vh"), "the slot caps the heatmap popup height");
	assert.ok(heat.textContent.includes(t("widget.heatmap")), "heatmap popup carries the heatmap title");
	assert.ok(heat.querySelector("[data-widget=heatmap] .u_heatGrid") !== null, "heatmap grid rendered");
	// Close via the popup's own close button.
	const popClose = [...qa("[data-dsh-usage-heat] .u_iconButton")].find((b) => b.getAttribute("aria-label") === t("action.close"));
	popClose.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.equal(q("[data-dsh-usage-heat]"), null, "heatmap popup closed");
	assert.equal(q("[data-dsh-usage-pop]"), null, "closing heatmap does not open the usage popup");
	assert.equal(q("[data-dsh-usage-panel]"), null, "closing heatmap does not resurrect the panel");
	// The triggers work straight from the closed dock, without the panel.
	q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.ok(q("[data-dsh-usage-pop]") !== null, "usage popup reopened without the panel");
	q(`[data-dsh-usage-dock] .u_dockHeatmapPop[aria-label="${t("action.heatmapPop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.equal(q("[data-dsh-usage-pop]"), null, "usage popup closed when heatmap opened (second toggle)");
	assert.ok(q("[data-dsh-usage-heat]") !== null, "heatmap popup opened on second trigger");
	// The gear takes the slot back and closes the popup.
	q(`[data-dsh-usage-dock] .u_dockSettings[aria-label="${t("panel.title")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.ok(q("[data-dsh-usage-panel]") !== null, "gear opened the balance panel");
	assert.equal(q("[data-dsh-usage-heat]"), null, "gear closed the heatmap popup");
});

await test("pin toggles a widget out of and back into the dock", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const balanceHead = q("[data-dsh-usage-panel] .u_widget[data-widget=balance] .u_widgetHead");
	const pinButton = [...balanceHead.querySelectorAll(".u_wIconBtn")].find((b) => b.getAttribute("aria-label") === t("action.unpin"));
	assert.ok(pinButton !== null, "unpin button present (balance pinned by default)");
	pinButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(qa(".u_dockItem").length, 3, "balance left the dock");
	assert.equal(q(".u_dockItem[data-widget=balance]"), null, "balance compact removed");
	// Pin it back.
	pinButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(qa(".u_dockItem").length, 4, "balance rejoined the dock");
	assert.ok(q(".u_dockItem[data-widget=balance]") !== null, "balance compact restored");
	assert.equal(pinButton.getAttribute("data-pinned"), "true", "pin state toggled");
});

await test("cards lay out two-per-row with drag grip, hover actions, and renamed titles", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const panel = q("[data-dsh-usage-panel]");
	// Two-column grid with full/half width classes.
	const grid = q("[data-dsh-usage-panel] .u_grid");
	assert.ok(grid !== null, "grid container present");
	assert.equal(q(".u_widget[data-widget=balance]").getAttribute("data-width"), "full");
	assert.equal(q(".u_widget[data-widget=today]").getAttribute("data-width"), "half");
	assert.equal(q(".u_widget[data-widget=dual]").getAttribute("data-width"), "half");
	// recent + heatmap no longer render in the main panel.
	assert.equal(q(".u_widget[data-widget=recent]"), null, "recent not in the main panel");
	assert.equal(q(".u_widget[data-widget=heatmap]"), null, "heatmap not in the main panel");
	// Renamed titles (dual stays in the panel; recent lives in the popup).
	assert.ok(panel.textContent.includes("通道比例"), "dual renamed to 通道比例");
	// Drag grip present; arrow move buttons gone.
	const todayHead = q(".u_widget[data-widget=today] .u_widgetHead");
	assert.ok(todayHead.querySelectorAll("svg rect").length >= 3, "grip icon rendered");
	assert.equal([...todayHead.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === t("action.moveUp")), undefined, "no move-up button");
	assert.equal([...todayHead.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === t("action.moveDown")), undefined, "no move-down button");
	// Pin/hide carry the hover-only class; cards are draggable. (hit is pinned
	// by default now, so its aria-label reads "unpin".)
	const hitHead = q(".u_widget[data-widget=hit] .u_widgetHead");
	const pin = [...hitHead.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === t("action.unpin"));
	assert.ok(pin !== undefined, "pin button present");
	assert.ok(pin.className.includes("u_wHoverBtn"), "pin is hover-only");
	assert.equal(q(".u_widget[data-widget=today]").getAttribute("draggable"), "true", "card draggable");
});

await test("panel renders a single full-width main column (right column moved into the popup)", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	assert.ok(q("[data-dsh-usage-panel] .u_columns") !== null, "columns wrapper present");
	const idsIn = (column) => [...q(`[data-dsh-usage-panel] [data-column=${column}]`).querySelectorAll(".u_widget")]
		.map((el) => el.getAttribute("data-widget"));
	assert.deepEqual(idsIn("main"), ["balance", "today", "month", "hit", "dual"], "main column: balance + the four stat cards");
	// recent + heatmap moved out of the panel entirely, so the aside column
	// renders nothing and is dropped.
	assert.equal(q("[data-dsh-usage-panel] [data-column=aside]"), null, "aside column absent");
	// Dragging within the main column is unaffected and commits the drop.
	q(".u_widget[data-widget=today]").dispatchEvent(new dom.window.Event("dragstart", { bubbles: true, cancelable: true }));
	await sleep(40);
	q(".u_widget[data-widget=month]").dispatchEvent(new dom.window.Event("dragover", { bubbles: true, cancelable: true }));
	await sleep(60);
	assert.ok(idsIn("main").includes("__ghost__"), "ghost shows within the main column");
	q(".u_widget[data-widget=today]").dispatchEvent(new dom.window.Event("dragend", { bubbles: true }));
	await sleep(80);
	assert.deepEqual(idsIn("main"), ["balance", "month", "today", "hit", "dual"], "main order committed");
});

await test("drag shows a ghost slot and commits the order on drop", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const monthCard = q(".u_widget[data-widget=month]");
	monthCard.dispatchEvent(new dom.window.Event("dragstart", { bubbles: true, cancelable: true }));
	await sleep(40);
	assert.equal(monthCard.getAttribute("data-dragging"), "true", "dragged card dimmed");
	// Hover the balance card: a dashed ghost placeholder appears at its slot.
	q(".u_widget[data-widget=balance]").dispatchEvent(new dom.window.Event("dragover", { bubbles: true, cancelable: true }));
	await sleep(60);
	const ghost = q(".u_widget[data-widget=__ghost__]");
	assert.ok(ghost !== null, "ghost placeholder shown");
	// Drop commits the reorder once.
	monthCard.dispatchEvent(new dom.window.Event("dragend", { bubbles: true }));
	await sleep(100);
	assert.equal(q(".u_widget[data-widget=__ghost__]"), null, "ghost removed after drop");
	const order = [...qa("[data-dsh-usage-panel] .u_widget")].map((el) => el.getAttribute("data-widget")).filter((id) => id !== null);
	assert.ok(order.indexOf("month") < order.indexOf("balance"), "month moved before balance");
	assert.equal(monthCard.getAttribute("data-dragging"), null, "dim state cleared");
});

await test("gear toggles the panel and the refresh button sits beside it", async () => {
	await freshMount();
	assert.ok(q(".u_dockRefresh") !== null, "refresh button beside gear");
	q(".u_dockSettings").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	assert.ok(q("[data-dsh-usage-panel]") !== null, "panel opened via gear");
	q(".u_dockSettings").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-panel]"), null, "second gear click closes the panel");
});

await test("rail mode: balance button reveals the dock and scrim closes it", async () => {
	await freshMount();
	// Remount with wide=false for the rail flow.
	dom.window.localStorage.clear();
	if (currentRoot !== null) currentRoot.unmount();
	const container = document.getElementById("root");
	container.innerHTML = "";
	currentRoot = createRoot(container);
	currentRoot.render(react.createElement(UsagePanel, { wide: false, t }));
	await sleep(150);
	const railBtn = q("[data-dsh-usage-rail]");
	assert.ok(railBtn !== null, "rail button rendered");
	assert.ok(railBtn.textContent.includes("余额"), "balance label shown");
	assert.equal(q("[data-dsh-usage-dock]"), null, "dock hidden initially");
	railBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.ok(q("[data-dsh-usage-dock]") !== null, "dock revealed on click");
	assert.ok(q(".u_railScrim") !== null, "scrim present");
	// Gear opens the detail panel from the dock.
	q(".u_dockSettings").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	assert.ok(q("[data-dsh-usage-panel]") !== null, "detail panel opened from dock gear");
	// Close the panel; scrim click collapses the dock back to the button.
	const closeButton = [...qa("[data-dsh-usage-panel] .u_iconButton")].find((b) => b.getAttribute("aria-label") === t("action.close"));
	closeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	q(".u_railScrim").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-dock]"), null, "dock collapsed after scrim click");
	assert.ok(q("[data-dsh-usage-rail]") !== null, "rail button back");
});

await test("dock grip drags the dock freely and snaps to edges", async () => {
	await freshMount();
	const grip = q(".u_dockGrip");
	assert.ok(grip !== null, "grip present top-left");
	const dock = q("[data-dsh-usage-dock]");
	assert.equal(dock.style.bottom, "72px", "default bottom offset");
	assert.equal(dock.style.left, "14px", "default left offset");
	// Drag right+up 60px on both axes.
	grip.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 200 }));
	grip.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 360, clientY: 140 }));
	await sleep(50);
	assert.equal(dock.style.left, "74px", "dock moved right 60px");
	assert.equal(dock.style.bottom, "132px", "dock moved up 60px");
	// Release: further moves do nothing.
	grip.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true }));
	await sleep(30);
	grip.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 100 }));
	await sleep(50);
	assert.equal(dock.style.left, "74px", "no horizontal movement after release");
	assert.equal(dock.style.bottom, "132px", "no vertical movement after release");
	// Drag toward the top-right corner: it snaps flush to both edges. With
	// jsdom's 1024×768 viewport and zero-size rects, a rawX within 28px of the
	// right edge (x=996) snaps to 1024-0-14=1010; a rawY within 28px of the top
	// (y=740) snaps to 768-0-14=754.
	grip.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 300 }));
	grip.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 1282, clientY: -368 }));
	await sleep(50);
	assert.equal(dock.style.left, "1010px", "snapped to the right edge");
	assert.equal(dock.style.bottom, "754px", "snapped to the top edge");
});

await test("dock steps aside when the pointer parks on it and returns on movement", async () => {
	await freshMount();
	const dock = q("[data-dsh-usage-dock]");
	// jsdom has no layout: pin the dock box so the proximity math is deterministic.
	dock.getBoundingClientRect = () => ({ left: 10, top: 600, right: 190, bottom: 700, width: 180, height: 100, x: 10, y: 600 });
	const move = (clientX, clientY) => dom.window.dispatchEvent(new dom.window.MouseEvent("mousemove", { bubbles: true, clientX, clientY }));
	move(100, 650);
	await sleep(60);
	assert.equal(dock.getAttribute("data-ghost"), null, "solid right after the pointer arrives");
	await sleep(1000);
	assert.equal(dock.getAttribute("data-ghost"), "true", "a parked pointer turns the dock into a ghost");
	assert.equal(dock.style.pointerEvents, "none", "ghost dock passes clicks through to what it covers");
	// Real movement over the dock brings it back immediately.
	move(140, 630);
	await sleep(60);
	assert.equal(dock.getAttribute("data-ghost"), null, "movement restores the dock");
	assert.notEqual(dock.style.pointerEvents, "none", "restored dock is interactive again");
	// Parking again ghosts again; leaving the dock clears it.
	await sleep(1000);
	assert.equal(dock.getAttribute("data-ghost"), "true", "ghosts again after parking");
	move(600, 300);
	await sleep(60);
	assert.equal(dock.getAttribute("data-ghost"), null, "leaving the dock restores it");
});

await test("collapse hides a widget body, hide removes it and restore brings it back", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	// Collapse today.
	const todayWidget = q("[data-dsh-usage-panel] .u_widget[data-widget=today]");
	todayWidget.querySelector(".u_widgetTitle").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(todayWidget.querySelector(".u_wBody"), null, "collapsed body removed");
	// Expand again.
	todayWidget.querySelector(".u_widgetTitle").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.ok(todayWidget.querySelector(".u_wBody") !== null, "expanded body restored");
	// Hide hit.
	const hitWidget = q("[data-dsh-usage-panel] .u_widget[data-widget=hit]");
	const hideButton = [...hitWidget.querySelectorAll(".u_wIconBtn")].find((b) => b.getAttribute("aria-label") === t("action.hide"));
	hideButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-panel] .u_widget[data-widget=hit]"), null, "hidden widget gone from panel");
	assert.ok(q("[data-dsh-usage-panel]").textContent.includes("已隐藏 1 项"), "hidden manager shows count");
	// Restore.
	q("[data-dsh-usage-panel] .u_restore").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.ok(q("[data-dsh-usage-panel] .u_widget[data-widget=hit]") !== null, "widget restored");
});

await test("theme customizer changes accent, background, and opacity", async () => {
	await freshMount();
	// The customize button lives in the usage popup header; clicking it keeps
	// the popup open and renders the customizer inside the popup body (no
	// need to detour through the balance panel anymore).
	q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	assert.equal(q("[data-dsh-usage-pop] .u_themeBox"), null, "customizer collapsed on open");
	const customizeButton = [...qa("[data-dsh-usage-pop] .u_iconButton")].find((b) => b.getAttribute("aria-label") === t("action.customize"));
	assert.ok(customizeButton !== undefined, "customize button present in usage popup header");
	customizeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	const themeBox = q("[data-dsh-usage-pop] .u_themeBox");
	assert.ok(themeBox !== null, "customizer expanded on demand");
	// Accent: pick the second preset swatch (#0ea5e9).
	const accentSwatches = qa("[data-dsh-usage-pop] .u_themeRow")[0].querySelectorAll(".u_swatch");
	accentSwatches[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-dock]").style.getPropertyValue("--u-accent"), "#0ea5e9", "dock accent updated");
	// Background: pick the dark preset (#0d1117, second button in row 2).
	const bgSwatches = qa("[data-dsh-usage-pop] .u_themeRow")[1].querySelectorAll(".u_swatch");
	bgSwatches[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-dock]").style.getPropertyValue("--u-bg"), "#0d1117", "dock background updated");
	// Opacity slider to 0.5 (React controlled ranges need Simulate in jsdom).
	const slider = q("[data-dsh-usage-pop] .u_range");
	act(() => {
		Simulate.change(slider, { target: { value: "0.5" } });
	});
	await sleep(80);
	assert.equal(q("[data-dsh-usage-dock]").style.opacity, "0.5", "dock opacity updated");
});

// Open the customizer via the new entry point (the usage popup header),
// type an alias, then drill into the usage popup so the rest of the
// assertions can probe the breakdown's display name.
const clickCustomizeInUsagePop = () => {
	const button = [...qa("[data-dsh-usage-pop] .u_iconButton")].find((b) => b.getAttribute("aria-label") === t("action.customize"));
	assert.ok(button !== undefined, "customize button present in usage popup header");
	button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	return button;
};

const openCustomizerAndSetAlias = async (aliasValue) => {
	q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	clickCustomizeInUsagePop();
	await sleep(80);
	const aliasRow = [...qa("[data-dsh-usage-pop] .u_aliasRow")].find((row) => row.querySelector(".u_aliasKey")?.textContent === "deepseek-official/deepseek-v4-pro");
	assert.ok(aliasRow !== undefined, "alias row for the test model rendered");
	const input = aliasRow.querySelector(".u_aliasInput");
	act(() => {
		Simulate.change(input, { target: { value: aliasValue } });
	});
	input.dispatchEvent(new dom.window.Event("blur", { bubbles: true }));
	await sleep(80);
	// Toggle the customizer closed so the recent-day list comes back, then
	// drill into a day for the breakdown assertions below.
	clickCustomizeInUsagePop();
	await sleep(120);
	const day = q("[data-dsh-usage-pop] .u_day");
	assert.ok(day !== null, "day button visible after closing customizer");
	day.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(50);
};

await test("model display-name alias overrides the default label everywhere it shows up", async () => {
	await freshMount();
	const originalLabel = "deepseek-v4-pro";
	await openCustomizerAndSetAlias("My V4");
	assert.ok(q("[data-dsh-usage-pop]").textContent.includes("My V4"), "breakdown label uses alias after rename");
	assert.ok(!q("[data-dsh-usage-pop]").textContent.includes(originalLabel), "default label is gone after rename");
	// Re-open the customizer via the usage popup header and reset just that
	// alias via the per-row button. The day breakdown stays mounted in the
	// background, so closing the customizer brings the same day view back
	// with the now-default model name.
	clickCustomizeInUsagePop();
	await sleep(80);
	const aliasRow = [...qa("[data-dsh-usage-pop] .u_aliasRow")].find((row) => row.querySelector(".u_aliasKey")?.textContent === "deepseek-official/deepseek-v4-pro");
	aliasRow.querySelector(".u_aliasResetOne").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	// Toggle the customizer closed; the day detail the user was on before
	// opening the customizer is still mounted, so the assertions below can
	// just read its content again.
	clickCustomizeInUsagePop();
	await sleep(100);
	assert.ok(q("[data-dsh-usage-pop]").textContent.includes(originalLabel), "default label restored after per-row reset");
	assert.ok(!q("[data-dsh-usage-pop]").textContent.includes("My V4"), "alias is gone after reset");
});

await test("model display-name alias survives a re-mount from localStorage", async () => {
	await freshMount();
	await openCustomizerAndSetAlias("Persisted V4");
	assert.ok(q("[data-dsh-usage-pop]").textContent.includes("Persisted V4"), "alias visible before re-mount");
	// Remount WITHOUT clearing localStorage: modelAliases flows back through
	// the settings saver and the breakdown shows the alias without any further
	// interaction in the UI.
	if (currentRoot !== null) currentRoot.unmount();
	const container = document.getElementById("root");
	container.innerHTML = "";
	currentRoot = createRoot(container);
	currentRoot.render(react.createElement(UsagePanel, { wide: true, t }));
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		await sleep(30);
		const value = q(".u_dockItem[data-widget=balance] .u_floatValue")?.textContent ?? "";
		if (value !== "" && value !== "–" && value !== "…") break;
	}
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	q("[data-dsh-usage-pop] .u_day").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(50);
	assert.ok(q("[data-dsh-usage-pop]").textContent.includes("Persisted V4"), "alias survives a re-mount from localStorage");
});

await test("switching provider shows its not-configured state", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const select = q("[data-dsh-usage-panel] .u_providerSelect");
	setNativeValue(select, "openrouter");
	select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
	await sleep(100);
	const panel = q("[data-dsh-usage-panel]");
	assert.ok(panel.textContent.includes("OPENROUTER_MANAGEMENT_KEY"), "missing credential ref shown");
	assert.ok(fetchCalls.some((url) => url.includes("/api/usage/balance?provider=openrouter")), "balance fetched for switched provider");
});

await test("clicking a recent day in the popup opens the model breakdown", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	const dayRow = q("[data-dsh-usage-pop] .u_day");
	assert.ok(dayRow !== null, "recent day row present in the popup");
	dayRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(50);
	const pop = q("[data-dsh-usage-pop]");
	assert.ok(pop.textContent.includes("deepseek-v4-pro"), "model breakdown rendered with display name");
	assert.ok(!pop.textContent.includes("DeepSeek/"), "provider hidden from default label");
	const backButton = q("[data-dsh-usage-pop] .u_back");
	assert.ok(backButton !== null, "back button present");
	assert.equal(backButton.getAttribute("aria-label"), t("action.back"));
});

await test("day detail in the popup switches between overview and model usage curve tabs", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(60);
	const dayRow = q("[data-dsh-usage-pop] .u_day");
	assert.ok(dayRow !== null, "recent day row present in the popup");
	dayRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(50);
	const pop = q("[data-dsh-usage-pop]");
	// Default tab: overview — the original model-row effect.
	assert.ok(q("[data-dsh-usage-pop] .u_modelRow") !== null, "overview tab shows model rows by default");
	// Switch to the per-model usage curve view.
	const tabs = qa("[data-dsh-usage-pop] .u_detailTab");
	assert.equal(tabs.length, 2, "two detail tabs");
	const modelsTab = tabs.find((tab) => tab.textContent === t("detail.models"));
	assert.ok(modelsTab !== void 0, "model tab labeled");
	modelsTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(30);
	assert.ok(q("[data-dsh-usage-pop] .u_chartSvg") !== null, "usage curve svg rendered");
	assert.ok(q("[data-dsh-usage-pop] .u_chartLegend") !== null, "curve legend rendered");
	assert.ok(pop.textContent.includes("deepseek-v4-pro"), "model id shown in curve legend");
	assert.ok(!pop.textContent.includes("DeepSeek/"), "provider hidden from curve legend");
	// Back to overview.
	const overviewTab = tabs.find((tab) => tab.textContent === t("detail.overview"));
	overviewTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(30);
	assert.ok(q("[data-dsh-usage-pop] .u_modelRow") !== null, "back to overview model rows");
});

await test("usage curve tooltip focuses the pointed-at curve and hides zero-usage models", async () => {
	// Deterministic curves: model-a flat at 100/h, model-b flat at 300/h (the
	// max), model-c flat at 0 (sitting on the axis). Every visible hour carries
	// the same values, so the assertions hold at whatever time the suite runs.
	const flat = (v) => new Array(24).fill(v);
	const model = (name, tokens, hours) => ({ model: name, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens, cacheHitRate: 0, hours });
	const originalPayload = usagePayload;
	usagePayload = {
		...USAGE,
		days: [{
			date: todayKey,
			inputTokens: 400, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
			tokens: 9600, cacheHitRate: 0, hours: flat(400),
			models: [model("deepseek-official/model-a", 2400, flat(100)), model("deepseek-official/model-b", 7200, flat(300)), model("deepseek-official/model-c", 0, flat(0))]
		}],
		total: { inputTokens: 400, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 9600, cacheHitRate: 0 }
	};
	try {
		await freshMount();
		q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(100);
		q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		q("[data-dsh-usage-pop] .u_day").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(50);
		const tabs = qa("[data-dsh-usage-pop] .u_detailTab");
		tabs.find((tab) => tab.textContent === t("detail.models")).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(30);
		const svg = q("[data-dsh-usage-pop] .u_chartSvg");
		assert.ok(svg !== null, "usage curve svg rendered");
		// jsdom has no layout: pin the svg box so pointer→viewBox math is
		// deterministic. viewBox 320×120 over 930×132 css px → yOf(300)=11px,
		// yOf(100)=85.8px, yOf(0)=123.2px; x=465 sits at the plot center.
		svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 930, bottom: 132, width: 930, height: 132, x: 0, y: 0 });
		const hover = async (clientX, clientY) => {
			svg.dispatchEvent(new dom.window.MouseEvent("mousemove", { bubbles: true, clientX, clientY }));
			await sleep(30);
			return q("[data-dsh-usage-pop] .u_chartTip");
		};
		const rows = (tip) => [...tip.querySelectorAll(".u_chartTipRow")];
		// Header row + per-model rows. The header sits in its own container
		// (.u_chartTipHead), so rows() only counts the data rows.
		const hasHead = (tip) => tip.querySelector(".u_chartTipHead") !== null;
		const headText = (tip) => {
			const head = tip.querySelector(".u_chartTipHead");
			return head === null ? "" : head.textContent;
		};
		// On model-a's curve → only model-a is listed.
		let tip = await hover(465, 86);
		assert.ok(tip !== null, "tooltip appears on hover");
		assert.ok(hasHead(tip), "tooltip head row is present");
		assert.equal(rows(tip).length, 1, "head + the focused curve only");
		assert.ok(tip.textContent.includes("model-a"), "focused curve named");
		assert.ok(!tip.textContent.includes("model-b"), "other curves hidden while focused");
		assert.ok(!tip.textContent.includes("model-c"), "zero-usage model never lists");
		// On model-b's curve → only model-b.
		tip = await hover(465, 11);
		assert.equal(rows(tip).length, 1, "head + the focused curve only");
		assert.ok(tip.textContent.includes("model-b"), "focused curve named");
		assert.ok(!tip.textContent.includes("model-a"), "other curves hidden while focused");
		// Between curves (no curve targeted) → every model with usage, largest first.
		tip = await hover(465, 48);
		const allRows = rows(tip);
		assert.equal(allRows.length, 2, "head + every non-zero model");
		assert.ok(allRows[0].textContent.includes("model-b"), "largest usage listed first");
		assert.ok(allRows[1].textContent.includes("model-a"), "then the smaller one");
		assert.ok(!tip.textContent.includes("model-c"), "zero-usage model never lists");
		// Zero-usage models are dropped from the chart, so the axis is no longer a
		// hover target: pointing at it behaves like empty plot space.
		tip = await hover(465, 123);
		assert.equal(rows(tip).length, 2, "axis carries no curve — every non-zero model lists");
		assert.ok(!tip.textContent.includes("model-c"), "zero-usage model never lists");
		assert.ok(headText(tip).includes("400"), "header still carries the hour total");
		// Legend and curves only cover models that actually moved.
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLegendItem").length, 2, "zero-usage model absent from the legend");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLine").length, 2, "zero-usage model draws no curve");
		// Hovered-hour dots mark the listed rows on the curves.
		assert.equal(qa("[data-dsh-usage-pop] .u_chartDotMark").length, 2, "one dot per listed model");
	} finally {
		usagePayload = originalPayload;
	}
});

await test("usage curve legend items are clickable toggles for individual curves", async () => {
	const flat = (v) => new Array(24).fill(v);
	const model = (name, tokens, hours) => ({ model: name, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens, cacheHitRate: 0, hours });
	const originalPayload = usagePayload;
	usagePayload = {
		...USAGE,
		days: [{
			date: todayKey,
			inputTokens: 800, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
			tokens: 19200, cacheHitRate: 0, hours: flat(800),
			models: [model("deepseek-official/model-a", 9600, flat(400)), model("deepseek-official/model-b", 9600, flat(400))]
		}],
		total: { inputTokens: 800, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 19200, cacheHitRate: 0 }
	};
	try {
		await freshMount();
		q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(100);
		q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		q("[data-dsh-usage-pop] .u_day").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(50);
		qa("[data-dsh-usage-pop] .u_detailTab").find((tab) => tab.textContent === t("detail.models")).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(30);
		// Default: every legend item is shown and every curve is drawn.
		const items = qa("[data-dsh-usage-pop] .u_chartLegendItem");
		assert.equal(items.length, 2, "two legend items for two models");
		assert.ok(items.every((el) => el.getAttribute("data-hidden") === null), "no legend item hidden by default");
		assert.ok(items.every((el) => el.getAttribute("aria-pressed") === "true"), "aria-pressed reflects the default-shown state");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLine").length, 2, "both curves drawn by default");
		// Click the first model → it dims and its curve disappears, the other stays.
		const first = items[0];
		const firstKey = first.getAttribute("data-model-key");
		first.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		// React serializes boolean true attributes as the literal string "true";
		// when the value is falsy the attribute is omitted entirely.
		const dimmed = qa("[data-dsh-usage-pop] .u_chartLegendItem").find((el) => el.getAttribute("data-model-key") === firstKey);
		assert.equal(dimmed.getAttribute("data-hidden"), "true", "clicked item is dimmed");
		assert.equal(dimmed.getAttribute("aria-pressed"), "false", "aria-pressed flips to off");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLine").length, 1, "hidden curve no longer drawn");
		const remaining = qa("[data-dsh-usage-pop] .u_chartLegendItem").find((el) => el.getAttribute("data-hidden") === null);
		assert.ok(remaining !== void 0, "the other legend item is still shown");
		assert.notEqual(remaining.getAttribute("data-model-key"), firstKey, "the shown item is the other model");
		// Click the dimmed item again → it returns; the chart restores both curves.
		dimmed.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		const restored = qa("[data-dsh-usage-pop] .u_chartLegendItem").find((el) => el.getAttribute("data-model-key") === firstKey);
		assert.equal(restored.getAttribute("data-hidden"), null, "item is back to its default-shown state");
		assert.equal(restored.getAttribute("aria-pressed"), "true", "aria-pressed restored to true");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLine").length, 2, "both curves drawn again after a second click");
	} finally {
		usagePayload = originalPayload;
	}
});

await test("usage curve y-axis shows a labeled scale (peak with unit, three numeric ticks)", async () => {
	const flat = (v) => new Array(24).fill(v);
	const model = (name, tokens, hours) => ({ model: name, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens, cacheHitRate: 0, hours });
	const originalPayload = usagePayload;
	// Two models flat at 100 tokens/hour → peak slot = 100, mid = 50.
	usagePayload = {
		...USAGE,
		days: [{
			date: todayKey,
			inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
			tokens: 2400, cacheHitRate: 0, hours: flat(100),
			models: [model("deepseek-official/model-a", 1200, flat(50)), model("deepseek-official/model-b", 1200, flat(50))]
		}],
		total: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 2400, cacheHitRate: 0 }
	};
	try {
		await freshMount();
		q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(100);
		q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		q("[data-dsh-usage-pop] .u_day").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(50);
		qa("[data-dsh-usage-pop] .u_detailTab").find((tab) => tab.textContent === t("detail.models")).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(30);
		// y-axis tick column: three labels (0 / mid / peak). The top label
		// carries the unit, the lower two are bare numbers.
		const yTicks = qa("[data-dsh-usage-pop] .u_chartYTick");
		assert.equal(yTicks.length, 3, "three y-axis tick labels");
		assert.equal(yTicks[0].textContent, "0", "bottom tick reads 0");
		assert.equal(yTicks[1].textContent, "25", "middle tick reads the half-peak value");
		assert.equal(yTicks[2].textContent, "50", "top tick reads the peak value");
		// Peak label in the top-right corner echoes the scale; values are
		// raw token counts (no per-hour suffix), because the x-axis already
		// pins each point to a specific hour.
		const maxLabel = q("[data-dsh-usage-pop] .u_chartMax");
		assert.ok(maxLabel !== null, "peak label rendered");
		assert.equal(maxLabel.textContent, "50", "peak label carries the same value as the top y-tick");
		// Sanity check: no per-hour suffix leaks into either label — the
		// token count is the whole story; the hour is communicated by the
		// x-axis ticks.
		assert.ok(!yTicks[2].textContent.includes("/h"), "top y-tick has no per-hour unit");
		assert.ok(!maxLabel.textContent.includes("/h"), "peak label has no per-hour unit");
		// The y-tick column never overlaps the leftmost data point: with
		// padL = 32 the leftmost x position sits well past the 26 px tick
		// column. Sanity check by reading the leftmost polyline point and
		// ensuring it starts past x=30 in the viewBox coordinate system.
		const firstLine = q("[data-dsh-usage-pop] .u_chartLine");
		assert.ok(firstLine !== null, "at least one curve is drawn");
		const firstPoint = String(firstLine.getAttribute("points") ?? "").split(" ")[0] ?? "";
		const firstX = Number(firstPoint.split(",")[0]);
		assert.ok(Number.isFinite(firstX) && firstX >= 30, "leftmost data point sits past the y-tick gutter");
	} finally {
		usagePayload = originalPayload;
	}
});

await test("usage curve legend has a show-all toggle that mass-hides and mass-restores every curve", async () => {
	const flat = (v) => new Array(24).fill(v);
	const model = (name, tokens, hours) => ({ model: name, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens, cacheHitRate: 0, hours });
	const originalPayload = usagePayload;
	usagePayload = {
		...USAGE,
		days: [{
			date: todayKey,
			inputTokens: 1200, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
			tokens: 28800, cacheHitRate: 0, hours: flat(1200),
			models: [model("deepseek-official/model-a", 9600, flat(400)), model("deepseek-official/model-b", 9600, flat(400)), model("deepseek-official/model-c", 9600, flat(400))]
		}],
		total: { inputTokens: 1200, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 28800, cacheHitRate: 0 }
	};
	try {
		await freshMount();
		q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(100);
		q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		q("[data-dsh-usage-pop] .u_day").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(50);
		qa("[data-dsh-usage-pop] .u_detailTab").find((tab) => tab.textContent === t("detail.models")).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(30);
		// Default: toggle is on, every curve is drawn.
		const allToggle = q("[data-dsh-usage-pop] .u_chartLegendAll");
		assert.ok(allToggle !== null, "show-all toggle rendered");
		assert.equal(allToggle.getAttribute("data-state"), "on", "default state is on (everything shown)");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLegendItem").length, 3, "three legend items for three models");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLine").length, 3, "three curves drawn by default");
		// Click the master toggle → every curve disappears at once, the toggle
		// flips to the off state, and every legend item shows the dimmed style.
		allToggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		assert.equal(allToggle.getAttribute("data-state"), "off", "toggle is off after a click while everything was shown");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLine").length, 0, "no curves drawn after mass-hide");
		const allDimmed = qa("[data-dsh-usage-pop] .u_chartLegendItem").every((el) => el.getAttribute("data-hidden") === "true");
		assert.ok(allDimmed, "every legend item is dimmed after mass-hide");
		// Click the master toggle again → every curve returns in one shot.
		allToggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		assert.equal(allToggle.getAttribute("data-state"), "on", "toggle is back to on after a second click");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLine").length, 3, "all three curves drawn again");
		const allShown = qa("[data-dsh-usage-pop] .u_chartLegendItem").every((el) => el.getAttribute("data-hidden") === null);
		assert.ok(allShown, "every legend item is back to its default-shown state");
	} finally {
		usagePayload = originalPayload;
	}
});

await test("usage curve show-all toggle enters a mixed state after individual hides", async () => {
	const flat = (v) => new Array(24).fill(v);
	const model = (name, tokens, hours) => ({ model: name, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens, cacheHitRate: 0, hours });
	const originalPayload = usagePayload;
	usagePayload = {
		...USAGE,
		days: [{
			date: todayKey,
			inputTokens: 800, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
			tokens: 19200, cacheHitRate: 0, hours: flat(800),
			models: [model("deepseek-official/model-a", 9600, flat(400)), model("deepseek-official/model-b", 9600, flat(400))]
		}],
		total: { inputTokens: 800, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 19200, cacheHitRate: 0 }
	};
	try {
		await freshMount();
		q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(100);
		q(`[data-dsh-usage-dock] .u_dockUsagePop[aria-label="${t("action.usagePop")}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		q("[data-dsh-usage-pop] .u_day").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(50);
		qa("[data-dsh-usage-pop] .u_detailTab").find((tab) => tab.textContent === t("detail.models")).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(30);
		// Default on; click one legend item to land in the partial / mixed state.
		const allToggle = q("[data-dsh-usage-pop] .u_chartLegendAll");
		assert.equal(allToggle.getAttribute("data-state"), "on", "toggle starts on");
		const items = qa("[data-dsh-usage-pop] .u_chartLegendItem");
		items[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		assert.equal(allToggle.getAttribute("data-state"), "mixed", "toggle enters mixed state after one item is hidden");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLine").length, 1, "only the remaining curve is drawn");
		// Clicking the master toggle from a mixed state brings every curve back
		// in one click — the user should not need to clear state first.
		allToggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await sleep(60);
		assert.equal(allToggle.getAttribute("data-state"), "on", "toggle is on after a mass-restore from mixed");
		assert.equal(qa("[data-dsh-usage-pop] .u_chartLine").length, 2, "both curves drawn again after the mass-restore");
		const allShown = qa("[data-dsh-usage-pop] .u_chartLegendItem").every((el) => el.getAttribute("data-hidden") === null);
		assert.ok(allShown, "every legend item is back to its default-shown state");
	} finally {
		usagePayload = originalPayload;
	}
});

await test("closing the panel keeps the dock alive", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	assert.ok(q("[data-dsh-usage-panel]") !== null, "panel open");
	const closeButton = [...qa("[data-dsh-usage-panel] .u_iconButton")].find((b) => b.getAttribute("aria-label") === t("action.close"));
	closeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-panel]"), null, "panel closed");
	assert.ok(q("[data-dsh-usage-dock]") !== null, "dock persists");
	assert.equal(qa(".u_dockItem").length, 4, "pinned compacts persist");
});

//#endregion

if (currentRoot !== null) currentRoot.unmount();
dom.window.close();
console.log(`\n${passed} e2e tests passed`);
process.exit(0);
