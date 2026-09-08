/**
 * dsh-usage — pure per-day, per-model token-usage aggregation over session
 * event logs. Kept free of cordis imports so it can be unit-tested and
 * validated against real logs outside the running harness.
 *
 * Aggregation semantics mirror the DSH token projection (dsh-token-meter's
 * `tokenUsage` unit, MIT):
 *   - a usage sample rides an `assistant/message` (`data.usage`, falling back
 *     to the last `usage` chunk embedded in its `data.stream`), an
 *     `assistant/attempt` (whose usage lives ONLY in the embedded stream), or
 *     a legacy pre-v2 `assistant/chunk` (`data.chunk.type === "usage"`);
 *   - a repeated sample for the same (turn, step) REPLACES the earlier value
 *     instead of double counting it, and the replacement is re-attributed to
 *     the day of the later event;
 *   - `llm/retry-started` closes that replacement slot, so a retried attempt
 *     ADDS to the total instead of replacing the attempt that failed;
 *   - `assistant/message` names its provider/model via `data.message.source`;
 *     usage chunks fall back to the last `request/header`
 *     `data.header.config`; samples with no model information land in the
 *     `unknown/unknown` bucket.
 *
 * @module dsh-usage/usage
 */

/** Local-calendar `YYYY-MM-DD` key for a millisecond epoch. */
export function dayKey(timeMs) {
	const date = new Date(timeMs);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Empty token bucket. */
export function zeroBuckets() {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0
	};
}

/** Provider usage → buckets (missing cache fields are absent in some reports). */
export function bucketsOf(usage) {
	return {
		inputTokens: usage.inputTokens ?? 0,
		outputTokens: usage.outputTokens ?? 0,
		cacheReadTokens: usage.cacheReadTokens ?? 0,
		cacheWriteTokens: usage.cacheWriteTokens ?? 0
	};
}

/** Total tokens across all buckets. */
export function totalTokens(buckets) {
	return buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
}

/**
 * Prompt-side cache hit rate in percent (0–100, one decimal), or null when
 * no prompt tokens were reported at all. Hits over the whole prompt side:
 * cacheRead / (input + cacheRead + cacheWrite).
 */
export function cacheHitRate(buckets) {
	const input = buckets.inputTokens ?? 0;
	const cacheRead = buckets.cacheReadTokens ?? 0;
	const cacheWrite = buckets.cacheWriteTokens ?? 0;
	const promptTokens = input + cacheRead + cacheWrite;
	if (promptTokens <= 0) return null;
	return Math.round((cacheRead / promptTokens) * 1000) / 10;
}

function addInto(target, source) {
	target.inputTokens += source.inputTokens;
	target.outputTokens += source.outputTokens;
	target.cacheReadTokens += source.cacheReadTokens;
	target.cacheWriteTokens += source.cacheWriteTokens;
	return target;
}

function subtractFrom(target, source) {
	target.inputTokens -= source.inputTokens;
	target.outputTokens -= source.outputTokens;
	target.cacheReadTokens -= source.cacheReadTokens;
	target.cacheWriteTokens -= source.cacheWriteTokens;
	return target;
}

/**
 * The last `usage` chunk embedded in one compacted assistant stream. A v2 log
 * stores any chunk that cannot be merged into a delta run as
 * `{ type: "chunk", time, chunk }`, and a stream may report usage several
 * times, so the LAST report is the settlement's total.
 */
function usageFromStream(stream) {
	if (!Array.isArray(stream)) return void 0;
	for (let index = stream.length - 1; index >= 0; index -= 1) {
		const record = stream[index];
		if (record?.type === "chunk" && record.chunk?.type === "usage" && record.chunk.usage !== void 0) {
			return record.chunk.usage;
		}
	}
	return void 0;
}

/** Extract the usage sample an event carries, if any. */
function sampleOf(event) {
	const data = event.data;
	if (data === void 0 || data === null) return void 0;
	const key = `${data.turn}:${data.step}`;
	// Pre-v2 logs reported usage as a standalone chunk event.
	if (event.type === "assistant/chunk") {
		return data.chunk?.type === "usage" ? { key, usage: data.chunk.usage } : void 0;
	}
	if (event.type === "assistant/message") {
		const usage = data.usage ?? usageFromStream(data.stream);
		return usage === void 0 ? void 0 : { key, usage };
	}
	// An attempt that committed no message reports usage only inside its stream.
	if (event.type === "assistant/attempt") {
		const usage = usageFromStream(data.stream);
		return usage === void 0 ? void 0 : { key, usage };
	}
	return void 0;
}

/**
 * The `provider/model` attribution key of a usage sample: the exact provider
 * route (dsh adapter id or pi-ai route) plus the model id, so the SAME model
 * served by different providers stays distinct.
 */
function modelOf(event) {
	const source = event.data?.message?.source;
	if (source !== void 0 && typeof source.model === "string") {
		return `${typeof source.provider === "string" && source.provider.length > 0 ? source.provider : "unknown"}/${source.model}`;
	}
	const config = event.data?.header?.config;
	if (config !== void 0 && typeof config.model === "string") {
		return `${typeof config.provider === "string" && config.provider.length > 0 ? config.provider : "unknown"}/${config.model}`;
	}
	return void 0;
}

/** Day entry: totals plus a per-model bucket map. */
function entryOf(byDay, day) {
	let entry = byDay.get(day);
	if (entry === void 0) {
		entry = {
			totals: zeroBuckets(),
			models: new Map()
		};
		byDay.set(day, entry);
	}
	return entry;
}

/**
 * One session's incremental fold state. `days` holds the already-folded
 * per-day entries; `hours` holds per-day, per-hour token totals (24 slots)
 * for the activity heatmap; `modelHours` holds per-day, per-model, per-hour
 * totals (24 slots) for the per-model usage curve; `lastSample`/
 * `currentModel` let a later event slice keep the replace-last-sample
 * semantics and model attribution across fold boundaries without replaying
 * the whole log.
 */
export function createUsageState() {
	return {
		days: new Map(),
		hours: new Map(),
		modelHours: new Map(),
		lastSample: null,
		currentModel: null,
		consumed: 0
	};
}

/** Per-day hour array (24 slots, all zero). */
export function zeroHours() {
	return new Array(24).fill(0);
}

/** Hour slot for an event's timestamp (local time, 0–23). */
export function hourOf(timeMs) {
	return new Date(timeMs).getHours();
}

function hourEntryOf(state, day) {
	let hours = state.hours.get(day);
	if (hours === void 0) {
		hours = zeroHours();
		state.hours.set(day, hours);
	}
	return hours;
}

/** Per-model hour slots for a (day, model) pair (24 slots, all zero). */
function modelHourEntryOf(state, day, model) {
	let dayHours = state.modelHours.get(day);
	if (dayHours === void 0) {
		dayHours = new Map();
		state.modelHours.set(day, dayHours);
	}
	let hours = dayHours.get(model);
	if (hours === void 0) {
		hours = zeroHours();
		dayHours.set(model, hours);
	}
	return hours;
}

/**
 * Fold a slice of NEW events onto an existing session state (mutating).
 * Replacements for the same (turn, step) subtract the previous sample's
 * buckets from the day/model/hour/model-hour buckets they were attributed
 * to, so a slice starting mid-step (e.g. a usage chunk at the tail of the
 * previous fold) stays exact.
 * @param state - session fold state (mutated in place).
 * @param events - the new events, in seq order, starting after the last fold.
 */
export function applyUsageDelta(state, events) {
	let last = state.lastSample;
	let currentModel = state.currentModel;
	for (const event of events) {
		if (event.type === "request/header") {
			const model = modelOf(event);
			if (model !== void 0) currentModel = model;
		}
		// A retry reuses its step's (turn, step) pair, so close the replacement
		// slot: the retried attempt must ADD to the total, not replace the
		// attempt that just failed.
		if (event.type === "llm/retry-started" && last !== null
			&& last.key === `${event.data?.turn}:${event.data?.step}`) {
			last = null;
			continue;
		}
		const sample = sampleOf(event);
		if (sample === void 0) continue;
		const buckets = bucketsOf(sample.usage);
		const model = modelOf(event) ?? currentModel ?? "unknown/unknown";
		const day = dayKey(event.time);
		const hour = hourOf(event.time);
		const entry = entryOf(state.days, day);
		if (last !== null && last.key === sample.key) {
			// Same turn/step re-reported: replace instead of double counting.
			const previous = state.days.get(last.day);
			if (previous !== void 0) {
				subtractFrom(previous.totals, last.buckets);
				const previousModel = previous.models.get(last.model);
				if (previousModel !== void 0) subtractFrom(previousModel, last.buckets);
			}
			const previousHours = state.hours.get(last.day);
			if (previousHours !== void 0 && last.hour !== void 0) {
				previousHours[last.hour] -= totalTokens(last.buckets);
			}
			const previousModelHours = state.modelHours.get(last.day)?.get(last.model);
			if (previousModelHours !== void 0 && last.hour !== void 0) {
				previousModelHours[last.hour] -= totalTokens(last.buckets);
			}
		}
		addInto(entry.totals, buckets);
		let modelBucket = entry.models.get(model);
		if (modelBucket === void 0) {
			modelBucket = zeroBuckets();
			entry.models.set(model, modelBucket);
		}
		addInto(modelBucket, buckets);
		const hourEntry = hourEntryOf(state, day);
		hourEntry[hour] += totalTokens(buckets);
		const modelHourEntry = modelHourEntryOf(state, day, model);
		modelHourEntry[hour] += totalTokens(buckets);
		last = { key: sample.key, day, hour, model, buckets };
	}
	state.lastSample = last;
	state.currentModel = currentModel;
}

/**
 * Fold one session's events into per-day, per-model token buckets.
 * @param events - session event log in seq order.
 * @returns Map<`YYYY-MM-DD`, { totals, models: Map<model, buckets> }> with
 *   only days that saw usage.
 */
export function foldUsage(events) {
	const state = createUsageState();
	applyUsageDelta(state, events);
	return state.days;
}

/**
 * Merge one session's folded days into a global per-day map.
 * @param byDay - global map to mutate.
 * @param sessionDays - session day map (from foldUsage or a state).
 */
export function mergeInto(byDay, sessionDays) {
	for (const [day, entry] of sessionDays) {
		const target = entryOf(byDay, day);
		addInto(target.totals, entry.totals);
		for (const [model, buckets] of entry.models) {
			let modelBucket = target.models.get(model);
			if (modelBucket === void 0) {
				modelBucket = zeroBuckets();
				target.models.set(model, modelBucket);
			}
			addInto(modelBucket, buckets);
		}
	}
}

/** Merge one session's per-day hour totals into a global hour map. */
export function mergeHoursInto(byHour, sessionHours) {
	for (const [day, hours] of sessionHours) {
		let target = byHour.get(day);
		if (target === void 0) {
			target = zeroHours();
			byHour.set(day, target);
		}
		for (let i = 0; i < 24; i += 1) target[i] += hours[i] ?? 0;
	}
}

/** Merge one session's per-model per-day hour totals into a global map. */
export function mergeModelHoursInto(byModelHour, sessionModelHours) {
	for (const [day, dayHours] of sessionModelHours) {
		let targetDay = byModelHour.get(day);
		if (targetDay === void 0) {
			targetDay = new Map();
			byModelHour.set(day, targetDay);
		}
		for (const [model, hours] of dayHours) {
			let target = targetDay.get(model);
			if (target === void 0) {
				target = zeroHours();
				targetDay.set(model, target);
			}
			for (let i = 0; i < 24; i += 1) target[i] += hours[i] ?? 0;
		}
	}
}

/** Merge one session fold into a global per-day map (convenience wrapper). */
export function consumeEvents(byDay, events) {
	mergeInto(byDay, foldUsage(events));
}

/**
 * Render a global per-day map into the wire shape for the usage endpoint.
 * @param byDay - day → entry map.
 * @param byHour - day → 24-slot hour totals map (activity heatmap source).
 * @param byModelHour - day → model → 24-slot hour totals map (per-model curve source).
 * @param updatedAt - computation timestamp.
 * @returns `{ days, total, updatedAt }` with `days` sorted ascending; each
 *   day carries `models` (descending by tokens, each with its own `hours`
 *   array), a `cacheHitRate` percent, and an `hours` array (24 slots, token
 *   totals per local hour).
 */
export function renderUsage(byDay, byHour, byModelHour, updatedAt) {
	const days = [...byDay.entries()]
		.map(([date, entry]) => {
			const dayModelHours = byModelHour.get(date) ?? new Map();
			const models = [...entry.models.entries()]
				.map(([model, buckets]) => ({
					model,
					...buckets,
					tokens: totalTokens(buckets),
					cacheHitRate: cacheHitRate(buckets),
					hours: dayModelHours.get(model) ?? zeroHours()
				}))
				.sort((a, b) => b.tokens - a.tokens);
			return {
				date,
				...entry.totals,
				tokens: totalTokens(entry.totals),
				cacheHitRate: cacheHitRate(entry.totals),
				hours: byHour.get(date) ?? zeroHours(),
				models
			};
		})
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const total = zeroBuckets();
	for (const [, entry] of byDay) addInto(total, entry.totals);
	return {
		days,
		total: {
			...total,
			tokens: totalTokens(total),
			cacheHitRate: cacheHitRate(total)
		},
		updatedAt
	};
}
