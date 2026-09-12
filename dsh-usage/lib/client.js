/**
 * dsh-usage — browser half (v0.2 redesign).
 *
 * Design principles: restrained, minimal, modern, techy. The differentiator
 * is "everything is customizable": every feature is a WIDGET with two
 * expressions —
 *   - detail (the panel card: full data + controls), and
 *   - compact (the bottom-left floating dock row: one glanceable line).
 * Each widget can be pinned to the dock, collapsed, hidden, or reordered.
 * The theme engine customizes accent color, background color, and panel
 * opacity; settings persist in localStorage.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step). The slot runtime
 * injects `wide` and `t`; the plugin body registers dictionaries and the
 * `sidebar.footer.action` slot.
 */
window.__ModuleLoader__.load({
	id: "dsh-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const NS = "dsh-usage";



		//#region heat geometry
		/**
		 * Activity-heatmap geometry — the SINGLE source of truth for the CSS
		 * rules below AND for the popup frame that hosts them: the heatmap is a
		 * MONTH view, so the grid carries up to 31 day columns (the longest
		 * month) × 6 four-hour rows of square cells, plus a narrow gutter for
		 * the hour labels. `HEAT_CELL` is the natural (and maximum) cell edge:
		 * on a roomy slot the grid renders at exactly that size instead of
		 * stretching to fill the frame, and on a cramped one the
		 * `minmax(0,1fr)` columns shrink it proportionally. The stylesheet is
		 * interpolated from these numbers, so changing a size here moves the
		 * grid, the box, and the popup width together — nothing to keep in sync
		 * by hand.
		 */
		const HEAT_COLS = 31;
		const HEAT_ROWS = 6;
		const HEAT_HOURS = 24 / HEAT_ROWS;
		const HEAT_CELL = 16;
		const HEAT_GAP = 3;
		const HEAT_GUTTER = 22;
		/** Natural `.u_heatBox` width: gutter + 31 cells + 31 gaps. */
		const HEAT_WIDTH = HEAT_GUTTER + HEAT_COLS * (HEAT_CELL + HEAT_GAP);
		/** Horizontal padding of the heatmap popup body. */
		const HEAT_POP_PAD = 20;
		/** Heatmap popup width: the grid at its natural size + padding + borders. */
		const HEAT_POP_WIDTH = HEAT_WIDTH + HEAT_POP_PAD * 2 + 2;
		/** Gap between the hovered cell and its bubble. */
		const HEAT_TIP_GAP = 8;
		//#endregion

		//#region css
		const css = [
			// floating dock (persistent, bottom-left, raised above the sidebar settings): one frame, divider rows, gear in the top-right corner
			".u_dock{position:fixed;left:14px;bottom:72px;z-index:30;display:flex;flex-direction:column;gap:6px;align-items:flex-start;transition:opacity .18s ease}",
			".u_dockFrame{position:relative;box-sizing:border-box;width:100%;min-width:176px;max-width:264px;padding:32px 14px 8px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--u-bg,var(--dsw-alias-bg-base));box-shadow:var(--dsw-shadow-lv2);display:flex;flex-direction:column}",
			".u_dockItem{display:flex;align-items:center;gap:8px;padding:7px 0;border:none;background:0 0;cursor:pointer;font:inherit;text-align:left;color:inherit;width:100%}",
			".u_dockItem:hover .u_floatValue{color:var(--dsw-alias-label-primary)}",
			".u_dockDivider{height:1px;background:var(--dsw-alias-border-l1);flex:none}",
			".u_dockSettings{position:absolute;top:8px;right:10px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}",
			".u_dockSettings:hover{color:var(--u-accent,#1f6feb)}",
			".u_dockRefresh{position:absolute;top:8px;right:36px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}",
			".u_dockRefresh:hover{color:var(--u-accent,#1f6feb)}",
			".u_dockUsagePop{position:absolute;top:8px;right:62px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}",
			".u_dockUsagePop:hover{color:var(--u-accent,#1f6feb)}",
			".u_dockUsagePop[data-active]{color:var(--u-accent,#1f6feb);background:color-mix(in srgb,var(--u-accent,#1f6feb) 12%,transparent)}",
			".u_dockHeatmapPop{position:absolute;top:8px;right:88px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}",
			".u_dockHeatmapPop:hover{color:var(--u-accent,#1f6feb)}",
			".u_dockHeatmapPop[data-active]{color:var(--u-accent,#1f6feb);background:color-mix(in srgb,var(--u-accent,#1f6feb) 12%,transparent)}",

			".u_dockGrip{position:absolute;top:8px;left:10px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;border:none;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:grab;padding:0;touch-action:none}",
			".u_dockGrip:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".u_dockGrip:active{cursor:grabbing}",
			// rail mode: a single rounded-rect balance pill, centered on the
			// collapsed sidebar; clicking reveals the dock
			".u_railBtn{position:fixed;bottom:72px;z-index:30;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--u-bg,var(--dsw-alias-bg-base));box-shadow:var(--dsw-shadow-lv2);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:0;padding:3px 6px;transform:translateX(-50%);transition:transform .15s ease}",
			".u_railBtn:hover{transform:translateX(-50%) scale(1.05)}",
			".u_railLabel{color:var(--dsw-alias-label-secondary);font-size:9px;line-height:11px}",
			".u_railValue{color:var(--dsw-alias-label-primary);font-size:10px;font-weight:600;line-height:13px;font-variant-numeric:tabular-nums;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".u_railValue[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}",
			".u_railValue[data-tone=bad]{color:var(--dsw-alias-state-error-primary)}",
			".u_railScrim{position:fixed;inset:0;z-index:25;background:transparent}",
			".u_floatLabel{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".u_floatValue{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;font-variant-numeric:tabular-nums;margin-left:auto;transition:color .15s ease}",
			".u_floatValue[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}",
			".u_floatValue[data-tone=accent]{color:var(--u-accent,#1f6feb)}",
			".u_floatValue[data-tone=warn]{color:var(--dsw-alias-state-warning-primary,#d29922)}",
			".u_floatValue[data-tone=bad]{color:var(--dsw-alias-state-error-primary)}",
			// week mini cells (compact heat)
			".u_weekMini{display:flex;gap:2px;align-items:center}",
			".u_weekCell{width:10px;height:10px;border-radius:3px;background:var(--dsw-alias-fill-l2)}",
			// detail panel (two-column macro layout; keep PANEL_WIDTH in sync below)
			".u_panel{z-index:40;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--u-bg,var(--dsw-alias-bg-base));width:960px;max-width:calc(100vw - 24px);max-height:82vh;box-shadow:var(--dsw-shadow-lv2);border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:12px;left:12px;overflow:hidden}",
			".u_header{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:0 0;flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:10px 12px;display:flex}",
			".u_headerLeft{align-items:center;gap:8px;display:flex}",
			".u_title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}",
			".u_headerActions{align-items:center;gap:2px;display:flex}",
			".u_iconButton{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}",
			".u_iconButton:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".u_iconButton[data-active]{color:var(--u-accent,#1f6feb);background:color-mix(in srgb,var(--u-accent,#1f6feb) 12%,transparent)}",
			".u_body{flex:1;min-height:0;padding:4px 16px 16px;overflow-y:auto}",
			".u_note{color:var(--dsw-alias-label-tertiary);margin:4px 0;font-size:12px;line-height:18px}",
			// usage popup (recent usage log). Fully independent of the
			// balance panel and never shown at the same time, so it deliberately
			// shares the panel's geometry: same width, same clamps, same anchor.
			".u_usagePop{z-index:45;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--u-bg,var(--dsw-alias-bg-base));width:960px;max-width:calc(100vw - 24px);max-height:82vh;box-shadow:var(--dsw-shadow-lv2);border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:12px;left:12px;overflow:hidden}",
			".u_usagePopHead{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:10px 12px;display:flex}",
			".u_usagePopTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}",
			".u_usagePopBody{flex:1;min-height:0;padding:8px 12px 12px;overflow-y:auto;display:flex;flex-direction:column;gap:12px}",
			".u_usagePopCustomizer{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:4px 0}",
			".u_usagePopSection{display:flex;flex-direction:column;gap:4px}",
			".u_usagePopSectionTitle{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:16px;margin:0}",
			".u_usagePopSectionBody{min-width:0}",
			// The recent list owns the popup body (the heatmap moved to its own
			// popup). The list scrolls inside its own section so a long usage
			// history never pushes content out of the frame.
			".u_usagePopSection[data-widget=recent]{flex:1 1 auto;min-height:0}",
			".u_usagePopSection[data-widget=recent] .u_usagePopSectionBody{flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-fill-l2) transparent}",
			".u_usagePopSection[data-widget=recent] .u_usagePopSectionBody::-webkit-scrollbar{width:4px}",
			".u_usagePopSection[data-widget=recent] .u_usagePopSectionBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-fill-l2);border-radius:2px}",
			".u_usagePop .u_days{flex:1;min-height:0;max-height:none}",
			// Heatmap-only popup: keeps the panel's anchor corner (same left, same
			// bottom edge) but sizes itself to the heatmap instead of taking the
			// whole slot — the grid has a natural size, so a panel-sized frame
			// would either blow the cells up or leave a large void around them.
			// The width is derived from the grid geometry; the height hugs the
			// content and is clamped by the inline `max-height` the slot allows.
			`.u_heatmapPop{z-index:45;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--u-bg,var(--dsw-alias-bg-base));width:${HEAT_POP_WIDTH}px;max-width:calc(100vw - 24px);max-height:82vh;box-shadow:var(--dsw-shadow-lv2);border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:12px;left:12px;overflow:hidden}`,
			".u_heatmapPopHead{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:10px 12px;display:flex;gap:8px}",
			".u_heatmapPopTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}",
			// "本月 1.2k tokens" + "今日 1.2k" chips in the popup header. Two chips
			// sit next to each other (total on the LEFT of today's); both use
			// the same neutral pill so they read as a single glance block.
			".u_heatTotalChip{display:inline-flex;align-items:center;gap:5px;margin-left:auto;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap}",
			".u_heatTotalChip b{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}",
			// "今日活跃 1.2k" chip in the popup header (label + compact total).
			".u_heatTodayChip{display:inline-flex;align-items:center;gap:5px;margin-left:0;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap}",
			".u_heatTodayChip b{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}",
			`.u_heatmapPopBody{flex:1;min-height:0;padding:12px ${HEAT_POP_PAD}px 14px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;overflow:auto}`,
			".u_heatmapPopSection{flex:0 1 auto;min-height:0;display:flex;flex-direction:column;align-items:stretch;gap:6px;width:100%}",
			".u_heatmapPopSectionBody{min-width:0;display:flex;justify-content:center}",
			".u_heatmapPopSectionBody .u_heatBox{max-width:100%}",
			// theme customizer
			".u_themeBox{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px}",
			".u_themeRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".u_themeLabel{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;min-width:44px}",
			".u_swatch{width:18px;height:18px;border-radius:50%;border:1px solid transparent;cursor:pointer;padding:0;box-sizing:border-box}",
			".u_swatch[data-active]{border-color:var(--dsw-alias-label-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--u-accent,#1f6feb) 40%,transparent)}",
			".u_swatchNull{background:conic-gradient(var(--dsw-alias-label-tertiary) 25%,var(--dsw-alias-fill-l2) 0 50%,var(--dsw-alias-label-tertiary) 0 75%,var(--dsw-alias-fill-l2) 0)}",
			".u_colorInput{width:26px;height:26px;border:none;background:0 0;cursor:pointer;padding:0}",
			".u_range{flex:1;min-width:80px;accent-color:var(--u-accent,#1f6feb)}",
			".u_reset{cursor:pointer;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;font:inherit;font-size:11px;line-height:16px;padding:0}",
			".u_reset:hover{color:var(--dsw-alias-label-primary)}",
			// model display-name alias editor (rendered inside u_themeBox)
			".u_aliasBox{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px}",
			".u_aliasHeader{display:flex;align-items:center;gap:8px;justify-content:space-between}",
			".u_aliasTitle{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-weight:600;letter-spacing:.02em}",
			".u_aliasHint{color:var(--dsw-alias-label-caption);font-size:10.5px;line-height:15px;letter-spacing:.01em;margin:0}",
			".u_aliasList{display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-fill-l2) transparent}",
			".u_aliasList::-webkit-scrollbar{width:4px}",
			".u_aliasList::-webkit-scrollbar-thumb{background:var(--dsw-alias-fill-l2);border-radius:2px}",
			".u_aliasRow{display:flex;align-items:center;gap:6px}",
			".u_aliasKey{flex:none;color:var(--dsw-alias-label-caption);font-size:10.5px;line-height:14px;font-family:var(--dsw-alias-font-mono,ui-monospace,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:42%;padding:2px 6px;border-radius:6px;background:var(--dsw-alias-fill-l1)}",
			".u_aliasArrow{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px;flex:none}",
			".u_aliasInput{flex:1;min-width:0;background:0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:16px;padding:3px 8px;outline:none}",
			".u_aliasInput:focus{border-color:var(--u-accent,#1f6feb);box-shadow:0 0 0 2px color-mix(in srgb,var(--u-accent,#1f6feb) 25%,transparent)}",
			".u_aliasResetOne{flex:none;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;cursor:pointer;font:inherit;font-size:10.5px;line-height:14px;padding:0 4px}",
			".u_aliasResetOne:hover{color:var(--dsw-alias-label-primary)}",
			".u_aliasEmpty{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}",
			// two-column macro layout: the main column carries the balance card and
			// the four stat cards, the aside column is reserved for the usage log
			// and the activity heatmap. Wraps to one column on narrow viewports.
			".u_columns{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}",
			".u_gridMain{flex:1 1 360px;min-width:0}",
			".u_gridAside{flex:1 1 360px;min-width:0;display:flex;flex-direction:column;gap:10px}",
			// widget cards (two-per-row grid; full-width cards span both)
			".u_grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch}",
			".u_widget{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;min-width:0;transition:transform .22s cubic-bezier(.22,.61,.36,1)}",
			".u_widget[data-width=full]{grid-column:1/-1}",
			".u_widgetHead{display:flex;align-items:center;gap:2px;padding:5px 10px;background:color-mix(in srgb,var(--u-accent,#1f6feb) 4%,transparent)}",
			".u_ghost{border:1.5px dashed var(--dsw-alias-border-l2);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-fill-l2) 55%,transparent);min-height:64px;box-sizing:border-box;opacity:.9}",
			".u_widget[data-dragging]{opacity:.4;border-style:dashed}",
			".u_widgetTitle{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:22px;cursor:pointer;text-align:left;background:0 0;border:none;font:inherit;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".u_wIconBtn{cursor:pointer;width:22px;height:22px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:5px;justify-content:center;align-items:center;padding:0;display:inline-flex;flex:none}",
			".u_wIconBtn:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".u_wIconBtn[data-pinned]{color:var(--u-accent,#1f6feb)}",
			".u_wIconBtn:disabled{opacity:.35;cursor:default}",
			// action buttons appear only on hover (collapse arrow stays visible)
			".u_wHoverBtn{opacity:0;transition:opacity .15s ease}",
			".u_widget:hover .u_wHoverBtn{opacity:1}",
			".u_widget[dragging] .u_wHoverBtn,.u_widget:hover[dragging] .u_wHoverBtn{opacity:0}",
			".u_wBody{padding:11px 12px}",
			// balance detail
			".u_providerPicker{align-items:center;gap:8px;margin:0 0 8px;font-size:12px;line-height:18px;display:flex}",
			".u_providerPickerLabel{color:var(--dsw-alias-label-tertiary);flex:none}",
			".u_providerSelect{box-sizing:border-box;min-width:0;flex:1;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 6px;font:inherit;font-size:12px;line-height:18px}",
			".u_balanceGrid{display:flex;align-items:center;gap:14px;flex-wrap:wrap}",
			".u_balanceLeft{display:flex;flex-direction:column;gap:2px;flex:none}",
			".u_balanceAmount{color:var(--u-accent,#1f6feb);font-size:32px;font-weight:600;line-height:38px;font-variant-numeric:tabular-nums}",
			".u_balanceStatus{align-items:center;gap:5px;font-size:12px;line-height:16px;display:inline-flex}",
			".u_balanceOk{color:var(--dsw-alias-state-success-primary)}",
			".u_balanceBad{color:var(--dsw-alias-state-error-primary)}",
			".u_balanceTable{display:grid;grid-template-columns:auto auto;column-gap:10px;row-gap:1px;margin-left:auto;font-size:12px;line-height:17px}",
			".u_balanceTableLabel{color:var(--dsw-alias-label-tertiary);text-align:right;white-space:nowrap}",
			".u_balanceTableValue{color:var(--dsw-alias-label-primary);font-weight:600;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}",
			".u_error{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:8px;justify-content:space-between;align-items:flex-start;gap:8px;margin:4px 0;padding:7px 8px;font-size:12px;line-height:18px;display:flex}",
			".u_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0}",
			// stats detail (the four stat cards sit in a 2×2 grid in the main
			// column, so the headline number carries the glance)
			".u_statBig{color:var(--dsw-alias-label-primary);font-size:27px;font-weight:600;line-height:34px;font-variant-numeric:tabular-nums}",
			".u_statBreak{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:7px}",
			".u_statBreakItem{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}",
			".u_statBreakItem b{color:var(--dsw-alias-label-secondary);font-weight:600}",
			".u_hitCaption{color:var(--dsw-alias-label-tertiary);margin-top:8px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}",
			".u_hitCaption b{color:var(--dsw-alias-label-secondary);font-weight:600}",
			// recent detail (the aside column has vertical room, so list more days)
			".u_days{flex-direction:column;display:flex;max-height:158px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-fill-l2) transparent}",
			".u_days::-webkit-scrollbar{width:4px}",
			".u_days::-webkit-scrollbar-thumb{background:var(--dsw-alias-fill-l2);border-radius:2px}",
			".u_day{width:100%;min-height:30px;align-items:center;gap:6px;border:0;background:0 0;border-bottom:1px solid var(--dsw-alias-border-l1);padding:5px 0;font:inherit;text-align:left;cursor:pointer;display:flex}",
			".u_day:last-child{border-bottom:0}",
			".u_day:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".u_dayDate{color:var(--dsw-alias-label-secondary);flex:none;width:50px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;text-align:left}",
			".u_dayHit{color:var(--dsw-alias-label-tertiary);flex:none;width:54px;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums;text-align:right}",
			".u_dayTokens{color:var(--dsw-alias-label-primary);flex:none;width:62px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;text-align:right}",
			".u_dayBarTrack{display:block;flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-fill-l2);overflow:hidden;margin-right:8px}",
			".u_dayBar{display:block;background:var(--u-accent,#1f6feb);border-radius:inherit;height:100%;min-width:3px;opacity:.75}",
			".u_detailHeader{align-items:center;gap:8px;display:flex}",
			".u_back{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex;flex:none}",
			".u_back:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".u_detailDate{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:18px}",
			".u_detailHit{color:var(--dsw-alias-label-tertiary);margin-left:auto;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}",
			".u_modelRow{flex-direction:column;gap:2px;margin:6px 0;display:flex}",
			".u_modelMeta{align-items:baseline;gap:8px;display:flex}",
			".u_modelName{color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}",
			".u_modelTokens{color:var(--dsw-alias-label-primary);margin-left:auto;flex:none;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}",
			".u_modelHit{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}",
			".u_modelBarTrack{height:4px;background:var(--dsw-alias-fill-l2);border-radius:999px;overflow:hidden}",
			".u_modelBar{height:100%;background:var(--u-accent,#1f6feb);border-radius:inherit;opacity:.6}",
			// day detail view switcher (overview | model statistics)
			".u_detailTabs{display:flex;gap:2px;margin:8px 0 4px;padding:2px;border-radius:8px;background:var(--dsw-alias-fill-l1)}",
			".u_detailTab{flex:1;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:24px;border-radius:6px;cursor:pointer}",
			".u_detailTab:hover{color:var(--dsw-alias-label-secondary)}",
			".u_detailTab[data-active]{color:var(--u-accent,#1f6feb);background:color-mix(in srgb,var(--u-accent,#1f6feb) 10%,transparent);font-weight:600}",
			// per-model usage curve (SVG; drawn by hand, no chart library).
			// A quiet plot background anchors the eye on the curves; the
			// grid stays subdued so the data carries the visual weight.
			".u_chartWrap{position:relative;margin-top:6px}",
			".u_chartBody{position:relative}",
			".u_chartPlot{position:relative;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-fill-l1) 55%,transparent)}",
			".u_chartSvg{display:block;width:100%;height:148px;touch-action:none}",
			".u_chartGrid{stroke:var(--dsw-alias-fill-l2);stroke-width:1;stroke-dasharray:2 4;vector-effect:non-scaling-stroke;opacity:.85}",
			".u_chartAxis{stroke:color-mix(in srgb,var(--dsw-alias-border-l2) 70%,transparent);stroke-width:1;vector-effect:non-scaling-stroke}",
			".u_chartLine{fill:none;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}",
			".u_chartArea{opacity:.18}",
			// peak label sits in the plot's top-left corner: the scale is readable
			// without hovering, so no y-axis ruler is needed
			// peak label sits in the plot's top-right corner so it can read as
			// "the scale of this chart"; the y-tick column owns the left edge
			".u_chartMax{position:absolute;right:6px;top:6px;padding:1px 6px;border-radius:999px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--u-bg,var(--dsw-alias-bg-base)) 75%,transparent);backdrop-filter:blur(4px);font-size:10px;line-height:14px;font-weight:600;font-variant-numeric:tabular-nums;pointer-events:none;letter-spacing:.01em}",
			// y-axis tick column on the left edge of the plot: the svg itself
			// would stretch text, so the labels live in HTML and share the same
			// coordinate system as the dot marks (top %, with text-align:right
			// to keep numbers flush to the gutter). `pointer-events:none` so
			// the labels never steal hover from the svg behind them.
			".u_chartYTick{font-size:9.5px;line-height:12px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;pointer-events:none;font-weight:500;letter-spacing:.01em}",
			// hovered-hour markers are HTML, not SVG circles: the svg stretches
			// (preserveAspectRatio none), which would turn circles into ovals
			".u_chartDotMark{position:absolute;width:7px;height:7px;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 2px var(--u-bg,var(--dsw-alias-bg-base)),0 1px 4px rgba(0,0,0,.18);pointer-events:none}",
			".u_chartCursor{stroke:color-mix(in srgb,var(--dsw-alias-label-secondary) 70%,transparent);stroke-width:1;stroke-dasharray:2 3;vector-effect:non-scaling-stroke;opacity:.6}",
			".u_chartTicks{position:relative;height:18px;margin-top:6px;pointer-events:none}",
			".u_chartTick{position:absolute;transform:translateX(-50%);color:var(--dsw-alias-label-caption);font-size:10.5px;line-height:16px;font-variant-numeric:tabular-nums;text-align:center;white-space:nowrap;font-weight:500;letter-spacing:.01em}",
			".u_chartLegend{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}",
			// The "show all" toggle lives at the top of the legend, mirroring the
			// toggle idiom used elsewhere: a square checkbox, the label beside it,
			// and a small on/off hint. It only paints when the chart has at
			// least one curve to control.
			".u_chartLegendAll{align-self:flex-end;display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;padding:3px 8px;border-radius:999px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px;background:0 0;border:1px solid transparent;font-weight:500;letter-spacing:.01em;transition:color .12s ease,background .12s ease,border-color .12s ease}",
			".u_chartLegendAll:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}",
			".u_chartLegendAllBox{flex:none;position:relative;width:12px;height:12px;border-radius:3px;border:1.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);box-sizing:border-box;transition:background .12s ease,border-color .12s ease}",
			".u_chartLegendAllMark{position:absolute;inset:1px;border-radius:2px;background:var(--u-accent,#1f6feb);opacity:0;transition:opacity .12s ease}",
			".u_chartLegendAll[data-state=on] .u_chartLegendAllBox{border-color:var(--u-accent,#1f6feb)}",
			".u_chartLegendAll[data-state=on] .u_chartLegendAllMark{opacity:1}",
			".u_chartLegendAll[data-state=off] .u_chartLegendAllBox{background:var(--dsw-alias-bg-base)}",
			".u_chartLegendAll[data-state=mixed] .u_chartLegendAllMark{opacity:1;height:2px;top:5px;border-radius:1px}",
			".u_chartLegendAll:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--u-accent,#1f6feb) 35%,transparent)}",
			".u_chartLegendGroup{display:flex;flex-direction:column;gap:6px}",
			".u_chartLegendGroupName{color:var(--dsw-alias-label-caption);font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;line-height:14px;padding:0 2px}",
			".u_chartLegendGroupItems{display:flex;flex-wrap:wrap;gap:4px 6px}",
			// legend item is a real button so the curve is keyboard-toggleable.
			// Hidden rows keep their footprint (no strike-through) — only the dot
			// goes hollow and the name dims, so the layout stays stable.
			".u_chartLegendItem{display:inline-flex;align-items:center;gap:7px;min-width:0;max-width:100%;padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);cursor:pointer;font:inherit;color:inherit;line-height:18px;transition:opacity .15s ease,border-color .15s ease,background .15s ease,box-shadow .15s ease}",
			".u_chartLegendItem:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}",
			".u_chartLegendItem:focus-visible{outline:none;border-color:var(--u-accent,#1f6feb);box-shadow:0 0 0 2px color-mix(in srgb,var(--u-accent,#1f6feb) 18%,transparent)}",
			".u_chartLegendItem[data-hidden]{opacity:.55}",
			".u_chartLegendItem[data-hidden] .u_chartLegendDot{background:transparent;border:1.5px solid var(--dsw-alias-label-tertiary)}",
			".u_chartLegendDot{width:9px;height:9px;border-radius:50%;flex:none;border:1.5px solid transparent;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.15)}",
			".u_chartLegendName{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:16px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.01em}",
			".u_chartLegendTokens{color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:16px;font-weight:600;font-variant-numeric:tabular-nums;flex:none;margin-left:-1px}",
			".u_chartLegendItem[data-hidden] .u_chartLegendName{color:var(--dsw-alias-label-tertiary)}",
			".u_chartLegendItem[data-hidden] .u_chartLegendTokens{color:var(--dsw-alias-label-tertiary)}",
			".u_chartTip{position:fixed;pointer-events:none;background:color-mix(in srgb,var(--u-bg,var(--dsw-alias-bg-base)) 92%,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;font-size:12px;line-height:18px;box-shadow:0 6px 24px rgba(0,0,0,.18),0 1px 2px rgba(0,0,0,.08);backdrop-filter:blur(8px);white-space:nowrap;z-index:100;max-width:min(360px,calc(100vw - 24px));display:flex;flex-direction:column;gap:5px}",
			".u_chartTipHead{display:flex;align-items:center;gap:6px;padding-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l1);font-variant-numeric:tabular-nums;letter-spacing:.01em}",
			".u_chartTipHour{color:var(--dsw-alias-label-primary);font-weight:600;font-size:11.5px}",
			".u_chartTipSum{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-weight:600;font-size:11.5px;margin-left:auto}",
			".u_chartTipRow{display:flex;align-items:center;gap:7px;min-width:0}",
			".u_chartTipName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11.5px}",
			".u_chartTipDot{width:8px;height:8px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.15)}",
			".u_chartTipVal{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:600;font-size:11.5px;margin-left:auto;letter-spacing:.01em}",
			// hidden manager
			".u_hiddenBox{border-top:1px solid var(--dsw-alias-border-l2);padding:8px 0 0}",
			".u_hiddenToggle{cursor:pointer;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;font:inherit;font-size:11px;line-height:16px;padding:0;display:flex;align-items:center;gap:4px}",
			".u_hiddenToggle:hover{color:var(--dsw-alias-label-primary)}",
			".u_hiddenRow{display:flex;align-items:center;gap:6px;padding:3px 0}",
			".u_hiddenName{flex:1;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}",
			".u_restore{cursor:pointer;color:var(--u-accent,#1f6feb);background:0 0;border:none;font:inherit;font-size:11px;line-height:16px;padding:0}",
			".u_footerNote{color:var(--dsw-alias-label-caption);margin:10px 0 0;font-size:10px;line-height:14px;font-variant-numeric:tabular-nums}",
			// activity heatmap (GitHub-style dots: 28 day columns × 6 four-hour
			// rows). The box caps at its natural width so the cells keep their
			// designed size in a roomy popup, and the `minmax(0,1fr)` columns
			// shrink them proportionally when the slot is narrower.
			`.u_heatBox{position:relative;display:flex;flex-direction:column;gap:5px;width:min(100%,${HEAT_WIDTH}px)}`,
			".u_heatCaption{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;display:flex;justify-content:space-between;align-items:center}",
			`.u_heatGrid{display:grid;grid-template-columns:${HEAT_GUTTER}px repeat(${HEAT_COLS},minmax(0,1fr));gap:${HEAT_GAP}px;align-items:center}`,
			// Month navigation: prev / label / next cluster together in the
			// middle so the arrows hug the month label rather than the popup
			// edges. Wheel paging lives on `.u_heatBox` (see below).
			".u_heatNav{display:flex;align-items:center;justify-content:center;gap:4px}",
			".u_heatNavBtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:14px;line-height:1;transition:color .12s ease,background .12s ease,border-color .12s ease}",
			".u_heatNavBtn:hover:not(:disabled){color:var(--u-accent,#1f6feb);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--u-accent,#1f6feb)}",
			".u_heatNavBtn:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--u-accent,#1f6feb) 35%,transparent)}",
			".u_heatNavBtn:disabled{opacity:.35;cursor:default}",
			".u_heatNavLabel{display:inline-flex;align-items:center;gap:6px;min-width:92px;justify-content:center;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:18px;font-variant-numeric:tabular-nums}",
			// "今" pill that appears next to the month label when the user is on
			// the current month — a single glance tells them paging has stopped.
			".u_heatNavNow{display:inline-flex;align-items:center;justify-content:center;height:16px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--u-accent,#1f6feb) 14%,transparent);color:var(--u-accent,#1f6feb);font-size:10px;font-weight:600;line-height:14px;letter-spacing:.02em}",
			// Per-day numeric header (1 2 3 … 31) aligned over the day columns;
			// weekend numbers dim further so workweeks scan first.
			`.u_heatWeek{display:grid;grid-template-columns:${HEAT_GUTTER}px repeat(${HEAT_COLS},minmax(0,1fr));gap:${HEAT_GAP}px;align-items:end;margin-bottom:-2px}`,
			".u_heatWeekLabel{color:var(--dsw-alias-label-tertiary);font-size:9px;line-height:11px;text-align:center;font-variant-numeric:tabular-nums;overflow:visible}",
			".u_heatWeekend{color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 55%,transparent)}",
			".u_heatHour{color:var(--dsw-alias-label-caption);font-size:10px;line-height:12px;text-align:right;padding-right:3px;font-variant-numeric:tabular-nums}",
			".u_heatCell{aspect-ratio:1/1;min-width:0;border-radius:3px;background:var(--dsw-alias-fill-l2);transition:box-shadow .12s ease,transform .12s ease}",
			".u_heatToday{box-shadow:0 0 0 1px var(--u-accent,#1f6feb)}",
			// Inert padding cells past a short month's last day: they hold the
			// grid geometry but never paint or capture hover.
			".u_heatPad{visibility:hidden}",
			// hovered cell: an accent ring, so the bubble's subject is unambiguous
			// (higher specificity than the today ring, which it replaces)
			".u_heatGrid .u_heatCell:hover{box-shadow:0 0 0 1.5px var(--u-accent,#1f6feb)}",
			".u_heatLegend{display:flex;align-items:center;gap:3px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-caption)}",
			".u_heatLegendLabel{margin-right:2px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
			".u_heatLegendCell{width:10px;height:10px;border-radius:2px;background:var(--dsw-alias-fill-l2);transition:background .12s ease}",
			// cell bubble: replaces the native `title` tooltip, which only showed
			// up after the browser's ~1s hover delay and in OS chrome. It is
			// anchored to the hovered CELL (not the pointer), so it appears the
			// instant the cursor crosses into a cell and only re-renders when the
			// cell changes; the short keyframe is the whole animation budget.
			".u_heatTip{position:fixed;z-index:100;pointer-events:none;display:flex;flex-direction:column;gap:1px;padding:6px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--u-bg,var(--dsw-alias-bg-base));box-shadow:var(--dsw-shadow-lv2);white-space:nowrap;animation:u_heatTipIn .1s ease-out}",
			"@keyframes u_heatTipIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}",
			".u_heatTipHead{display:flex;align-items:center;gap:6px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
			".u_heatTipDate{color:var(--dsw-alias-label-primary);font-weight:600}",
			".u_heatTipWeekday{color:var(--dsw-alias-label-secondary);font-weight:600;font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-fill-l2)}",
			".u_heatTipRow{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px}",
			".u_heatTipDot{width:8px;height:8px;border-radius:2px;flex:none;background:var(--dsw-alias-fill-l2)}",
			".u_heatTipVal{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}",
			".u_heatTipUnit{color:var(--dsw-alias-label-caption);font-size:11px}",
			// compact day activity strip (6 four-hour dots for today)
			".u_todayStrip{display:flex;gap:2px;align-items:center}",
			".u_todayStripCell{width:10px;height:10px;border-radius:3px;background:var(--dsw-alias-fill-l2)}",
			// dual channel comparison
			".u_dualRow{display:flex;align-items:center;gap:8px;margin:3px 0}",
			".u_dualDot{width:8px;height:8px;border-radius:2px;flex:none}",
			".u_dualName{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".u_dualValue{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:18px;font-variant-numeric:tabular-nums}",
			".u_dualSub{color:var(--dsw-alias-label-caption);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums}",
			".u_dualBar{display:flex;height:6px;border-radius:3px;overflow:hidden;margin:8px 0 4px;background:var(--dsw-alias-fill-l2)}",
			".u_dualBarDsh{background:var(--u-accent,#1f6feb);height:100%}",
			".u_dualBarClaude{background:#7c3aed;height:100%}",
			".u_dualMini{display:flex;align-items:center;gap:3px}",
			".u_dualMiniBar{display:flex;width:44px;height:4px;border-radius:2px;overflow:hidden;background:var(--dsw-alias-fill-l2)}",
			".u_dualMiniDsh{background:var(--dsw-alias-label-secondary);height:100%}",
			".u_dualMiniClaude{background:var(--dsw-alias-label-tertiary);height:100%}"
		];
		if (typeof document !== "undefined" && typeof document.createElement === "function") {
			const style = document.createElement("style");
			style.textContent = css.join("");
			document.head.appendChild(style);
		}
		//#endregion

		//#region helpers
		function createLoader() {
			let seq = 0;
			return { start: () => ++seq, isCurrent: (s) => s === seq };
		}

		async function fetchJson(path) {
			const response = await fetch(path, { headers: { accept: "application/json" }, cache: "no-store" });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		}

		function interpolate(text, params) {
			if (params === void 0 || params === null) return text;
			return String(text).replace(/\{(\w+)\}/g, (match, key) => params[key] !== void 0 ? String(params[key]) : match);
		}

		function dayKeyOf(date) {
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const day = String(date.getDate()).padStart(2, "0");
			return `${date.getFullYear()}-${month}-${day}`;
		}

		function todayKey() {
			return dayKeyOf(new Date());
		}

		function dayLabel(dateStr) {
			const parts = String(dateStr).split("-");
			return parts.length === 3 ? `${parts[1]}-${parts[2]}` : dateStr;
		}

		/** Thousands-separated integer. */
		function fmtTokens(value) {
			const n = Number(value);
			if (!Number.isFinite(n)) return String(value ?? "–");
			return n.toLocaleString("en-US");
		}

		/** Compact magnitude: 1.2k / 42.8M / 1.4B. */
		function fmtCompact(value) {
			const n = Number(value);
			if (!Number.isFinite(n)) return "–";
			if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
			if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
			if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
			return fmtTokens(n);
		}

		function currencySymbol(currency) {
			if (currency === "CNY" || currency === "RMB") return "¥";
			if (currency === "USD") return "$";
			if (currency === "EUR") return "€";
			if (typeof currency === "string" && currency !== "") return `${currency} `;
			return "";
		}

		function fmtCurrency(value, currency) {
			if (value === null || value === void 0) return "–";
			const n = Number(value);
			if (Number.isFinite(n) && String(value).trim() !== "") {
				return `${currencySymbol(currency)}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
			}
			return `${currencySymbol(currency)}${value}`;
		}

		function fmtHit(rate) {
			if (rate === null || rate === void 0) return "–";
			const n = Number(rate);
			if (!Number.isFinite(n)) return "–";
			return `${n}%`;
		}

		/** Distinct curve colors, one per model (index-stable, accent first). */
		const MODEL_COLORS = ["var(--u-accent,#1f6feb)", "#7c3aed", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#0ea5e9", "#64748b"];

		/**
		 * Human-facing model label: `provider/model` → either the user's
		 * display alias (when `aliases[key]` is set), or just the model id
		 * (e.g. `deepseek-official/deepseek-v4-pro` → `deepseek-v4-pro`).
		 * The provider segment is intentionally dropped from the default
		 * label so the chart / tooltip / breakdown read as plain model ids;
		 * users who want the provider back can do so by setting an alias.
		 * Unknown providers still have their key intact internally — the
		 * alias map is the only place that ever touches the user-visible
		 * label. Historical aggregation stays keyed by the raw
		 * `provider/model` string.
		 */
		function displayModelName(key, providers, aliases) {
			const s = String(key ?? "");
			const aliasMap = aliases !== void 0 && aliases !== null && typeof aliases === "object" ? aliases : null;
			const aliased = aliasMap !== null ? aliasMap[s] : void 0;
			if (typeof aliased === "string" && aliased.length > 0) return aliased;
			const slash = s.indexOf("/");
			return slash === -1 ? s : s.slice(slash + 1);
		}

		/** Provider display name for a `provider/model` key (group headers). */
		function providerNameOf(key, providers) {
			const s = String(key ?? "");
			const slash = s.indexOf("/");
			if (slash === -1) return s;
			const provider = s.slice(0, slash);
			const found = Array.isArray(providers) ? providers.find((p) => p?.id === provider) : void 0;
			return found?.displayName ?? provider;
		}

		function statusTextOf(account, translate) {
			if (account === null || account === void 0) return translate("balance.loading");
			switch (account.status) {
				case "ok": return translate("status.ok");
				case "not-configured": return translate("balance.notConfigured", { ref: account.missingCredentials?.[0] ?? "" });
				case "unauthorized": return translate("balance.unauthorized");
				case "rate-limited": return translate("balance.rateLimited");
				case "unavailable": return translate("balance.unavailableStatus");
				case "timeout": return translate("balance.timeout");
				case "invalid-response": return translate("balance.invalidResponse");
				case "unsupported": return translate("balance.unsupported");
				default: return translate("balance.loading");
			}
		}

		function defaultProviderId(list) {
			return list.find((provider) => provider.id === "deepseek-official")?.id
				?? list.find((provider) => provider.configured)?.id
				?? list[0]?.id
				?? null;
		}

		/** 5-level alpha ramp derived from the accent color (heat cells). */
		const _HEAT_ALPHAS = [0, 0.22, 0.42, 0.65, 1];
		function heatAlpha(level) {
			return _HEAT_ALPHAS[level] ?? 0;
		}

		/** Precomputed accent-hued heat colors — one per level, computed once at boot. */
		const _HEAT_COLORS = [0, 1, 2, 3, 4].map((level) => `color-mix(in srgb,var(--u-accent,#1f6feb) ${Math.round(heatAlpha(level) * 100)}%,transparent)`);

		/** Precomputed neutral heat colors for the floating dock (accent reserved for balance). */
		const _HEAT_COLORS_NEUTRAL = [0, 1, 2, 3, 4].map((level) => `color-mix(in srgb,var(--dsw-alias-label-secondary,#64748b) ${Math.round(heatAlpha(level) * 0.75 * 100)}%,transparent)`);

		function heatColor(level) {
			return _HEAT_COLORS[level] ?? _HEAT_COLORS[0];
		}

		/** Neutral heat ramp for the floating dock (accent is reserved for balance). */
		function heatColorNeutral(level) {
			return _HEAT_COLORS_NEUTRAL[level] ?? _HEAT_COLORS_NEUTRAL[0];
		}

		/** Bucket a value into 5 heat levels (0–4) by max. */
		function heatLevel(value, max) {
			if (!(value > 0) || !(max > 0)) return 0;
			const ratio = value / max;
			if (ratio >= 0.8) return 4;
			if (ratio >= 0.5) return 3;
			if (ratio >= 0.25) return 2;
			return 1;
		}

		/** `08:00–12:00` — the hour window one heat row covers. */
		function heatHourRange(hour) {
			return `${String(hour).padStart(2, "0")}:00–${String(hour + HEAT_HOURS).padStart(2, "0")}:00`;
		}

		/** Pull the day-of-week (0..6) out of a `YYYY-MM-DD` key. */
		function heatWeekdayOf(dateKey) {
			const parts = String(dateKey).split("-");
			if (parts.length !== 3) return -1;
			const cursor = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
			if (Number.isNaN(cursor.getTime())) return -1;
			return cursor.getDay();
		}

		/**
		 * Heat-cell bubble placement. The bubble is anchored to the hovered
		 * CELL, not to the pointer: it appears to the right of the cell and is
		 * vertically centered against it. Near the right edge it is clamped back
		 * into the viewport; the vertical position is clamped as well. Pure
		 * function of the measured boxes, so placement is unit-testable and never
		 * depends on the DOM.
		 */
		function placeHeatTip(box) {
			const margin = 6;
			const right = Number(box?.right) || Number(box?.cx) || 0;
			const top = Number(box?.top) || 0;
			const bottom = Number(box?.bottom) || 0;
			const tipW = Math.max(0, Number(box?.tipWidth) || 0);
			const tipH = Math.max(0, Number(box?.tipHeight) || 0);
			const vw = Math.max(0, Number(box?.viewportWidth) || 0);
			const vh = Math.max(0, Number(box?.viewportHeight) || 0);
			let x = right + HEAT_TIP_GAP;
			x = Math.min(Math.max(margin, x), Math.max(margin, vw - tipW - margin));
			const cellCenter = (top + bottom) / 2;
			const y = Math.min(Math.max(margin, cellCenter - tipH / 2), Math.max(margin, vh - tipH - margin));
			return { left: Math.round(x), top: Math.round(y) };
		}
		//#endregion

		//#region settings
		const SETTINGS_KEY = "dsh-usage:settings:v1";
		const ACCENT_PRESETS = ["#1f6feb", "#0ea5e9", "#7c3aed", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];
		const BACKGROUND_PRESETS = [null, "#0d1117", "#f6f8fa"];
		/** Panel layout widths: half cards pair up two per row, full span both. */
		const WIDGET_WIDTH = { balance: "full", today: "half", month: "half", hit: "half", dual: "half", heatmap: "full", recent: "full" };
		/** Panel width in px; must match the `.u_panel` rule in the stylesheet. */
		const PANEL_WIDTH = 960;
		/**
		 * Panel columns. The main column carries the balance card and the four
		 * stat cards; the aside column is a single column of its own for the
		 * usage log and the activity heatmap. Widgets keep their column no matter
		 * how they are reordered, so dragging only reorders within a column.
		 */
		const WIDGET_COLUMN = { recent: "aside", heatmap: "aside" };
		/** Column a widget renders in: `"main"` or `"aside"`. */
		function widgetColumn(id) {
			return WIDGET_COLUMN[id] ?? "main";
		}
		/** Widgets that make no sense in the dock (pin button hidden). */
		const WIDGET_PINABLE = { heatmap: false, dual: false, recent: false };

		/**
		 * Widgets that live only in the dedicated popups (usage log in the
		 * usage popup, activity heatmap in the heatmap popup), never in the
		 * main panel columns. They keep their `settings.order` entry (so
		 * persisted settings stay valid) but are filtered out of every
		 * main-panel surface.
		 */
		const POPUP_WIDGETS = new Set(["recent", "heatmap"]);

		function defaultSettings() {
			return {
				theme: { accent: "#1f6feb", background: null, opacity: 1 },
				// Free-floating dock position: `x` is the CSS `left` offset (px),
				// `y` is the CSS `bottom` offset (px). Both are freely dragged and
				// auto-snapped to screen edges on release.
				dockPos: { x: 14, y: 72 },
				// Display-only rename layer for the per-model curve / tooltip /
				// breakdown labels: `provider/model` → user-chosen label. Empty /
				// missing entries fall back to the provider display name + model
				// id. Historical aggregation is keyed by the raw `provider/model`
				// string (see `lib/usage.js`) — adding / clearing aliases never
				// touches the underlying data.
				modelAliases: {},
				order: ["balance", "today", "month", "hit", "dual", "recent", "heatmap"],
				widgets: {
					balance: { visible: true, collapsed: false, pinned: true },
					today: { visible: true, collapsed: false, pinned: true },
					month: { visible: true, collapsed: false, pinned: true },
					hit: { visible: true, collapsed: false, pinned: true },
					heatmap: { visible: true, collapsed: false, pinned: true },
					dual: { visible: true, collapsed: false, pinned: false },
					recent: { visible: true, collapsed: false, pinned: false }
				}
			};
		}

		function normalizeDockPos(pos, legacyOffset, base) {
			if (pos !== null && typeof pos === "object" && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
				return {
					x: Math.min(2000, Math.max(-2000, pos.x)),
					y: Math.min(2000, Math.max(0, pos.y))
				};
			}
			// Migrate from the legacy vertical-only dockOffset setting.
			if (Number.isFinite(legacyOffset)) {
				return { x: base.x, y: Math.min(800, Math.max(0, legacyOffset)) };
			}
			return { ...base };
		}

		function normalizeSettings(value) {
			const base = defaultSettings();
			if (value === null || typeof value !== "object") return base;
			return {
				theme: {
					accent: typeof value.theme?.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(value.theme.accent) ? value.theme.accent : base.theme.accent,
					background: typeof value.theme?.background === "string" && /^#[0-9a-fA-F]{6}$/.test(value.theme.background) ? value.theme.background : null,
					opacity: Number.isFinite(value.theme?.opacity) ? Math.min(1, Math.max(0.3, value.theme.opacity)) : base.theme.opacity
				},
				dockPos: normalizeDockPos(value.dockPos, value.dockOffset, base.dockPos),
				modelAliases: normalizeModelAliases(value.modelAliases),
				order: Array.isArray(value.order) && value.order.length > 0
				? [...new Set([
					...value.order.filter((id) => base.widgets[id] !== void 0),
					...base.order.filter((id) => !value.order.includes(id))
				])]
				: base.order,
				widgets: Object.fromEntries(Object.keys(base.widgets).map((id) => {
					const raw = value.widgets?.[id];
					return [id, {
						visible: raw?.visible !== false,
						collapsed: raw?.collapsed === true,
						pinned: raw?.pinned === true
					}];
				}))
			};
		}

		/**
		 * Sanitize the user-entered `provider/model → label` map. Empty / wrong
		 * types become an empty object; entries with non-string keys or values
		 * are dropped; whitespace-padded values are trimmed; entries whose
		 * value is empty after trimming are dropped (an empty value is the
		 * same as "no alias").
		 */
		function normalizeModelAliases(raw) {
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
			const out = {};
			for (const [key, value] of Object.entries(raw)) {
				if (typeof key !== "string" || key.length === 0) continue;
				if (typeof value !== "string") continue;
				const trimmed = value.trim();
				if (trimmed.length === 0) continue;
				out[key] = trimmed;
			}
			return out;
		}

		function loadSettings() {
			try {
				const raw = localStorage.getItem(SETTINGS_KEY);
				return raw === null ? defaultSettings() : normalizeSettings(JSON.parse(raw));
			} catch {
				return defaultSettings();
			}
		}

		function saveSettings(settings) {
			try {
				localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
			} catch {
				/* storage full or blocked — settings stay session-only */
			}
		}

		/** React hook: persisted settings + patch updater (object or updater fn). */
		function useSettings() {
			const [settings, setSettings] = react.useState(loadSettings);
			react.useEffect(() => {
				saveSettings(settings);
			}, [settings]);
			const update = react.useCallback((patch) => {
				setSettings((previous) => {
					if (typeof patch === "function") return patch(previous);
					return {
						...previous,
						...patch,
						theme: patch.theme !== void 0 ? { ...previous.theme, ...patch.theme } : previous.theme
					};
				});
			}, []);
			return [settings, update];
		}

		/** Move `id` to `beforeId`'s position (drag-reorder primitive). */
		function reorderWidget(settings, id, beforeId) {
			const order = [...settings.order];
			const from = order.indexOf(id);
			const to = order.indexOf(beforeId);
			if (from === -1 || to === -1 || from === to) return settings;
			order.splice(from, 1);
			order.splice(to, 0, id);
			return { ...settings, order };
		}

		/** Move an id inside the order array by a delta (-1 up, +1 down). */
		function moveOrder(settings, id, delta) {
			const index = settings.order.indexOf(id);
			const target = index + delta;
			if (index === -1 || target < 0 || target >= settings.order.length) return settings;
			const order = [...settings.order];
			[order[index], order[target]] = [order[target], order[index]];
			return { ...settings, order };
		}

		function toggleWidget(settings, id, key) {
			return {
				...settings,
				widgets: {
					...settings.widgets,
					[id]: { ...settings.widgets[id], [key]: !settings.widgets[id][key] }
				}
			};
		}
		//#endregion

		//#region locales
		const zh = {
			"panel.title": "用量 / 余额",
			"panel.updatedAt": "更新于 {time}",
			"action.refresh": "刷新",
			"action.usagePop": "用量",
			"action.usageListPop": "用量记录",
			"action.heatmapPop": "活跃热力图",
			"action.retry": "重试",
			"action.close": "关闭",
			"action.back": "返回",
			"action.pin": "固定到悬浮窗",
			"action.unpin": "取消固定",
			"action.hide": "隐藏此项",
			"action.collapse": "折叠",
			"action.expand": "展开",
			"action.moveUp": "上移",
			"action.moveDown": "下移",
			"action.drag": "按住拖动排序",
			"action.dockDrag": "拖动调整位置",
			"action.customize": "自定义外观",
			"action.reset": "重置",
			"theme.accent": "主色",
			"theme.background": "背景",
			"theme.opacity": "不透明度",
			"theme.follow": "跟随主题",
			"hidden.count": "已隐藏 {count} 项",
			"hidden.restore": "恢复",
			"provider.label": "供应商",
			"status.ok": "正常",
			"widget.balance": "余额",
			"widget.today": "今日用量",
			"widget.month": "本月用量",
			"widget.hit": "缓存命中",
			"widget.heatmap": "活跃热力图",
			"widget.dual": "通道比例",
			"widget.recent": "用量记录",
			"dual.dsh": "DSH 通道",
			"dual.claude": "Claude Code",
			"dual.disabled": "未检测到 Claude Code 日志（~/.claude/projects）",
			"heat.caption": "每格 {hours} 小时 · {start}–{end}",
			"heat.today": "今日活跃",
			"heat.empty": "无用量",
			"heat.unit": "tokens",
			"heat.monthLabel": "{year} 年 {month} 月",
			"heat.monthEmpty": "该月无用量记录",
			"heat.monthTotal": "总用量",
			"heat.prevMonth": "上一个月",
			"heat.nextMonth": "下一个月",
			"heat.todayShort": "今",
			"heat.weekday.0": "周日",
			"heat.weekday.1": "周一",
			"heat.weekday.2": "周二",
			"heat.weekday.3": "周三",
			"heat.weekday.4": "周四",
			"heat.weekday.5": "周五",
			"heat.weekday.6": "周六",
			"balance.available": "可用余额",
			"balance.toppedUp": "充值余额",
			"balance.granted": "赠送余额",
			"balance.used": "已用",
			"balance.limit": "总额度",
			"balance.loading": "获取余额中…",
			"balance.notConfigured": "未配置 {ref}（编辑 ~/.dsh/.credentials.yaml）",
			"balance.unsupported": "该供应商无公开余额接口",
			"balance.unauthorized": "凭据无效",
			"balance.rateLimited": "查询被限流，稍后重试",
			"balance.unavailableStatus": "上游不可用",
			"balance.timeout": "查询超时",
			"balance.invalidResponse": "上游响应异常",
			"usage.input": "输入",
			"usage.output": "输出",
			"usage.cacheRead": "缓存读",
			"usage.cacheWrite": "缓存写",
			"usage.loading": "统计聚合中…",
			"usage.noData": "窗口内暂无用量数据",
			"usage.noModels": "当日无按模型数据",
			"usage.todayHit": "今日缓存命中率",
			"usage.totalHit": "累计缓存命中率",
			"detail.overview": "总览",
			"detail.models": "模型",
			"usage.model": "模型",
			"usage.total": "合计",
			"usage.hit": "命中",
			"usage.share": "占比",
			"usage.legend.all": "全部显示",
			"usage.legend.showAll": "显示全部曲线",
			"usage.legend.hideAll": "隐藏全部曲线",
			"alias.title": "模型展示名",
			"alias.hint": "只改显示，不动历史聚合数据；曲线图、tooltip、图例、用量明细会立刻更新。",
			"alias.empty": "暂无模型，等待用量数据同步后可在此改名。",
			"alias.resetOne": "重置",
			"alias.resetAll": "重置全部"
		};
		const en = {
			"panel.title": "Usage / Balance",
			"panel.updatedAt": "Updated at {time}",
			"action.refresh": "Refresh",
			"action.usagePop": "Usage",
			"action.usageListPop": "Usage log",
			"action.heatmapPop": "Activity heatmap",
			"action.retry": "Retry",
			"action.close": "Close",
			"action.back": "Back",
			"action.pin": "Pin to dock",
			"action.unpin": "Unpin",
			"action.hide": "Hide",
			"action.collapse": "Collapse",
			"action.expand": "Expand",
			"action.moveUp": "Move up",
			"action.moveDown": "Move down",
			"action.drag": "Drag to reorder",
			"action.dockDrag": "Drag to reposition",
			"action.customize": "Customize",
			"action.reset": "Reset",
			"theme.accent": "Accent",
			"theme.background": "Background",
			"theme.opacity": "Opacity",
			"theme.follow": "Follow theme",
			"hidden.count": "{count} hidden",
			"hidden.restore": "Restore",
			"provider.label": "Provider",
			"status.ok": "OK",
			"widget.balance": "Balance",
			"widget.today": "Today",
			"widget.month": "This month",
			"widget.hit": "Cache hit",
			"widget.heatmap": "Activity",
			"widget.dual": "Channel share",
			"widget.recent": "Usage log",
			"dual.dsh": "DSH channel",
			"dual.claude": "Claude Code",
			"dual.disabled": "No Claude Code logs found (~/.claude/projects)",
			"heat.caption": "{hours}h cells · {start}–{end}",
			"heat.today": "Today's activity",
			"heat.empty": "No usage",
			"heat.unit": "tokens",
			"heat.monthLabel": "{year}-{month}",
			"heat.monthEmpty": "No usage recorded this month",
			"heat.monthTotal": "Total",
			"heat.prevMonth": "Previous month",
			"heat.nextMonth": "Next month",
			"heat.todayShort": "Now",
			"heat.weekday.0": "Sun",
			"heat.weekday.1": "Mon",
			"heat.weekday.2": "Tue",
			"heat.weekday.3": "Wed",
			"heat.weekday.4": "Thu",
			"heat.weekday.5": "Fri",
			"heat.weekday.6": "Sat",
			"balance.available": "Available balance",
			"balance.toppedUp": "Topped up",
			"balance.granted": "Granted",
			"balance.used": "Used",
			"balance.limit": "Total credits",
			"balance.loading": "Fetching balance…",
			"balance.notConfigured": "{ref} is not configured (edit ~/.dsh/.credentials.yaml)",
			"balance.unsupported": "This provider has no public balance interface.",
			"balance.unauthorized": "The credential is invalid.",
			"balance.rateLimited": "Rate limited; retry later.",
			"balance.unavailableStatus": "Upstream unavailable.",
			"balance.timeout": "The balance query timed out.",
			"balance.invalidResponse": "Unexpected upstream response.",
			"usage.input": "Input",
			"usage.output": "Output",
			"usage.cacheRead": "Cache read",
			"usage.cacheWrite": "Cache write",
			"usage.loading": "Aggregating usage…",
			"usage.noData": "No usage inside the window.",
			"usage.noModels": "No per-model data for this day.",
			"usage.todayHit": "Today's cache hit rate",
			"usage.totalHit": "All-time cache hit rate",
			"detail.overview": "Overview",
			"detail.models": "Models",
			"usage.model": "Model",
			"usage.total": "Total",
			"usage.hit": "Hit",
			"usage.share": "Share",
			"usage.legend.all": "Show all",
			"usage.legend.showAll": "Show all curves",
			"usage.legend.hideAll": "Hide all curves",
			"alias.title": "Model display names",
			"alias.hint": "Display only — historical aggregation is untouched. The chart, tooltip, legend, and breakdown update instantly.",
			"alias.empty": "No models yet. Rename entries appear here once usage data arrives.",
			"alias.resetOne": "Reset",
			"alias.resetAll": "Reset all"
		};
		//#endregion

		//#region small components
		function PinIcon(props) {
			return react_jsx_runtime.jsx("svg", {
				viewBox: "0 0 16 16",
				width: props.size ?? 12,
				height: props.size ?? 12,
				fill: "currentColor",
				"aria-hidden": true,
				children: react_jsx_runtime.jsx("path", { d: "M9.5 1.5 14.5 6.5 12 9l-1 5-3-3-3.5 3.5-1-1L7 10 4 7l5-1 2.5-2.5z" })
			});
		}

		/** Apple-style grabber: three horizontal lines (drag handle affordance). */
		function GripIcon(props) {
			return react_jsx_runtime.jsx("svg", {
				viewBox: "0 0 16 16",
				width: props.size ?? 12,
				height: props.size ?? 12,
				fill: "currentColor",
				"aria-hidden": true,
				children: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
					children: [
						react_jsx_runtime.jsx("rect", { x: 3, y: 3, width: 10, height: 2, rx: 1 }),
						react_jsx_runtime.jsx("rect", { x: 3, y: 7, width: 10, height: 2, rx: 1 }),
						react_jsx_runtime.jsx("rect", { x: 3, y: 11, width: 10, height: 2, rx: 1 })
					]
				})
			});
		}

		/** Walk up from the dock node to the sidebar shell (class/tag heuristics). */
		function findSidebar(node) {
			let cursor = node?.parentElement ?? null;
			while (cursor !== null && cursor !== document.body && cursor !== document.documentElement) {
				const cls = cursor.className;
				if (typeof cls === "string" && (cls.includes("SidebarRoot") || cls.includes("sidebar"))) return cursor;
				if (cursor.tagName === "ASIDE" || cursor.tagName === "NAV") return cursor;
				cursor = cursor.parentElement;
			}
			return null;
		}

		/** Locate a short standalone label (e.g. "对话"/"设置") inside the sidebar. */
		function findTitleRect(sidebar, labels) {
			if (sidebar === null || sidebar === void 0) return null;
			for (const el of sidebar.querySelectorAll("h1,h2,h3,h4,button,span,div")) {
				const text = (el.textContent ?? "").trim();
				if (text.length === 0 || text.length > 12 || !labels.includes(text)) continue;
				const rect = el.getBoundingClientRect();
				if (rect.height > 0 && rect.width > 0) return rect;
			}
			return null;
		}

		function ProviderPicker({ providers, selected, onSelect, translate }) {
			if (providers.length === 0) return null;
			return react_jsx_runtime.jsxs("label", {
				className: "u_providerPicker",
				children: [
					react_jsx_runtime.jsx("span", { className: "u_providerPickerLabel", children: translate("provider.label") }),
					react_jsx_runtime.jsxs("select", {
						className: "u_providerSelect",
						value: selected ?? "",
						onChange: (event) => onSelect(event.target.value),
						children: providers.map((provider) => react_jsx_runtime.jsx("option", { value: provider.id, children: provider.displayName }, provider.id))
					})
				]
			});
		}

		function BalanceDetail({ account, translate, onRetry }) {
			if (account === null || account === void 0 || account.status === "pending") {
				return react_jsx_runtime.jsx("p", { className: "u_note", children: translate("balance.loading") });
			}
			if (account.mode === "unsupported" || account.scheme === null) {
				return react_jsx_runtime.jsx("p", { className: "u_note", children: translate("balance.unsupported") });
			}
			if (account.status === "not-configured") {
				return react_jsx_runtime.jsx("p", { className: "u_note", children: translate("balance.notConfigured", { ref: account.missingCredentials?.[0] ?? "" }) });
			}
			if (account.status !== "ok" || account.balance === null || account.balance === void 0) {
				return react_jsx_runtime.jsxs("div", {
					className: "u_error",
					children: [
						react_jsx_runtime.jsx("span", { children: translate("balance.invalidResponse") }),
						react_jsx_runtime.jsx("button", { type: "button", className: "u_retry", onClick: onRetry, children: translate("action.retry") })
					]
				});
			}
			const balance = account.balance;
			const rows = [
				{ label: translate("balance.available"), value: balance.total },
				{ label: translate("balance.toppedUp"), value: balance.toppedUp },
				{ label: translate("balance.granted"), value: balance.granted }
			].filter((row) => row.value !== null && row.value !== void 0);
			const positive = balance.isAvailable !== false;
			return react_jsx_runtime.jsxs("div", {
				className: "u_balanceGrid",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_balanceLeft",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_balanceAmount", children: fmtCurrency(balance.total, balance.currency) }),
							react_jsx_runtime.jsx("span", {
								className: positive ? "u_balanceStatus u_balanceOk" : "u_balanceStatus u_balanceBad",
								children: translate(positive ? "status.ok" : "balance.unavailableStatus")
							})
						]
					}),
					react_jsx_runtime.jsx("div", {
						className: "u_balanceTable",
						children: rows.flatMap((row) => [
							react_jsx_runtime.jsx("span", { className: "u_balanceTableLabel", children: row.label }, `l-${row.label}`),
							react_jsx_runtime.jsx("span", { className: "u_balanceTableValue", children: fmtCurrency(row.value, balance.currency) }, `v-${row.label}`)
						])
					})
				]
			});
		}

		function TokenBreakdown({ buckets, translate }) {
			const items = [
				[translate("usage.input"), buckets.inputTokens ?? 0],
				[translate("usage.output"), buckets.outputTokens ?? 0],
				[translate("usage.cacheRead"), buckets.cacheReadTokens ?? 0]
			];
			return react_jsx_runtime.jsx("div", {
				className: "u_statBreak",
				children: items.map(([label, value]) => react_jsx_runtime.jsxs("span", {
					className: "u_statBreakItem",
					children: [label, " ", react_jsx_runtime.jsx("b", { children: fmtCompact(value) })]
				}, label))
			});
		}

		/**
		 * Per-model hourly usage curve (hand-drawn SVG, no chart library).
		 * Today → hours 0..now; past days → full 0..23. Each model gets a
		 * distinct color; legend/tooltip use configured provider display names.
		 * Hover: pointing at a curve focuses it in the tooltip (other curves
		 * step back); pointing at empty plot space lists every model with
		 * usage at that hour, largest first. Zero-usage models never list.
		 * Legend items are clickable buttons: clicking hides / re-shows that
		 * model's curve. State is local to the chart — the day-detail view
		 * owns it, so reopening a day starts fresh.
		 */
		function ModelUsageChart({ models, providers, aliases, day, translate }) {
			const isToday = day === todayKey();
			const endHour = isToday ? Math.max(0, new Date().getHours()) : 23;
			const hours = [];
			for (let h = 0; h <= endHour; h += 1) hours.push(h);
			const series = models.map((model, index) => ({
				key: String(model.model ?? ""),
				name: displayModelName(model.model, providers, aliases),
				provider: providerNameOf(model.model, providers),
				color: MODEL_COLORS[index % MODEL_COLORS.length],
				slots: Array.isArray(model.hours) && model.hours.length === 24 ? model.hours : new Array(24).fill(0),
				tokens: model.tokens ?? 0,
				hit: model.cacheHitRate
			}));
			if (series.length === 0) {
				return react_jsx_runtime.jsx("p", { className: "u_note", children: translate("usage.noModels") });
			}
			// Models that never move off the axis add lines, legend rows and hover
			// targets without carrying information — drop them from the chart
			// (colors stay index-stable because they are assigned above). The
			// check spans the model's own slots rather than the viz time window,
			// so a model whose activity falls after the current hour on "today"
			// is still kept (its curve just runs at 0 until then).
			const visible = series.filter((s) => s.slots.some((v) => (Number(v) || 0) > 0));
			if (visible.length === 0) {
				return react_jsx_runtime.jsx("p", { className: "u_note", children: translate("usage.noData") });
			}
			// Per-model visibility is local state: toggled by clicking the legend.
			// We store the *hidden* set so the initial state is "everything shown"
			// and a fresh mount always restores the default view. The set is keyed
			// on `s.key` (the raw `provider/model` string) so renames in the
			// provider registry don't silently unhide curves.
			const [hiddenKeys, setHiddenKeys] = react.useState(() => new Set());
			// If the visible set changes (e.g. the day switched), drop any keys
			// that no longer correspond to a model so the set never carries
			// stale entries across day transitions.
			react.useEffect(() => {
				setHiddenKeys((previous) => {
					if (previous.size === 0) return previous;
					const valid = new Set(visible.map((s) => s.key));
					let changed = false;
					for (const key of previous) {
						if (!valid.has(key)) { changed = true; break; }
					}
					if (!changed) return previous;
					const next = new Set();
					for (const key of previous) if (valid.has(key)) next.add(key);
					return next;
				});
			}, [visible]);
			const toggleKey = (key) => {
				setHiddenKeys((previous) => {
					const next = new Set(previous);
					if (next.has(key)) next.delete(key);
					else next.add(key);
					return next;
				});
			};
			// "Show all" toggle state. `on` = every visible curve shown,
			// `off` = every visible curve hidden, `mixed` = some hidden.
			// Click cycles through `off → on → off` so the user can dismiss
			// every curve with one click and bring them all back with another.
			const visibleKeys = visible.map((s) => s.key);
			const hiddenCount = visibleKeys.reduce((sum, key) => sum + (hiddenKeys.has(key) ? 1 : 0), 0);
			const allState = hiddenCount === 0 ? "on" : hiddenCount === visibleKeys.length ? "off" : "mixed";
			const toggleAll = () => {
				setHiddenKeys((previous) => {
					// Mixed / off → clear (show everything). On → hide everything.
					if (hiddenCount === 0) return new Set(visibleKeys);
					return new Set();
				});
			};
			// Charts-only set: visible curves minus hidden ones. Empty means
			// "user hid every curve" — keep the empty case visible (the legend
			// is still informative), but the curve/dots render nothing.
			const plotted = visible.filter((s) => !hiddenKeys.has(s.key));
			// Legend groups by provider; within each group sort by usage desc.
			// Sort applies to the full `visible` set so a hidden heavy hitter
			// still anchors its provider group's top row.
			const legendGroups = [];
			for (const s of visible) {
				const group = legendGroups.find((g) => g.name === s.provider);
				if (group === void 0) {
					legendGroups.push({ name: s.provider, items: [s] });
				} else {
					group.items.push(s);
				}
			}
			for (const group of legendGroups) {
				group.items.sort((a, b) => b.tokens - a.tokens);
			}
			legendGroups.sort((a, b) => (b.items[0]?.tokens ?? 0) - (a.items[0]?.tokens ?? 0));
			// Max is computed off the *plotted* curves so the scale tightens
			// when a peak is hidden — a single heavy hitter on the chart then
			// fills the frame instead of sitting at the top of an empty band.
			const maxTokens = Math.max(1, ...(plotted.length > 0 ? plotted : visible).flatMap((s) => hours.map((h) => Number(s.slots[h]) || 0)));
			// padL bumped to 32 so the y-tick column never collides with the
			// leftmost data point; padR stays small because the right side is
			// just the chart's tail end. The viewBox tracks the CSS height
			// so internal coordinates match the rendered pixels (the dot marks
			// use the same `yOf` math, so a near-1:1 ratio keeps them on the
			// curves instead of drifting).
			const W = 320, H = 148, padL = 32, padR = 6, padT = 16, padB = 10;
			const plotW = W - padL - padR;
			const plotH = H - padT - padB;
			const xOf = (h) => (endHour === 0 ? padL + plotW / 2 : padL + (h / endHour) * plotW);
			const yOf = (v) => padT + plotH - (v / maxTokens) * plotH;
			// hover = { h: snapped hour, key: model key when the pointer sits on a curve }
			const [hover, setHover] = react.useState(null);
			const HIT_SLOP = 12; // px of pointer slop when picking the curve under the cursor
			const onMove = (event) => {
				const rect = event.currentTarget.getBoundingClientRect();
				if (!rect.width || !rect.height) return;
				const pxCss = event.clientX - rect.left;
				const pyCss = event.clientY - rect.top;
				const vx = (pxCss / rect.width) * W;
				const frac = endHour === 0 ? 0 : (vx - padL) / plotW;
				const idx = Math.max(0, Math.min(endHour, Math.round(frac * endHour)));
				// curve picking: vertical distance from the pointer to each line
				// segment at the pointer's x — the closest curve inside the slop wins
				const h0 = endHour === 0 ? 0 : Math.max(0, Math.min(endHour - 1, Math.floor(frac * endHour)));
				const h1 = endHour === 0 ? h0 : Math.min(endHour, h0 + 1);
				const x0Css = (xOf(h0) / W) * rect.width;
				const x1Css = (xOf(h1) / W) * rect.width;
				const t = x1Css > x0Css ? Math.max(0, Math.min(1, (pxCss - x0Css) / (x1Css - x0Css))) : 0;
				let key = null;
				let best = Infinity;
				// Only test curves that are still plotted — hidden curves stay
				// invisible in the chart and the tooltip alike.
				for (const s of plotted) {
					const y0 = yOf(Number(s.slots[h0]) || 0);
					const y1 = yOf(Number(s.slots[h1]) || 0);
					const dist = Math.abs(pyCss - (y0 + t * (y1 - y0)) * (rect.height / H)) + (endHour === 0 ? Math.abs(pxCss - x0Css) : 0);
					if (dist < best) {
						best = dist;
						key = dist <= HIT_SLOP ? s.key : null;
					}
				}
				setHover({ h: idx, key, x: event.clientX, y: event.clientY });
			};
			// two dashed reference lines only (half and peak); the 0 line is the axis
			const gridValues = [0.5, 1].map((f) => maxTokens * f);
			const gridLines = gridValues.map((v) => react_jsx_runtime.jsx("line", {
				className: "u_chartGrid",
				x1: padL, y1: yOf(v), x2: W - padR, y2: yOf(v)
			}, `g-${v}`));
			// y-axis tick labels: 0 (bottom), 50% (middle), 100% (top). Each
			// tick is positioned absolutely with the same yOf() math the
			// grid lines use, so labels stay aligned with their reference
			// line. The values are raw token counts (no "/h" suffix): the
			// x-axis already anchors each point to a specific hour, so the
			// implied "per hour" lives in the time axis, not the y labels.
			const yTickValues = [0, maxTokens * 0.5, maxTokens];
			const yTicks = yTickValues.map((v) => react_jsx_runtime.jsx("span", {
				className: "u_chartYTick",
				style: { position: "absolute", left: 0, width: "26px", top: `${(yOf(v) / H) * 100}%`, transform: "translateY(-50%)" },
				children: fmtCompact(v)
			}, `yt-${v}`));
			// while a curve is focused the other curves step back so the
			// pointed-at line stays unambiguous; the filled area is reserved for
			// the focused curve, so the default view is plain lines
			const targetKey = hover === null ? null : hover.key;
			// Hidden curves are filtered out of the SVG entirely; the legend
			// (rendered later) still lists them so the user can re-enable them.
			const modelShapes = plotted.flatMap((s) => {
				const points = hours.map((h) => `${xOf(h).toFixed(2)},${yOf(Number(s.slots[h]) || 0).toFixed(2)}`).join(" ");
				const off = targetKey !== null && s.key !== targetKey;
				const focused = s.key === targetKey;
				const shapes = [];
				if (focused) {
					// Gradient fill from the curve down to the axis: stronger at
					// the top, fading to nothing at the baseline. The id encodes
					// the color so defs can be reused per model.
					const gradId = `u_chartArea-${s.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
					shapes.push(react_jsx_runtime.jsx("defs", {
						children: react_jsx_runtime.jsxs("linearGradient", {
							id: gradId,
							x1: "0", y1: "0", x2: "0", y2: "1",
							children: [
								react_jsx_runtime.jsx("stop", { offset: "0%", stopColor: s.color, stopOpacity: "0.42" }),
								react_jsx_runtime.jsx("stop", { offset: "100%", stopColor: s.color, stopOpacity: "0" })
							]
						})
					}, `defs-${s.key}`));
					const area = `${points} ${xOf(endHour).toFixed(2)},${yOf(0).toFixed(2)} ${xOf(0).toFixed(2)},${yOf(0).toFixed(2)}`;
					shapes.push(react_jsx_runtime.jsx("polygon", { className: "u_chartArea", points: area, fill: `url(#${gradId})` }, `a-${s.key}`));
				}
				shapes.push(react_jsx_runtime.jsx("polyline", { className: "u_chartLine", points, stroke: s.color, fill: "none", style: off ? { opacity: 0.18 } : focused ? { strokeWidth: "2.2" } : void 0 }, `l-${s.key}`));
				return shapes;
			});
			const cursor = hover !== null && react_jsx_runtime.jsx("line", {
				className: "u_chartCursor",
				x1: xOf(hover.h), y1: padT, x2: xOf(hover.h), y2: padT + plotH
			}, "cursor");
			// at most ~5 hour ticks; the first aligns to the plot's left edge and
			// the last to its right edge so wide labels never spill or collide
			const tickStep = Math.max(1, Math.ceil((endHour + 1) / 4));
			const tickHours = [];
			for (let h = 0; h <= endHour; h += 1) {
				if (h % tickStep === 0) tickHours.push(h);
			}
			if (tickHours[tickHours.length - 1] !== endHour) tickHours.push(endHour);
			const tickTransform = (h) => (endHour === 0 ? "translateX(-50%)" : h === 0 ? "translateX(0)" : h === endHour ? "translateX(-100%)" : "translateX(-50%)");
			// tooltip rows: the focused curve only, or every plotted curve with
			// usage at the hovered hour (largest first). Hidden curves never
			// appear here — the totals reflect what the chart is actually drawing.
			const targetSeries = hover !== null && hover.key !== null ? plotted.find((s) => s.key === hover.key) ?? null : null;
			const tipRows = hover === null ? [] : targetSeries !== null
				? (Number(targetSeries.slots[hover.h]) || 0) > 0 ? [targetSeries] : []
				: plotted
					.map((s) => ({ s, v: Number(s.slots[hover.h]) || 0 }))
					.filter((r) => r.v > 0)
					.sort((a, b) => b.v - a.v)
					.map((r) => r.s);
			const tipTotal = hover === null ? 0 : plotted.reduce((sum, s) => sum + (Number(s.slots[hover.h]) || 0), 0);
			// Tooltip floats beside the pointer, fixed to the viewport, sitting to
			// its right; it flips left/up when it would clip the window edge. The
			// box is measured after render so long model names flip accurately.
			const tipRef = react.useRef(null);
			const [tipBox, setTipBox] = react.useState(null);
			const TIP_GAP = 14;
			react.useEffect(() => {
				if (hover === null) { setTipBox(null); return; }
				const el = tipRef.current;
				if (!el) return;
				const vw = window.innerWidth, vh = window.innerHeight;
				const bw = el.offsetWidth, bh = el.offsetHeight;
				let left = hover.x + TIP_GAP;
				let top = hover.y + TIP_GAP;
				if (left + bw > vw - 6) left = hover.x - bw - TIP_GAP;
				if (top + bh > vh - 6) top = hover.y - bh - TIP_GAP;
				left = Math.max(6, left);
				top = Math.max(6, top);
				// only update when the box actually moves, so hovering the same
				// spot (or an unrelated rerender) never retriggers a cycle
				setTipBox((prev) => (prev && prev.left === left && prev.top === top) ? prev : { left, top });
			}, [hover]);
			const tip = hover !== null && react_jsx_runtime.jsxs("div", {
				ref: tipRef,
				className: "u_chartTip",
				style: { left: `${(tipBox ? tipBox.left : hover.x + TIP_GAP)}px`, top: `${(tipBox ? tipBox.top : hover.y + TIP_GAP)}px` },
				children: [
					// Head row: hour pin on the left, hour total on the right.
					// Separated from the per-model rows by a hairline so the
					// cursor's hour reads as the headline.
					react_jsx_runtime.jsxs("div", {
						className: "u_chartTipHead",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_chartTipHour", children: `${String(hover.h).padStart(2, "0")}:00` }),
							react_jsx_runtime.jsx("span", { className: "u_chartTipSum", children: `${fmtCompact(tipTotal)} ${translate("heat.unit")}` })
						]
					}),
					...tipRows.map((s) => react_jsx_runtime.jsxs("div", {
						className: "u_chartTipRow",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_chartTipDot", style: { background: s.color } }),
							react_jsx_runtime.jsx("span", { className: "u_chartTipName", title: s.name, children: s.name }),
							react_jsx_runtime.jsx("span", { className: "u_chartTipVal", children: fmtCompact(Number(s.slots[hover.h]) || 0) })
						]
					}, s.key))
				]
			});
			// hovered-hour markers: one dot per tooltip row, so the numbers in the
			// tooltip map onto the curves without counting lines
			const hoverDots = hover === null ? [] : tipRows.map((s) => react_jsx_runtime.jsx("span", {
				className: "u_chartDotMark",
				style: {
					left: `${(xOf(hover.h) / W) * 100}%`,
					top: `${(yOf(Number(s.slots[hover.h]) || 0) / H) * 100}%`,
					background: s.color
				}
			}, `d-${s.key}`));
			return react_jsx_runtime.jsxs("div", {
				className: "u_chartWrap",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_chartBody",
						children: [
							react_jsx_runtime.jsxs("div", {
								className: "u_chartPlot",
								children: [
									react_jsx_runtime.jsx("svg", {
										className: "u_chartSvg",
										viewBox: `0 0 ${W} ${H}`,
										preserveAspectRatio: "none",
										onMouseMove: onMove,
										onMouseLeave: () => setHover(null),
										children: [react_jsx_runtime.jsx("line", { className: "u_chartAxis", x1: padL, y1: yOf(0), x2: W - padR, y2: yOf(0) }, "axis"), ...gridLines, ...modelShapes, cursor]
									}),
									// y-axis tick labels: 0 / mid / peak, in HTML so the
									// digits never get stretched by the svg's
									// preserveAspectRatio:none scaling. The top label
									// also carries the unit so the column stays tidy.
									...yTicks,
									// the peak label sits at the top-right of the plot
									// so it does not crowd the y-tick column; the
									// translucent background keeps it readable when a
									// curve grazes the very top of the frame.
									react_jsx_runtime.jsx("span", { className: "u_chartMax", children: fmtCompact(maxTokens) }),
									...hoverDots
								]
							}),
							react_jsx_runtime.jsx("div", {
								className: "u_chartTicks",
								children: tickHours.map((h) => react_jsx_runtime.jsx("span", {
									className: "u_chartTick",
									style: { left: `${(xOf(h) / W) * 100}%`, transform: tickTransform(h) },
									children: `${h}:00`
								}, `t-${h}`))
							}),
							tip
						]
					}),
					react_jsx_runtime.jsx("div", {
						className: "u_chartLegend",
						children: [
							// "Show all" sits at the top-right of the legend block
							// and acts as a single-click master switch. `data-state`
							// (on / off / mixed) drives the visual: a filled square
							// when everything is shown, an empty square when nothing
							// is, a half dash for the partial case. The control is
							// always present so the user can re-show curves after a
							// mass-hide without hunting for individual legend rows.
							react_jsx_runtime.jsxs("button", {
								type: "button",
								className: "u_chartLegendAll",
								"data-state": allState,
								"data-all-toggle": "",
								"aria-pressed": allState !== "off",
								title: allState === "on" ? translate("usage.legend.hideAll") : translate("usage.legend.showAll"),
								onClick: toggleAll,
								children: [
									react_jsx_runtime.jsxs("span", { className: "u_chartLegendAllBox", "aria-hidden": true, children: [
										react_jsx_runtime.jsx("span", { className: "u_chartLegendAllMark" })
									] }),
									react_jsx_runtime.jsx("span", { children: translate("usage.legend.all") })
								]
							}, "all"),
							legendGroups.map((group) => react_jsx_runtime.jsxs("div", {
								className: "u_chartLegendGroup",
								children: [
								// a single provider needs no group heading
								legendGroups.length > 1 && react_jsx_runtime.jsx("span", { className: "u_chartLegendGroupName", children: group.name }, "name"),
									react_jsx_runtime.jsx("div", {
										className: "u_chartLegendGroupItems",
										// every legend item is a real button: clicking toggles
										// the curve, `data-hidden` dims + strikes through the
										// label so the off state is unmistakable
										children: group.items.map((s) => {
											const hidden = hiddenKeys.has(s.key);
											return react_jsx_runtime.jsxs("button", {
												type: "button",
												className: "u_chartLegendItem",
												"data-hidden": hidden || void 0,
												"data-model-key": s.key,
												"aria-pressed": !hidden,
												title: `${s.name} · ${fmtCompact(s.tokens)} tok · ${fmtHit(s.hit)} · 点击${hidden ? "显示" : "隐藏"}曲线`,
												onClick: () => toggleKey(s.key),
												children: [
													react_jsx_runtime.jsx("span", { className: "u_chartLegendDot", style: { background: s.color } }),
													react_jsx_runtime.jsx("span", { className: "u_chartLegendName", children: s.name }),
													react_jsx_runtime.jsx("span", { className: "u_chartLegendTokens", children: fmtCompact(s.tokens) })
												]
											}, s.key);
										})
									}, "items")
								]
							}, group.name))
						]
					})
				]
			});
		}

		/**
		 * Display-only rename editor for per-model labels: lets the user change
		 * the `provider/model` strings used in the chart / tooltip / breakdown
		 * without touching historical aggregation. Driven entirely from
		 * `usage.days[].models[].model` so an unknown provider can also be
		 * renamed; the `modelAliases` map lives in `settings` and is persisted
		 * to localStorage by the existing settings saver.
		 */
		function ModelAliasEditor({ usage, providers, aliases, onChange, translate }) {
			// Stable, de-duped list of every raw `provider/model` key the
			// server has reported so far (preserving first-seen order so the
			// editor doesn't reshuffle on each refresh).
			const keys = react.useMemo(() => {
				const seen = new Set();
				const out = [];
				const days = usage && Array.isArray(usage.days) ? usage.days : [];
				for (const day of days) {
					const models = Array.isArray(day?.models) ? day.models : [];
					for (const model of models) {
						const key = typeof model?.model === "string" ? model.model : "";
						if (key.length === 0 || seen.has(key)) continue;
						seen.add(key);
						out.push(key);
					}
				}
				return out;
			}, [usage]);
			const defaultLabelOf = (key) => displayModelName(key, providers, {});
			const setOne = (key, value) => {
				const trimmed = typeof value === "string" ? value.trim() : "";
				const next = { ...aliases };
				if (trimmed.length === 0) delete next[key];
				else next[key] = trimmed;
				onChange(next);
			};
			const resetAll = () => onChange({});
			const rows = keys.length === 0
				? react_jsx_runtime.jsx("p", { className: "u_aliasEmpty", children: translate("alias.empty") })
				: keys.map((key) => {
					const value = typeof aliases[key] === "string" ? aliases[key] : defaultLabelOf(key);
					const isCustom = typeof aliases[key] === "string";
					return react_jsx_runtime.jsxs("div", {
						className: "u_aliasRow",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_aliasKey", title: key, children: key }),
							react_jsx_runtime.jsx("span", { className: "u_aliasArrow", children: "→" }),
							react_jsx_runtime.jsx("input", {
								className: "u_aliasInput",
								type: "text",
								value,
								placeholder: defaultLabelOf(key),
								"aria-label": key,
								onChange: (event) => setOne(key, event.target.value)
							}),
							isCustom && react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_aliasResetOne",
								title: translate("alias.resetOne"),
								onClick: () => setOne(key, ""),
								children: translate("alias.resetOne")
							}, `reset-${key}`)
						]
					}, `alias-${key}`);
				});
			return react_jsx_runtime.jsxs("div", {
				className: "u_aliasBox",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_aliasHeader",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_aliasTitle", children: translate("alias.title") }),
							keys.length > 0 && Object.keys(aliases).length > 0 && react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_reset",
								onClick: resetAll,
								children: translate("alias.resetAll")
							})
						]
					}),
					react_jsx_runtime.jsx("p", { className: "u_aliasHint", children: translate("alias.hint") }),
					react_jsx_runtime.jsx("div", { className: "u_aliasList", children: rows })
				]
			});
		}

		function DayDetail({ day, onBack, translate, providers, aliases }) {
			const models = Array.isArray(day?.models) ? day.models : [];
			const maxTokens = models.reduce((max, model) => Math.max(max, model.tokens ?? 0), 0);
			const [view, setView] = react.useState("overview");
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_detailHeader",
						children: [
							react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_back",
								"aria-label": translate("action.back"),
								onClick: onBack,
								children: react_jsx_runtime.jsx(primitives.IconChevronLeftOutline14, { size: 14 })
							}),
							react_jsx_runtime.jsx("span", { className: "u_detailDate", children: day.date }),
							react_jsx_runtime.jsx("span", { className: "u_detailHit", children: `${translate("widget.hit")} ${fmtHit(day.cacheHitRate)}` })
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_detailTabs",
						role: "tablist",
						children: [
							react_jsx_runtime.jsx("button", {
								type: "button",
								role: "tab",
								className: "u_detailTab",
								"data-active": view === "overview" || void 0,
								"aria-selected": view === "overview",
								onClick: () => setView("overview"),
								children: translate("detail.overview")
							}),
							react_jsx_runtime.jsx("button", {
								type: "button",
								role: "tab",
								className: "u_detailTab",
								"data-active": view === "models" || void 0,
								"aria-selected": view === "models",
								onClick: () => setView("models"),
								children: translate("detail.models")
							})
						]
					}),
					view === "models"
						? react_jsx_runtime.jsx(ModelUsageChart, { models, providers, aliases, day: day.date, translate })
						: models.length === 0
							? react_jsx_runtime.jsx("p", { className: "u_note", children: translate("usage.noModels") })
							: models.map((model) => {
								const share = maxTokens > 0 ? Math.max((model.tokens ?? 0) / maxTokens * 100, 2) : 0;
								const label = displayModelName(model.model, providers, aliases);
								return react_jsx_runtime.jsxs("div", {
									className: "u_modelRow",
									children: [
										react_jsx_runtime.jsxs("div", {
											className: "u_modelMeta",
											children: [
												react_jsx_runtime.jsx("span", { className: "u_modelName", title: model.model, children: label }),
												react_jsx_runtime.jsx("span", { className: "u_modelTokens", children: fmtCompact(model.tokens ?? 0) }),
												react_jsx_runtime.jsx("span", { className: "u_modelHit", children: fmtHit(model.cacheHitRate) })
											]
										}),
										react_jsx_runtime.jsx("div", {
											className: "u_modelBarTrack",
											children: react_jsx_runtime.jsx("div", { className: "u_modelBar", style: { width: `${share}%` } })
										})
									]
								}, model.model);
							})
				]
			});
		}
		//#endregion

		//#region main component
		/**
		 * Sidebar footer action: floating dock + customizable detail panel.
		 * @param props - `wide` from the sidebar shell, `t` bound by the slot runtime.
		 */
		function UsagePanel({ wide, t }) {
			const translate = (key, params) => interpolate(t !== void 0 ? t(key) : key, params);
			const [settings, updateSettings] = useSettings();
			const [open, setOpen] = react.useState(false);
			const [dockOpen, setDockOpen] = react.useState(false);
			const [panelAnchor, setPanelAnchor] = react.useState(null);
			const [showCustomizer, setShowCustomizer] = react.useState(false);
			const [usagePopOpen, setUsagePopOpen] = react.useState(false);
			const [heatmapPopOpen, setHeatmapPopOpen] = react.useState(false);
			const [providers, setProviders] = react.useState([]);
			const [selectedProvider, setSelectedProvider] = react.useState(null);
			const [account, setAccount] = react.useState(null);
			const [accountLoading, setAccountLoading] = react.useState(false);
			const [accountError, setAccountError] = react.useState(null);
			const [usage, setUsage] = react.useState(null);
			const [usageError, setUsageError] = react.useState(null);
			const [selectedDay, setSelectedDay] = react.useState(null);
			const [refreshedAt, setRefreshedAt] = react.useState(null);
			// Heatmap month paging: 0 = the current month, −1 = last month… Reset
			// to "this month" whenever the heatmap popup closes.
			const [heatMonthOffset, setHeatMonthOffset] = react.useState(0);
			const mountedRef = react.useRef(true);
			const usageLoaderRef = react.useRef(null);
			const accountLoaderRef = react.useRef(null);
			if (usageLoaderRef.current === null) usageLoaderRef.current = createLoader();
			if (accountLoaderRef.current === null) accountLoaderRef.current = createLoader();

			const loadProviders = react.useCallback(() => {
				fetchJson("/api/usage/providers").then((payload) => {
					if (!mountedRef.current) return;
					const list = payload?.ok === true && Array.isArray(payload.providers) ? payload.providers : [];
					setProviders(list);
					setSelectedProvider((previous) => previous ?? defaultProviderId(list));
				}).catch(() => { /* keep the previous list */ });
			}, []);

			const loadAccount = react.useCallback((providerId, force) => {
				if (providerId === null || providerId === void 0 || providerId === "") return;
				const seq = accountLoaderRef.current.start();
				setAccountLoading(true);
				setAccountError(null);
				fetchJson(`/api/usage/balance?provider=${encodeURIComponent(providerId)}${force ? "&refresh=1" : ""}`).then((payload) => {
					if (!mountedRef.current || !accountLoaderRef.current.isCurrent(seq)) return;
					setAccountLoading(false);
					if (payload?.ok !== true) {
						setAccount(null);
						setAccountError(payload?.message ?? "balance failed");
						return;
					}
					setAccount(payload.account ?? null);
				}).catch((error) => {
					if (!mountedRef.current || !accountLoaderRef.current.isCurrent(seq)) return;
					setAccountLoading(false);
					setAccountError(error instanceof Error ? error.message : String(error));
				});
			}, []);

			const loadUsage = react.useCallback(() => {
				const seq = usageLoaderRef.current.start();
				setUsageError(null);
				fetchJson("/api/usage/usage").then((payload) => {
					if (!mountedRef.current || !usageLoaderRef.current.isCurrent(seq)) return;
					if (payload?.ok !== true) {
						setUsageError(payload?.message ?? "usage failed");
						return;
					}
					setUsage(payload);
					setRefreshedAt(Date.now());
				}).catch((error) => {
					if (!mountedRef.current || !usageLoaderRef.current.isCurrent(seq)) return;
					setUsageError(error instanceof Error ? error.message : String(error));
				});
			}, []);

			react.useEffect(() => {
				mountedRef.current = true;
				loadProviders();
				loadUsage();
				return () => {
					mountedRef.current = false;
				};
			}, [loadProviders, loadUsage]);

			react.useEffect(() => {
				if (selectedProvider === null) return;
				loadAccount(selectedProvider, false);
			}, [selectedProvider, loadAccount]);

			react.useEffect(() => {
				const timer = setInterval(() => {
					if (selectedProvider !== null) loadAccount(selectedProvider, false);
					if (open) loadUsage();
				}, open ? 60000 : 300000);
				return () => clearInterval(timer);
			}, [open, selectedProvider, loadAccount, loadUsage]);

			const retry = () => {
				loadProviders();
				loadUsage();
				if (selectedProvider !== null) loadAccount(selectedProvider, true);
			};

			// Derived stats shared by several widgets.
			const stats = react.useMemo(() => {
				if (usage === null || !Array.isArray(usage.days)) return null;
				const today = todayKey();
				const month = today.slice(0, 7);
				const addBucket = (target, entry) => {
					target.inputTokens += Number(entry.inputTokens ?? 0) || 0;
					target.outputTokens += Number(entry.outputTokens ?? 0) || 0;
					target.cacheReadTokens += Number(entry.cacheReadTokens ?? 0) || 0;
					target.cacheWriteTokens += Number(entry.cacheWriteTokens ?? 0) || 0;
				};
				const dayBuckets = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
				const monthBuckets = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
				let totalTokensSum = 0;
				let todayHit = null;
				for (const day of usage.days) {
					totalTokensSum += Number(day.tokens ?? 0) || 0;
					if (day.date === today) {
						addBucket(dayBuckets, day);
						todayHit = day.cacheHitRate ?? null;
					}
					if (day.date.startsWith(month)) addBucket(monthBuckets, day);
				}
				const bucketTokens = (buckets) => buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
				return {
					day: { ...dayBuckets, tokens: bucketTokens(dayBuckets) },
					month: { ...monthBuckets, tokens: bucketTokens(monthBuckets) },
					total: usage.total ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: totalTokensSum },
					todayHit,
					totalHit: usage.total?.cacheHitRate ?? null
				};
			}, [usage]);

			const recent = react.useMemo(() => {
				if (usage === null || !Array.isArray(usage.days)) return [];
				const cutoff = new Date();
				cutoff.setDate(cutoff.getDate() - 13);
				const cutoffKey = dayKeyOf(cutoff);
				const today = todayKey();
				return usage.days.filter((day) => day.date >= cutoffKey && day.date <= today && (Number(day.tokens ?? 0) || 0) > 0).reverse();
			}, [usage]);

			const dayMap = react.useMemo(() => {
				const map = new Map();
				if (usage !== null && Array.isArray(usage.days)) for (const day of usage.days) map.set(day.date, day);
				return map;
			}, [usage]);

			const selectedEntry = selectedDay !== null ? dayMap.get(selectedDay) ?? null : null;

			// Balance compact tone + value: green while healthy, red when the
			// account is out of credit or broken, neutral otherwise.
			const balanceCompact = (() => {
				if (accountLoading && account === null) return { value: "…", tone: null };
				if (account === null) return { value: accountError !== null ? "!" : "–", tone: accountError !== null ? "bad" : null };
				if (account.mode === "unsupported" || account.scheme === null) return { value: "–", tone: null };
				if (account.status === "not-configured") return { value: "–", tone: null };
				if (account.status !== "ok" || account.balance === null || account.balance === void 0) return { value: "!", tone: "bad" };
				if (account.balance.isAvailable === false) return { value: fmtCurrency(account.balance.total, account.balance.currency), tone: "bad" };
				return { value: fmtCurrency(account.balance.total, account.balance.currency), tone: "ok" };
			})();

			// Week mini cells for the recent compact (last 7 days incl. today).
			const weekCells = react.useMemo(() => {
				if (usage === null || !Array.isArray(usage.days)) return [];
				const today = todayKey();
				const days = usage.days.filter((day) => day.date <= today);
				const byDate = new Map(days.map((day) => [day.date, Number(day.tokens ?? 0) || 0]));
				const cells = [];
				const cursor = new Date();
				for (let i = 6; i >= 0; i -= 1) {
					const key = dayKeyOf(cursor);
					cells.push({ key, tokens: byDate.get(key) ?? 0 });
					cursor.setDate(cursor.getDate() - 1);
				}
				const max = Math.max(...cells.map((cell) => cell.tokens), 0);
				return cells.map((cell) => ({ ...cell, level: heatLevel(cell.tokens, max) }));
			}, [usage]);

			// Activity heatmap: a MONTH view of HEAT_COLS day columns ×
			// HEAT_ROWS hour rows (HEAT_HOURS hours per row), derived from the
			// same geometry constants the stylesheet is built from.
			// `heatMonthOffset` pages the view: 0 = current month, −1 = last
			// month… Future months are blocked in the nav; the current month is
			// padded to the full HEAT_COLS width so the grid geometry (and the
			// popup width it drives) never changes between pages.
			const heatData = react.useMemo(() => {
				if (usage === null || !Array.isArray(usage.days)) return null;
				const byDate = new Map(usage.days.map((day) => [day.date, Array.isArray(day.hours) ? day.hours : []]));
				const sumSlot = (slots, hour) => {
					let total = 0;
					for (let h = hour; h < hour + HEAT_HOURS; h += 1) total += slots[h] ?? 0;
					return total;
				};
				const anchor = new Date();
				anchor.setDate(1);
				anchor.setMonth(anchor.getMonth() + heatMonthOffset);
				const monthKey = dayKeyOf(anchor).slice(0, 7);
				const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
				// Prev stops at the oldest month that actually holds data
				// (`usage.days` is sorted ascending, but scan for the minimum
				// anyway); next stops at the current month — there is nothing
				// to show in the future.
				const now = new Date();
				const currentIndex = now.getFullYear() * 12 + now.getMonth();
				let firstIndex = null;
				for (const day of usage.days) {
					const match = /^(\d{4})-(\d{2})/.exec(String(day?.date ?? ""));
					if (match === null) continue;
					const index = Number(match[1]) * 12 + (Number(match[2]) - 1);
					if (firstIndex === null || index < firstIndex) firstIndex = index;
				}
				if (firstIndex === null) firstIndex = currentIndex;
				const minOffset = firstIndex - currentIndex;
				const today = todayKey();
				const days = [];
				for (let i = 1; i <= HEAT_COLS; i += 1) {
					// Beyond the month's last day the grid shows inert padding
					// cells (key=null) so every month renders the same width.
					if (i > daysInMonth) {
						days.push({ key: null, dayNum: i, monthStart: false, weekend: false });
						continue;
					}
					const cursor = new Date(anchor.getFullYear(), anchor.getMonth(), i);
					const key = dayKeyOf(cursor);
					days.push({ key, dayNum: i, monthStart: i === 1, weekend: cursor.getDay() === 0 || cursor.getDay() === 6 });
				}
				let max = 0;
				let monthTotal = 0;
				for (const { key } of days) {
					if (key === null) continue;
					const slots = byDate.get(key) ?? [];
					for (let h = 0; h < 24; h += HEAT_HOURS) {
						const value = sumSlot(slots, h);
						if (value > max) max = value;
						monthTotal += value;
					}
				}
				const rows = [];
				for (let r = 0; r < HEAT_ROWS; r += 1) {
					rows.push(days.map(({ key }) => {
						if (key === null) return { key: null, hour: r * HEAT_HOURS, value: 0, level: -1 };
						const value = sumSlot(byDate.get(key) ?? [], r * HEAT_HOURS);
						return { key, hour: r * HEAT_HOURS, value, level: heatLevel(value, max) };
					}));
				}
				return { days, rows, max, today, monthKey, monthTotal, minOffset, daysInMonth };
			}, [usage, heatMonthOffset]);

			// Dual channel comparison (DSH sessions vs Claude Code JSONL logs).
			const dualData = react.useMemo(() => {
				if (usage === null) return null;
				const claude = usage.claude ?? null;
				const sumDays = (days, key) => (Array.isArray(days) ? days : [])
					.filter((day) => day.date === key || key.length === 7 && day.date.startsWith(key))
					.reduce((sum, day) => sum + (Number(day.tokens ?? 0) || 0), 0);
				const dshTotal = Number(usage.total?.tokens ?? 0) || 0;
				const claudeTotal = Number(claude?.total?.tokens ?? 0) || 0;
				const sum = dshTotal + claudeTotal;
				const today = todayKey();
				const month = today.slice(0, 7);
				return {
					enabled: claude !== null && claude.enabled === true,
					present: claude !== null,
					dshTotal,
					claudeTotal,
					dshPct: sum > 0 ? Math.round(dshTotal / sum * 100) : 0,
					claudePct: sum > 0 ? 100 - Math.round(dshTotal / sum * 100) : 0,
					dshToday: sumDays(usage.days, today),
					claudeToday: sumDays(claude?.days, today),
					dshMonth: sumDays(usage.days, month),
					claudeMonth: sumDays(claude?.days, month)
				};
			}, [usage]);

			const themeStyle = {
				"--u-accent": settings.theme.accent,
				...(settings.theme.background !== null ? { "--u-bg": settings.theme.background } : {}),
				opacity: settings.theme.opacity
			};

			// Dock sizing: track the sidebar shell so the dock always centers inside
			// it (equal gaps on both sides), aligned with the settings area below.
			const dockRef = react.useRef(null);
			const dockSettingsRef = react.useRef(null);
			const sidebarRef = react.useRef(null);
			const [dockMetrics, setDockMetrics] = react.useState(null);
			react.useEffect(() => {
				const dock = dockRef.current;
				if (dock === null) return void 0;
				const sidebar = findSidebar(dock);
				sidebarRef.current = sidebar;
				if (sidebar === null) return void 0;
				const measure = () => {
					const rect = sidebar.getBoundingClientRect();
					const style = getComputedStyle(sidebar);
					const padLeft = parseFloat(style.paddingLeft) || 0;
					const padRight = parseFloat(style.paddingRight) || 0;
					// Inset the dock by a fixed margin on both sides so it never
					// touches the sidebar edges.
					const margin = 20;
					const width = rect.width - padLeft - padRight - margin * 2;
					if (width > 0) setDockMetrics({ left: rect.left + padLeft + margin, width, centerX: rect.left + rect.width / 2, rightEdge: rect.right });
					else setDockMetrics({ left: 14, width: 0, centerX: rect.left + rect.width / 2, rightEdge: rect.right });
				};
				measure();
				if (typeof ResizeObserver !== "undefined") {
					const observer = new ResizeObserver(measure);
					observer.observe(sidebar);
					return () => observer.disconnect();
				}
				return void 0;
			}, []);

			// Step-aside behaviour: the dock floats over the app, so it can sit on
			// top of something the user is trying to reach. Parking the pointer on
			// the dock for DOCK_GHOST_MS without moving turns it into a ghost —
			// dimmed and click-through — so the click lands on whatever the dock
			// covers. Any further pointer movement over the dock (or leaving it)
			// brings it straight back, and an open box never ghosts.
			const DOCK_GHOST_MS = 900;
			const DOCK_GHOST_SLOP = 6; // px of jitter that still counts as parked
			const [dockGhost, setDockGhost] = react.useState(false);
			react.useEffect(() => {
				if (open || usagePopOpen || heatmapPopOpen) {
					setDockGhost(false);
					return void 0;
				}
				let timer = null;
				let last = null;
				const clear = () => {
					if (timer !== null) {
						window.clearTimeout(timer);
						timer = null;
					}
				};
				const arm = () => {
					if (timer === null) {
						timer = window.setTimeout(() => {
							timer = null;
							setDockGhost(true);
						}, DOCK_GHOST_MS);
					}
				};
				// Tracked on window, not the dock: while ghosted the dock receives
				// no pointer events of its own, so geometry is the only way to know
				// the cursor left it.
				const onMove = (event) => {
					const node = dockRef.current;
					if (node === null || node === void 0) return;
					// never ghost mid-drag: that would drop the grip gesture
					if (dockDragRef.current !== null) {
						clear();
						last = null;
						setDockGhost(false);
						return;
					}
					const rect = node.getBoundingClientRect();
					const inside = event.clientX >= rect.left && event.clientX <= rect.right
						&& event.clientY >= rect.top && event.clientY <= rect.bottom;
					if (!inside) {
						clear();
						last = null;
						setDockGhost(false);
						return;
					}
					const moved = last === null
						? Infinity
						: Math.abs(event.clientX - last.x) + Math.abs(event.clientY - last.y);
					last = { x: event.clientX, y: event.clientY };
					if (moved > DOCK_GHOST_SLOP) {
						clear();
						setDockGhost(false);
					}
					arm();
				};
				window.addEventListener("mousemove", onMove, true);
				return () => {
					clear();
					window.removeEventListener("mousemove", onMove, true);
				};
			}, [open, usagePopOpen, heatmapPopOpen]);

			// Shared anchor for BOTH floating boxes (balance panel and usage popup):
			// the vertical position follows the dock gear, but the box pops out to
			// the RIGHT of the sidebar with a small gap so it never covers sidebar
			// content. Both boxes use the same geometry, so they always appear at
			// exactly the same place and size.
			const computeBoxAnchor = () => {
				const gear = dockSettingsRef.current;
				if (gear === null) return null;
				const rect = gear.getBoundingClientRect();
				const panelGap = 12;
				const sidebarRight = dockMetrics?.rightEdge ?? rect.right;
				const viewport = window.innerWidth || 1440;
				const panelWidth = Math.min(PANEL_WIDTH, viewport - 24);
				let panelLeft = sidebarRight + panelGap;
				panelLeft = Math.min(panelLeft, viewport - panelWidth - 8);
				panelLeft = Math.max(panelLeft, 8);
				// Vertical anchor: the bottom edge aligns with the sidebar's settings
				// button (fallback: the gear center).
				const sidebarEl = sidebarRef.current;
				const settingsRect = findTitleRect(sidebarEl, ["设置", "Settings"]);
				const bottom = settingsRect !== null
					? window.innerHeight - settingsRect.top
					: window.innerHeight - (rect.top + rect.height / 2);
				// Upper clamp: the box may never grow past the 「对话」 header — when
				// the dock sits too high, the box pins its top just below it instead.
				const dialogRect = findTitleRect(sidebarEl, ["对话", "Conversations", "Chats", "Sessions"]);
				const limitTop = dialogRect !== null ? dialogRect.bottom : 56;
				return { left: panelLeft, bottom, limitTop };
			};

			const openPanel = (widgetId) => {
				setSelectedDay(null);
				setShowCustomizer(false);
				// The three boxes share one slot: opening the balance panel closes
				// the usage + heatmap popups so they never stack on top of each other.
				setUsagePopOpen(false);
				setHeatmapPopOpen(false);
				setPanelAnchor(computeBoxAnchor());
				setOpen(true);
			};

			// Usage popup (recent usage log): an independent box with its own
			// trigger in the dock. It replaces the balance panel and the heatmap
			// popup rather than stacking on top of them, since all three occupy
			// the same anchor.
			const toggleUsagePop = () => {
				if (usagePopOpen) {
					setUsagePopOpen(false);
					return;
				}
				setOpen(false);
				setHeatmapPopOpen(false);
				setSelectedDay(null);
				setPanelAnchor(computeBoxAnchor());
				setUsagePopOpen(true);
			};
			const closeUsagePop = () => {
				setUsagePopOpen(false);
				setShowCustomizer(false);
			};
			// Customize the theme / aliases: the toggle button lives in the usage
			// popup header, and the customizer renders inside the same popup
			// (replacing the recent-day list while open). If the popup isn't
			// already up, opening it via the dock is the prerequisite.
			const toggleCustomizer = () => {
				if (usagePopOpen) {
					setShowCustomizer((value) => !value);
					return;
				}
				setOpen(false);
				setHeatmapPopOpen(false);
				setSelectedDay(null);
				setPanelAnchor(computeBoxAnchor());
				setUsagePopOpen(true);
				setShowCustomizer(true);
			};

			// Heatmap popup: lives in its own slot, never co-occupies the screen
			// with the balance panel or the usage popup.
			const toggleHeatmapPop = () => {
				if (heatmapPopOpen) {
					setHeatmapPopOpen(false);
					return;
				}
				setOpen(false);
				setUsagePopOpen(false);
				setSelectedDay(null);
				setPanelAnchor(computeBoxAnchor());
				setHeatmapPopOpen(true);
			};
			const closeHeatmapPop = () => setHeatmapPopOpen(false);

			// Heat-cell bubble. The grid carries ONE delegated handler for all
			// 31×6 cells: `mouseover` bubbles, so the hovered cell is found with
			// `closest()` and the state changes only when the cell itself
			// changes — no per-pixel re-render of 186 nodes. `right/top/bottom`
			// are the cell's own box, so the bubble is anchored to the cell's
			// right side instead of trailing the pointer, and it shows the instant
			// the cursor crosses the cell edge (the native `title` tooltip it
			// replaces waited for the browser's ~1s hover delay).
			const [heatTip, setHeatTip] = react.useState(null);
			const heatTipRef = react.useRef(null);
			const [heatTipBox, setHeatTipBox] = react.useState(null);
			const clearHeatTip = () => setHeatTip((prev) => (prev === null ? prev : null));
			const onHeatHover = (event) => {
				const node = event.target;
				const cell = typeof node?.closest === "function" ? node.closest("[data-heat-row]") : null;
				if (cell === null) {
					clearHeatTip();
					return;
				}
				const row = Number(cell.getAttribute("data-heat-row"));
				const col = Number(cell.getAttribute("data-heat-col"));
				const entry = heatData?.rows?.[row]?.[col] ?? null;
				if (entry === null || entry.key === null) {
					clearHeatTip();
					return;
				}
				const rect = cell.getBoundingClientRect();
				setHeatTip((prev) => (
					prev !== null && prev.row === row && prev.col === col
						? prev
						: { row, col, key: entry.key, hour: entry.hour, value: entry.value, level: entry.level, right: rect.right, top: rect.top, bottom: rect.bottom }
				));
			};
			// Derived once per render so the bubble can show the weekday without
			// touching the state object (avoids an extra re-render per hover).
			const heatTipWeekday = heatTip !== null ? heatWeekdayOf(heatTip.key) : -1;
			// Placement runs before paint, so the bubble never flashes at an
			// unclamped position on its way to the right one.
			react.useLayoutEffect(() => {
				if (heatTip === null) {
					setHeatTipBox(null);
					return;
				}
				const el = heatTipRef.current;
				if (el === null || el === void 0) return;
				const next = placeHeatTip({
					right: heatTip.right,
					top: heatTip.top,
					bottom: heatTip.bottom,
					tipWidth: el.offsetWidth,
					tipHeight: el.offsetHeight,
					viewportWidth: window.innerWidth,
					viewportHeight: window.innerHeight
				});
				setHeatTipBox((prev) => (prev !== null && prev.left === next.left && prev.top === next.top ? prev : next));
			}, [heatTip]);
			// The bubble is anchored to a cell box captured on hover, so it must
			// go away when that box moves out from under it.
			react.useEffect(() => {
				if (!heatmapPopOpen) {
					clearHeatTip();
					// Reopening the heatmap always lands on the current month.
					setHeatMonthOffset(0);
					return void 0;
				}
				if (typeof window === "undefined" || typeof window.addEventListener !== "function") return void 0;
				window.addEventListener("resize", clearHeatTip);
				// Keyboard paging: ← / → step one month at a time, Home jumps back
				// to the current month. Only triggers when no input has focus, so
				// typing inside the panel settings doesn't accidentally flip months.
				const onKey = (event) => {
					if (event.defaultPrevented) return;
					const target = event.target;
					if (target !== null && typeof target === "object" && "tagName" in target) {
						const tag = String(target.tagName ?? "").toLowerCase();
						if (tag === "input" || tag === "textarea" || tag === "select") return;
						if (target.isContentEditable === true) return;
					}
					if (event.key === "ArrowLeft") {
						event.preventDefault();
						clearHeatTip();
						setHeatMonthOffset((offset) => Math.max(offset - 1, heatData?.minOffset ?? offset - 1));
					} else if (event.key === "ArrowRight") {
						event.preventDefault();
						clearHeatTip();
						setHeatMonthOffset((offset) => Math.min(offset + 1, 0));
					} else if (event.key === "Home") {
						event.preventDefault();
						clearHeatTip();
						setHeatMonthOffset(0);
					}
				};
				window.addEventListener("keydown", onKey);
				// Wheel paging: scroll UP = previous month, DOWN = next month.
				// The handler only fires when the wheel originates inside the
				// heatmap popup (so other surfaces keep their default scroll).
				// Throttle by accumulating deltaY: a small trackpad nudge flips
				// exactly one month, a fast wheel scroll doesn't spam the
				// setter. preventDefault stops the popup body from scrolling
				// when the gesture is consumed by paging.
				const WHEEL_STEP = 60;
				let pending = 0;
				let scheduled = false;
				const flushWheel = () => {
					scheduled = false;
					const delta = pending;
					pending = 0;
					if (delta === 0) return;
					clearHeatTip();
					if (delta < 0) {
						setHeatMonthOffset((offset) => Math.max(offset - 1, heatData?.minOffset ?? offset - 1));
					} else {
						setHeatMonthOffset((offset) => Math.min(offset + 1, 0));
					}
				};
				const onWheel = (event) => {
					if (event.defaultPrevented) return;
					const root = document.querySelector("[data-dsh-usage-heat]");
					if (root === null) return;
					const node = event.target;
					if (node === null || typeof node !== "object" || !("nodeType" in node)) return;
					if (!root.contains(node)) return;
					event.preventDefault();
					pending += event.deltaY;
					if (Math.abs(pending) < WHEEL_STEP) return;
					if (!scheduled) {
						scheduled = true;
						// Coalesce the rapid bursts a trackpad emits into one
						// update per animation frame so paging feels stable.
						if (typeof window.requestAnimationFrame === "function") {
							window.requestAnimationFrame(flushWheel);
						} else {
							setTimeout(flushWheel, 16);
						}
					}
				};
				window.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					window.removeEventListener("resize", clearHeatTip);
					window.removeEventListener("keydown", onKey);
					window.removeEventListener("wheel", onWheel);
				};
			}, [heatmapPopOpen, heatData]);
			// The bubble itself: fixed to the viewport, hidden for the single
			// pre-measurement render (the layout effect above resolves the
			// placement before the browser ever paints it).
			const heatTipNode = heatTip !== null && react_jsx_runtime.jsxs("div", {
				ref: heatTipRef,
				className: "u_heatTip",
				"data-dsh-usage-heat-tip": true,
				style: {
					left: `${heatTipBox !== null ? heatTipBox.left : Math.round(heatTip.right + HEAT_TIP_GAP)}px`,
					top: `${heatTipBox !== null ? heatTipBox.top : Math.round(heatTip.top)}px`,
					...(heatTipBox === null ? { visibility: "hidden" } : {})
				},
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_heatTipHead",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_heatTipDate", children: dayLabel(heatTip.key) }),
							(heatTipWeekday !== -1) && react_jsx_runtime.jsx("span", { className: "u_heatTipWeekday", children: translate(`heat.weekday.${heatTipWeekday}`) }),
							react_jsx_runtime.jsx("span", { className: "u_heatTipTime", children: heatHourRange(heatTip.hour) })
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_heatTipRow",
						children: [
							react_jsx_runtime.jsx("span", {
								className: "u_heatTipDot",
								style: heatTip.level > 0 ? { background: heatColor(heatTip.level) } : void 0
							}),
							heatTip.value > 0
								? react_jsx_runtime.jsx("span", { className: "u_heatTipVal", children: fmtTokens(heatTip.value) })
								: react_jsx_runtime.jsx("span", { className: "u_heatTipVal", children: translate("heat.empty") }),
							heatTip.value > 0 && react_jsx_runtime.jsx("span", { className: "u_heatTipUnit", children: translate("heat.unit") })
						]
					})
				]
			});

			// Drag-to-reorder: while dragging, the layout stays PUT — only a dashed
			// ghost placeholder marks the drop slot (other cards glide aside via the
			// FLIP transition). The order commits once, on drop.
			const gridRef = react.useRef(null);
			const widgetRects = react.useRef(new Map());
			const dragIdRef = react.useRef(null);
			const dragStateRef = react.useRef(null);
			const [dragState, setDragState] = react.useState(null);
			react.useLayoutEffect(() => {
				const grid = gridRef.current;
				if (grid === null) return;
				const previous = widgetRects.current;
				const els = [...grid.querySelectorAll(".u_widget")];
				els.forEach((el) => {
					el.style.transition = "none";
					el.style.transform = "";
				});
				const next = new Map();
				for (const el of els) {
					const id = el.getAttribute("data-widget");
					if (id === null) continue;
					const rect = el.getBoundingClientRect();
					const old = previous.get(id);
					if (old !== void 0 && (old.left !== rect.left || old.top !== rect.top)) {
						el.style.transform = `translate(${old.left - rect.left}px, ${old.top - rect.top}px)`;
					}
					next.set(id, rect);
				}
				requestAnimationFrame(() => {
					for (const el of els) {
						el.style.transition = "transform .22s cubic-bezier(.22,.61,.36,1)";
						el.style.transform = "";
					}
				});
				widgetRects.current = next;
			});
			const onDragStart = (id) => (event) => {
				dragIdRef.current = id;
				dragStateRef.current = { id, overId: id };
				setDragState({ id, overId: id });
				const transfer = event.dataTransfer;
				if (transfer !== null && transfer !== void 0) {
					try {
						transfer.setData("text/plain", id);
						transfer.effectAllowed = "move";
					} catch {
						/* jsdom/older engines */
					}
				}
			};
			const onDragOver = (targetId) => (event) => {
				const dragged = dragIdRef.current;
				if (dragged === null) return;
				// Columns are fixed per widget, so a card can only be reordered
				// inside its own column; anything else is not a drop target.
				if (widgetColumn(dragged) !== widgetColumn(targetId)) return;
				event.preventDefault();
				if (event.dataTransfer !== null && event.dataTransfer !== void 0) {
					try {
						event.dataTransfer.dropEffect = "move";
					} catch {
						/* ignore */
					}
				}
				const current = dragStateRef.current;
				if (current !== null && current.overId !== targetId) {
					const next = { id: dragged, overId: targetId };
					dragStateRef.current = next;
					setDragState(next);
				}
			};
			const onDragEnd = () => {
				const state = dragStateRef.current;
				if (state !== null && state.overId !== state.id) {
					updateSettings((previous) => reorderWidget(previous, state.id, state.overId));
				}
				dragStateRef.current = null;
				dragIdRef.current = null;
				setDragState(null);
			};

			// Dock vertical repositioning: press the top-left grip and drag;
			// the offset persists in settings.
			// Free-floating dock repositioning: press the top-left grip and drag
			// anywhere; on release the dock auto-snaps to the nearest screen edge.
			// The position persists in settings as { x, y } (left/bottom px).
			const SNAP_MARGIN = 28;
			const dockDragRef = react.useRef(null);
			const onDockGripDown = (event) => {
				const rect = dockRef.current?.getBoundingClientRect();
				dockDragRef.current = {
					startX: event.clientX,
					startY: event.clientY,
					startPos: settings.dockPos,
					rect: rect !== null && rect !== void 0 ? { width: rect.width, height: rect.height } : null
				};
				try {
					event.currentTarget.setPointerCapture?.(event.pointerId);
				} catch {
					/* jsdom/older engines */
				}
			};
			/** Snap {x,y} (left/bottom px) to the nearest screen edge within the margin. */
			const snapDockPos = (x, y, rect) => {
				const viewportW = window.innerWidth || 1440;
				const viewportH = window.innerHeight || 900;
				let outX = x;
				let outY = y;
				if (rect !== null && rect !== void 0) {
					if (x <= SNAP_MARGIN) outX = 14;
					else if (viewportW - x - rect.width <= SNAP_MARGIN) outX = Math.max(0, viewportW - rect.width - 14);
					if (y <= SNAP_MARGIN) outY = 14;
					else if (viewportH - y - rect.height <= SNAP_MARGIN) outY = Math.max(0, viewportH - rect.height - 14);
				}
				return { x: outX, y: outY };
			};
			const onDockGripMove = (event) => {
				const drag = dockDragRef.current;
				if (drag === null) return;
				const rawX = drag.startPos.x + (event.clientX - drag.startX);
				const rawY = drag.startPos.y + (drag.startY - event.clientY);
				const next = snapDockPos(rawX, rawY, drag.rect);
				if (next.x !== settings.dockPos.x || next.y !== settings.dockPos.y) updateSettings({ dockPos: next });
			};
			const onDockGripUp = () => {
				dockDragRef.current = null;
			};

			const toggleWidgetKey = (id, key) => updateSettings(toggleWidget(settings, id, key));

			const hiddenIds = settings.order.filter((id) => settings.widgets[id]?.visible === false && !POPUP_WIDGETS.has(id));
			const visibleIds = settings.order.filter((id) => settings.widgets[id]?.visible !== false);
			// While dragging, a dashed ghost placeholder marks the drop slot; the
			// dragged card itself stays put (semi-transparent) until the drop.
			const GHOST_ID = "__ghost__";
			/** Visible ids of one panel column (user order), ghost slotted in. */
			const columnIds = (column) => {
				const list = visibleIds.filter((id) => widgetColumn(id) === column && !POPUP_WIDGETS.has(id));
				if (dragState === null || widgetColumn(dragState.id) !== column) return list;
				const overIndex = list.indexOf(dragState.overId);
				if (overIndex !== -1) list.splice(overIndex, 0, GHOST_ID);
				return list;
			};

			// Widget content factories (detail + compact expressions).
			const widgetContent = (id) => {
				switch (id) {
					case "balance":
						return {
							detail: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx(ProviderPicker, { providers, selected: selectedProvider, onSelect: setSelectedProvider, translate }),
									react_jsx_runtime.jsx(BalanceDetail, { account, translate, onRetry: retry })
								]
							}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.balance") }),
									react_jsx_runtime.jsx("span", { className: "u_floatValue", "data-tone": balanceCompact.tone, children: balanceCompact.value })
								]
							})
						};
					case "today":
						return {
							detail: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_statBig", children: fmtCompact(stats?.day.tokens ?? 0) }),
									stats !== null && react_jsx_runtime.jsx(TokenBreakdown, { buckets: stats.day, translate })
								]
							}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.today") }),
									react_jsx_runtime.jsx("span", { className: "u_floatValue", children: fmtCompact(stats?.day.tokens ?? 0) })
								]
							})
						};
					case "month":
						return {
							detail: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_statBig", children: fmtCompact(stats?.month.tokens ?? 0) }),
									stats !== null && react_jsx_runtime.jsx(TokenBreakdown, { buckets: stats.month, translate })
								]
							}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.month") }),
									react_jsx_runtime.jsx("span", { className: "u_floatValue", children: fmtCompact(stats?.month.tokens ?? 0) })
								]
							})
						};
					case "hit":
						return {
							detail: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_statBig", children: fmtHit(stats?.totalHit) }),
									react_jsx_runtime.jsx("p", {
										className: "u_hitCaption",
										children: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
											children: [translate("usage.todayHit"), ": ", react_jsx_runtime.jsx("b", { children: fmtHit(stats?.todayHit) }), " · ", translate("usage.totalHit"), ": ", react_jsx_runtime.jsx("b", { children: fmtHit(stats?.totalHit) })]
										})
									})
								]
							}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.hit") }),
									react_jsx_runtime.jsx("span", { className: "u_floatValue", children: fmtHit(stats?.todayHit) })
								]
							})
						};
					case "heatmap":
						return {
							detail: () => heatData === null
								? react_jsx_runtime.jsx("p", { className: "u_note", children: translate("usage.noData") })
								: react_jsx_runtime.jsxs("div", {
									className: "u_heatBox",
									children: [
										// Month paging header: prev ‹ month-label › next are clustered tight
										// in the centre (no edge-spacers) so the arrows
										// sit right next to the month label. The popup
										// head carries the totals; this row only owns
										// paging. Prev is disabled at the oldest month
										// that holds data, next at the current one.
										react_jsx_runtime.jsxs("div", {
											className: "u_heatNav",
											children: [
												react_jsx_runtime.jsx("button", {
													className: "u_heatNavBtn",
													type: "button",
													"aria-label": translate("heat.prevMonth"),
													title: translate("heat.prevMonth"),
													disabled: heatMonthOffset <= heatData.minOffset,
													onClick: () => setHeatMonthOffset((offset) => offset - 1),
													children: "‹"
												}, "prev"),
												react_jsx_runtime.jsxs("span", {
													className: "u_heatNavLabel",
													children: [
														react_jsx_runtime.jsx("span", { children: translate("heat.monthLabel", { year: heatData.monthKey.slice(0, 4), month: heatData.monthKey.slice(5, 7) }) }),
														// "今" pill only when paging has reached the
														// current month — otherwise a stale pill would
														// lie about where the user is.
														heatMonthOffset === 0 && react_jsx_runtime.jsx("span", { className: "u_heatNavNow", children: translate("heat.todayShort") })
													]
												}),
												react_jsx_runtime.jsx("button", {
													className: "u_heatNavBtn",
													type: "button",
													"aria-label": translate("heat.nextMonth"),
													title: translate("heat.nextMonth"),
													disabled: heatMonthOffset >= 0,
													onClick: () => setHeatMonthOffset((offset) => offset + 1),
													children: "›"
												}, "next")
											]
										}),
										// Per-day numeric header (1 2 3 …) aligned over the
										// day columns; weekends dim so workweeks scan first.
										react_jsx_runtime.jsx("div", {
											className: "u_heatWeek",
											children: [
												react_jsx_runtime.jsx("span", { key: "corner" }),
												...heatData.days.map(({ key, dayNum, weekend }) => react_jsx_runtime.jsx("span", {
													className: weekend ? "u_heatWeekLabel u_heatWeekend" : "u_heatWeekLabel",
													children: key === null ? null : dayNum
												}, key === null ? `pad-${dayNum}` : key))
											]
										}),
										// One delegated hover handler for the whole grid feeds the
										// cell bubble; the cells themselves carry only their row /
										// column index plus an accessible label (a native `title`
										// would re-introduce the slow OS tooltip). Padding cells
										// beyond the month's last day render inert.
										react_jsx_runtime.jsx("div", {
											className: "u_heatGrid",
											onMouseOver: onHeatHover,
											onMouseLeave: clearHeatTip,
											children: heatData.rows.map((cells, row) => {
												const hourLabel = String(cells[0].hour).padStart(2, "0");
												return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
													children: [
														react_jsx_runtime.jsx("span", { className: "u_heatHour", children: hourLabel }),
														...cells.map((cell, col) => {
															if (cell.key === null) {
																return react_jsx_runtime.jsx("span", {
																	className: "u_heatCell u_heatPad",
																	"aria-hidden": "true"
																}, `pad-${col}-${cell.hour}`);
															}
															return react_jsx_runtime.jsx("span", {
																className: cell.key === heatData.today ? "u_heatCell u_heatToday" : "u_heatCell",
																style: cell.level > 0 ? { background: heatColor(cell.level) } : void 0,
																role: "img",
																"data-heat-row": row,
																"data-heat-col": col,
																"aria-label": `${cell.key} ${heatHourRange(cell.hour)} · ${fmtTokens(cell.value)}`
															}, `${cell.key}-${cell.hour}`);
														})
													]
												}, `row-${cells[0].hour}`);
											})
										}),
										// Caption + legend under the grid: the usage total is
										// already in the nav header, so this row carries the
										// cell granularity, the covered date range, and the
										// color ramp.
										react_jsx_runtime.jsxs("div", {
											className: "u_heatCaption",
											children: [
												react_jsx_runtime.jsx("span", {
													children: heatData.monthTotal > 0
														? translate("heat.caption", {
															hours: HEAT_HOURS,
															start: String(heatData.monthKey.slice(5, 7)) + "-01",
															end: String(heatData.monthKey.slice(5, 7)).padStart(2, "0") + "-" + String(heatData.daysInMonth).padStart(2, "0")
														})
														: translate("heat.monthEmpty")
												}),
												react_jsx_runtime.jsxs("span", {
													className: "u_heatLegend",
													children: [
														react_jsx_runtime.jsx("span", { className: "u_heatLegendLabel", children: translate("heat.empty") }),
														[1, 2, 3, 4].map((level) => react_jsx_runtime.jsx("span", {
															className: "u_heatLegendCell",
															style: { background: heatColor(level) }
														}, level))
													]
												})
											]
										}),
										heatTipNode
									]
								}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("heat.today") }),
									react_jsx_runtime.jsx("span", {
										className: "u_todayStrip",
										children: heatData === null
											? null
											: heatData.rows.map((cells) => {
												const cell = cells.find((entry) => entry.key === heatData.today) ?? { level: 0, value: 0 };
												return react_jsx_runtime.jsx("span", {
													className: "u_todayStripCell",
													style: cell.level > 0 ? { background: heatColorNeutral(cell.level) } : void 0,
													title: `${String(cell.hour ?? 0).padStart(2, "0")}:00 · ${fmtTokens(cell.value ?? 0)}`
												}, `today-${cell.hour ?? 0}`);
											})
									})
								]
							})
						};
					case "dual":
						return {
							detail: () => dualData === null || !dualData.present || !dualData.enabled
								? react_jsx_runtime.jsx("p", { className: "u_note", children: translate("dual.disabled") })
								: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
									children: [
										react_jsx_runtime.jsxs("div", {
											className: "u_dualRow",
											children: [
												react_jsx_runtime.jsx("span", { className: "u_dualDot", style: { background: "var(--u-accent,#1f6feb)" } }),
												react_jsx_runtime.jsx("span", { className: "u_dualName", children: translate("dual.dsh") }),
												react_jsx_runtime.jsx("span", { className: "u_dualValue", children: `${fmtCompact(dualData.dshTotal)} · ${dualData.dshPct}%` })
											]
										}),
										react_jsx_runtime.jsxs("div", {
											className: "u_dualRow",
											children: [
												react_jsx_runtime.jsx("span", { className: "u_dualDot", style: { background: "#7c3aed" } }),
												react_jsx_runtime.jsx("span", { className: "u_dualName", children: translate("dual.claude") }),
												react_jsx_runtime.jsx("span", { className: "u_dualValue", children: `${fmtCompact(dualData.claudeTotal)} · ${dualData.claudePct}%` })
											]
										}),
										react_jsx_runtime.jsxs("div", {
											className: "u_dualBar",
											children: [
												react_jsx_runtime.jsx("div", { className: "u_dualBarDsh", style: { width: `${dualData.dshPct}%` } }),
												react_jsx_runtime.jsx("div", { className: "u_dualBarClaude", style: { width: `${dualData.claudePct}%` } })
											]
										})
									]
								}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.dual") }),
									dualData !== null && dualData.enabled
										? react_jsx_runtime.jsxs("span", {
											className: "u_dualMini",
											children: [
												react_jsx_runtime.jsx("span", { className: "u_floatValue", "data-tone": null, children: `${dualData.dshPct}%` }),
												react_jsx_runtime.jsxs("span", {
													className: "u_dualMiniBar",
													children: [
														react_jsx_runtime.jsx("span", { className: "u_dualMiniDsh", style: { width: `${dualData.dshPct}%` } }),
														react_jsx_runtime.jsx("span", { className: "u_dualMiniClaude", style: { width: `${dualData.claudePct}%` } })
													]
												}),
												react_jsx_runtime.jsx("span", { className: "u_floatValue", "data-tone": null, children: `${dualData.claudePct}%` })
											]
										})
										: react_jsx_runtime.jsx("span", { className: "u_floatValue", children: "–" })
								]
							})
						};
					case "recent":
						return {
							detail: () => selectedEntry !== null
								? react_jsx_runtime.jsx(DayDetail, { day: selectedEntry, onBack: () => setSelectedDay(null), translate, providers, aliases: settings.modelAliases })
								: recent.length === 0
									? react_jsx_runtime.jsx("p", { className: "u_note", children: translate("usage.noData") })
									: (() => {
										const maxRecentTokens = recent.reduce((max, day) => Math.max(max, Number(day.tokens ?? 0) || 0), 0);
										return react_jsx_runtime.jsx("div", {
											className: "u_days",
											children: recent.map((day) => {
												const share = maxRecentTokens > 0 ? Math.max((Number(day.tokens ?? 0) || 0) / maxRecentTokens * 100, 2) : 0;
												return react_jsx_runtime.jsxs("button", {
													type: "button",
													className: "u_day",
													onClick: () => setSelectedDay(day.date),
													children: [
														react_jsx_runtime.jsx("span", { className: "u_dayDate", children: dayLabel(day.date) }),
														react_jsx_runtime.jsx("span", { className: "u_dayHit", children: fmtHit(day.cacheHitRate) }),
														react_jsx_runtime.jsx("span", { className: "u_dayTokens", children: fmtCompact(day.tokens ?? 0) }),
														react_jsx_runtime.jsx("span", {
															className: "u_dayBarTrack",
															children: react_jsx_runtime.jsx("span", { className: "u_dayBar", style: { width: `${share}%` } })
														})
													]
												}, day.date);
											})
										});
									})(),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.recent") }),
									react_jsx_runtime.jsx("span", {
										className: "u_weekMini",
										children: weekCells.map((cell) => react_jsx_runtime.jsx("span", {
											className: "u_weekCell",
											style: { background: cell.level > 0 ? heatColorNeutral(cell.level) : void 0 },
											title: `${cell.key} ${fmtTokens(cell.tokens)}`
										}, cell.key))
									})
								]
							})
						};
					default:
						return { detail: () => null, compact: () => null };
				}
			};

			// Theme customizer row.
			const customizer = react_jsx_runtime.jsxs("div", {
				className: "u_themeBox",
				children: [
					react_jsx_runtime.jsx(ModelAliasEditor, {
						usage,
						providers,
						aliases: settings.modelAliases,
						onChange: (next) => updateSettings({ modelAliases: next }),
						translate
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_themeRow",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_themeLabel", children: translate("theme.accent") }),
							...ACCENT_PRESETS.map((color) => react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_swatch",
								"data-active": settings.theme.accent === color || void 0,
								style: { background: color },
								"aria-label": color,
								onClick: () => updateSettings({ theme: { accent: color } })
							}, color)),
							react_jsx_runtime.jsx("input", {
								type: "color",
								className: "u_colorInput",
								value: settings.theme.accent,
								"aria-label": translate("theme.accent"),
								onChange: (event) => updateSettings({ theme: { accent: event.target.value } })
							})
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_themeRow",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_themeLabel", children: translate("theme.background") }),
							...BACKGROUND_PRESETS.map((color, index) => react_jsx_runtime.jsx("button", {
								type: "button",
								className: color === null ? "u_swatch u_swatchNull" : "u_swatch",
								"data-active": settings.theme.background === color || void 0,
								style: color !== null ? { background: color } : void 0,
								"aria-label": color ?? translate("theme.follow"),
								title: color ?? translate("theme.follow"),
								onClick: () => updateSettings({ theme: { background: color } })
							}, `bg-${index}`)),
							react_jsx_runtime.jsx("input", {
								type: "color",
								className: "u_colorInput",
								value: settings.theme.background ?? "#1e1e1e",
								"aria-label": translate("theme.background"),
								onChange: (event) => updateSettings({ theme: { background: event.target.value } })
							})
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_themeRow",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_themeLabel", children: translate("theme.opacity") }),
							react_jsx_runtime.jsx("input", {
								type: "range",
								className: "u_range",
								min: 0.3,
								max: 1,
								step: 0.05,
								value: settings.theme.opacity,
								"aria-label": translate("theme.opacity"),
								onChange: (event) => updateSettings({ theme: { opacity: Number(event.target.value) } })
							}),
							react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_reset",
								onClick: () => updateSettings({ theme: { accent: ACCENT_PRESETS[0], background: null, opacity: 1 } }),
								children: translate("action.reset")
							})
						]
					})
				]
			});

			const updatedLabel = refreshedAt === null ? "" : translate("panel.updatedAt", {
				time: new Date(refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
			});

			// Floating dock: one framed container, divider rows, gear in the corner.
			const pinnedIds = visibleIds.filter((id) => settings.widgets[id]?.pinned === true && WIDGET_PINABLE[id] !== false);

			const dock = react_jsx_runtime.jsx("div", {
				className: "u_dock",
				ref: dockRef,
				style: {
					...themeStyle,
					left: `${settings.dockPos.x}px`,
					bottom: `${settings.dockPos.y}px`,
					...(dockMetrics !== null && dockMetrics.width > 0 ? { width: `${dockMetrics.width}px` } : {}),
					// ghost state overrides the themed opacity inline, because
					// themeStyle already sets opacity on this element
					...(dockGhost ? { opacity: Math.min(0.3, settings.theme.opacity), pointerEvents: "none" } : {})
				},
				"data-dsh-usage-dock": true,
				"data-ghost": dockGhost || void 0,
				children: react_jsx_runtime.jsxs("div", {
					className: "u_dockFrame",
					children: [
						react_jsx_runtime.jsx("button", {
							type: "button",
							className: "u_dockGrip",
							"aria-label": translate("action.dockDrag"),
							title: translate("action.dockDrag"),
							onPointerDown: onDockGripDown,
							onPointerMove: onDockGripMove,
							onPointerUp: onDockGripUp,
							children: react_jsx_runtime.jsx(GripIcon, { size: 12 })
						}),
						...pinnedIds.flatMap((id, index) => {
							const content = widgetContent(id);
							return [
								react_jsx_runtime.jsx("button", {
									type: "button",
									className: "u_dockItem",
									"data-widget": id,
									onClick: () => openPanel(id),
									children: content.compact()
								}, id),
								index < pinnedIds.length - 1 && react_jsx_runtime.jsx("div", { className: "u_dockDivider" }, `div-${id}`)
							];
						}),
						react_jsx_runtime.jsx(primitives.Tooltip, {
							label: translate("action.heatmapPop"),
							side: "top",
							delayMs: 500,
							children: react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_dockHeatmapPop",
								"data-active": heatmapPopOpen || void 0,
								"aria-label": translate("action.heatmapPop"),
								title: translate("action.heatmapPop"),
								onClick: toggleHeatmapPop,
								children: react_jsx_runtime.jsx(primitives.IconDataOutline16, { size: 11 })
							})
						}),
						react_jsx_runtime.jsx(primitives.Tooltip, {
							label: translate("action.usagePop"),
							side: "top",
							delayMs: 500,
							children: react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_dockUsagePop",
								"data-active": usagePopOpen || void 0,
								"aria-label": translate("action.usagePop"),
								title: translate("action.usagePop"),
								onClick: toggleUsagePop,
								children: react_jsx_runtime.jsx(primitives.IconListPenOutline16, { size: 11 })
							})
						}),
						react_jsx_runtime.jsx("button", {
							type: "button",
							className: "u_dockRefresh",
							"aria-label": translate("action.refresh"),
							title: translate("action.refresh"),
							onClick: retry,
							children: react_jsx_runtime.jsx(primitives.IconRefreshOutline14, { size: 11 })
						}),
						react_jsx_runtime.jsx("button", {
							type: "button",
							ref: dockSettingsRef,
							className: "u_dockSettings",
							"aria-label": translate("panel.title"),
							title: translate("panel.title"),
							onClick: () => {
								// Second click closes the panel; otherwise the shared
								// anchor puts the balance panel right of the sidebar —
								// the exact slot the usage popup uses too.
								if (open) {
									setOpen(false);
									return;
								}
								openPanel(null);
							},
							children: react_jsx_runtime.jsx(primitives.IconSettingsOutline14, { size: 12 })
						})
					]
				})
			});

			// The balance panel and the usage popup share one geometry: same
			// anchor, same width (CSS) and a FIXED height taken from the available
			// slot — so switching between them never moves or resizes the frame.
			const slotHeight = panelAnchor !== null
				? Math.max(160, (window.innerHeight - panelAnchor.limitTop) - panelAnchor.bottom - 8)
				: 0;
			const boxStyle = {
				...themeStyle,
				...(panelAnchor !== null ? {
					left: `${panelAnchor.left}px`,
					bottom: `${panelAnchor.bottom}px`,
					// Slot height: from the box's bottom edge up to the 「对话」 header
					// clamp (viewport height minus both).
					height: `${slotHeight}px`
				} : {})
			};
			// The heatmap popup keeps that anchor corner but sizes itself to the
			// grid: its width comes from the heat geometry (CSS) and its height
			// hugs the content, with the slot acting as the upper bound instead
			// of a fixed height — a panel-sized frame would leave the heatmap
			// stranded in the middle of a large void.
			const heatBoxStyle = {
				...themeStyle,
				...(panelAnchor !== null ? {
					left: `${panelAnchor.left}px`,
					bottom: `${panelAnchor.bottom}px`,
					maxHeight: `min(${slotHeight}px,82vh)`
				} : {})
			};

			// Usage popup: the recent usage log lives here. The activity heatmap moved
			// to its own popup, so this box now hosts a single scrolling list.
			const usagePop = usagePopOpen && react_jsx_runtime.jsxs("div", {
				className: "u_usagePop",
				"data-dsh-usage-pop": true,
				"aria-label": translate("action.usagePop"),
				style: boxStyle,
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_usagePopHead",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_usagePopTitle", children: translate("action.usagePop") }),
							react_jsx_runtime.jsxs("div", {
								className: "u_headerActions",
								children: [
									react_jsx_runtime.jsx(primitives.Tooltip, {
										label: translate("action.customize"),
										side: "bottom",
										delayMs: 500,
										children: react_jsx_runtime.jsx("button", {
											type: "button",
											className: "u_iconButton",
											"data-active": showCustomizer || void 0,
											"aria-label": translate("action.customize"),
											onClick: toggleCustomizer,
											children: react_jsx_runtime.jsx(primitives.IconSettingsOutline14, { size: 14 })
										})
									}),
									react_jsx_runtime.jsx("button", {
										type: "button",
										className: "u_iconButton",
										"aria-label": translate("action.close"),
										onClick: closeUsagePop,
										children: react_jsx_runtime.jsx(primitives.IconCloseOutline16, { size: 14 })
									})
								]
							})
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_usagePopBody",
						children: [
							!showCustomizer && react_jsx_runtime.jsxs("section", {
								className: "u_usagePopSection",
								"data-widget": "recent",
								children: [
									react_jsx_runtime.jsx("h3", { className: "u_usagePopSectionTitle", children: translate("widget.recent") }),
									react_jsx_runtime.jsx("div", { className: "u_usagePopSectionBody", children: widgetContent("recent").detail() })
								]
							}, "recent"),
							showCustomizer && react_jsx_runtime.jsx("div", {
								className: "u_usagePopCustomizer",
								children: customizer
							})
						]
					})
				]
			});

			// Heatmap popup: activity heatmap only. Anchored to the same corner as
			// the balance panel and the usage popup (opening one closes the
			// others), but sized to the grid rather than to the whole slot.
			const heatmapPop = heatmapPopOpen && react_jsx_runtime.jsxs("div", {
				className: "u_heatmapPop",
				"data-dsh-usage-heat": true,
				"aria-label": translate("action.heatmapPop"),
				style: heatBoxStyle,
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_heatmapPopHead",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_heatmapPopTitle", children: translate("action.heatmapPop") }),
							// Month total sits to the LEFT of today's chip: the
							// wider scope (month) reads first, then the today
							// value. Two compact chips instead of repeating the
							// total inside the grid.
							heatData !== null && react_jsx_runtime.jsxs("span", {
								className: "u_heatTotalChip",
								title: translate("heat.monthTotal"),
								children: [
									react_jsx_runtime.jsx("span", { className: "u_heatTotalChipLabel", children: translate("heat.monthTotal") }),
									react_jsx_runtime.jsx("b", { children: `${fmtCompact(heatData.monthTotal)} ${translate("heat.unit")}` })
								]
							}),
							heatData !== null && react_jsx_runtime.jsxs("span", {
								className: "u_heatTodayChip",
								title: translate("heat.today"),
								children: [
									react_jsx_runtime.jsx("span", { className: "u_heatTodayChipLabel", children: translate("heat.today") }),
									react_jsx_runtime.jsx("b", { children: fmtCompact(heatData.rows.reduce((sum, cells) => {
										const cell = cells.find((entry) => entry.key === heatData.today);
										return sum + (cell ? cell.value : 0);
									}, 0)) })
								]
							}),
							react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_iconButton",
								"aria-label": translate("action.close"),
								onClick: closeHeatmapPop,
								children: react_jsx_runtime.jsx(primitives.IconCloseOutline16, { size: 14 })
							})
						]
					}),
					react_jsx_runtime.jsx("div", {
						className: "u_heatmapPopBody",
						// The grid owns its size (heat geometry → CSS); the body only
						// centers it, and drops the cell bubble if it ever scrolls.
						onScroll: clearHeatTip,
						children: react_jsx_runtime.jsx("section", {
							className: "u_heatmapPopSection",
							"data-widget": "heatmap",
							// No section title: the popup head + month nav already
							// say what this is — a third header row is noise.
							children: react_jsx_runtime.jsx("div", { className: "u_heatmapPopSectionBody", children: widgetContent("heatmap").detail() })
						}, "heatmap")
					})
				]
			});

			if (!open) {
				// Rail mode (sidebar collapsed): a single round balance button.
				// Clicking it reveals the full dock; a transparent scrim closes it
				// again on any outside click.
				if (!wide && !dockOpen) {
					return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
						children: [
							react_jsx_runtime.jsxs("button", {
								type: "button",
								className: "u_railBtn",
								style: {
									...themeStyle,
									left: `${settings.dockPos.x}px`,
									bottom: `${settings.dockPos.y}px`
								},
								"data-dsh-usage-rail": true,
								"aria-label": translate("panel.title"),
								onClick: () => setDockOpen(true),
								children: [
									react_jsx_runtime.jsx("span", { className: "u_railLabel", children: translate("widget.balance") }),
									react_jsx_runtime.jsx("span", { className: "u_railValue", "data-tone": balanceCompact.tone, children: balanceCompact.value })
								]
							}),
							usagePop,
							heatmapPop
						]
					});
				}
				if (!wide && dockOpen) {
					return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
						children: [
							react_jsx_runtime.jsx("div", { className: "u_railScrim", onClick: () => setDockOpen(false) }),
							dock,
							usagePop,
							heatmapPop
						]
					});
				}
				return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [dock, usagePop, heatmapPop] });
			}

			const panel = react_jsx_runtime.jsxs("section", {
				className: "u_panel",
				style: boxStyle,
				"data-dsh-usage-panel": true,
				"aria-label": translate("panel.title"),
				children: [
					react_jsx_runtime.jsxs("header", {
						className: "u_header",
						children: [
							react_jsx_runtime.jsxs("div", {
								className: "u_headerLeft",
								children: [
									react_jsx_runtime.jsx(primitives.IconDataOutline16, { size: 16 }),
									react_jsx_runtime.jsx("span", { className: "u_title", children: translate("panel.title") })
								]
							}),
							react_jsx_runtime.jsxs("div", {
								className: "u_headerActions",
								children: [
									react_jsx_runtime.jsx(primitives.Tooltip, {
										label: translate("action.refresh"),
										side: "bottom",
										delayMs: 500,
										children: react_jsx_runtime.jsx("button", {
											type: "button",
											className: "u_iconButton",
											"aria-label": translate("action.refresh"),
											onClick: retry,
											children: react_jsx_runtime.jsx(primitives.IconRefreshOutline14, { size: 14 })
										})
									}),
									react_jsx_runtime.jsx(primitives.Tooltip, {
										label: translate("action.close"),
										side: "bottom",
										delayMs: 500,
										children: react_jsx_runtime.jsx("button", {
											type: "button",
											className: "u_iconButton",
											"aria-label": translate("action.close"),
											onClick: () => setOpen(false),
											children: react_jsx_runtime.jsx(primitives.IconCloseOutline16, { size: 14 })
										})
									})
								]
							})
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_body",
						children: [
						usageError !== null && react_jsx_runtime.jsxs("div", {
								className: "u_error",
								children: [
									react_jsx_runtime.jsx("span", { children: usageError }),
									react_jsx_runtime.jsx("button", { type: "button", className: "u_retry", onClick: retry, children: translate("action.retry") })
								]
							}),
						react_jsx_runtime.jsxs("div", {
							className: "u_columns",
							ref: gridRef,
							children: (() => {
							// One panel card. The ghost placeholder shares the slot so the
							// drop preview keeps the two-column layout intact.
							const widgetCard = (id) => {
								if (id === GHOST_ID) {
									return react_jsx_runtime.jsx("div", {
										className: "u_widget u_ghost",
										"data-widget": GHOST_ID,
										"data-width": WIDGET_WIDTH[dragState?.id] ?? "half"
									}, GHOST_ID);
								}
								const state = settings.widgets[id];
								const content = widgetContent(id);
								return react_jsx_runtime.jsxs("div", {
									className: "u_widget",
									"data-widget": id,
									"data-width": WIDGET_WIDTH[id] ?? "half",
									"data-dragging": dragState !== null && dragState.id === id || void 0,
									draggable: true,
									onDragStart: onDragStart(id),
									onDragOver: onDragOver(id),
									onDragEnd: onDragEnd,
									children: [
										react_jsx_runtime.jsxs("div", {
											className: "u_widgetHead",
											children: [
												react_jsx_runtime.jsx("button", {
													type: "button",
													className: "u_widgetTitle",
													onClick: () => toggleWidgetKey(id, "collapsed"),
													children: translate(`widget.${id}`)
												}),
												react_jsx_runtime.jsx("span", {
													className: "u_wIconBtn u_wHoverBtn",
													"aria-hidden": true,
													title: translate("action.drag"),
													children: react_jsx_runtime.jsx(GripIcon, { size: 12 })
												}),
												WIDGET_PINABLE[id] !== false && react_jsx_runtime.jsx("button", {
													type: "button",
													className: "u_wIconBtn u_wHoverBtn",
													"data-pinned": state.pinned || void 0,
													"aria-label": state.pinned ? translate("action.unpin") : translate("action.pin"),
													title: state.pinned ? translate("action.unpin") : translate("action.pin"),
													onClick: () => toggleWidgetKey(id, "pinned"),
													children: react_jsx_runtime.jsx(PinIcon, { size: 12 })
												}),
												react_jsx_runtime.jsx("button", {
													type: "button",
													className: "u_wIconBtn u_wHoverBtn",
													"aria-label": translate("action.hide"),
													title: translate("action.hide"),
													onClick: () => toggleWidgetKey(id, "visible"),
													children: react_jsx_runtime.jsx(primitives.IconCloseOutline16, { size: 12 })
												})
											]
										}),
										!state.collapsed && react_jsx_runtime.jsx("div", {
											className: "u_wBody",
											children: content.detail()
										})
									]
								}, id);
							};
							// Two columns: the main grid (balance + the four stat cards)
							// and the aside rail that gives the usage log and the activity
							// heatmap a column of their own. An empty column renders
							// nothing, so the remaining one takes the full width.
							return [
								{ key: "main", className: "u_grid u_gridMain", ids: columnIds("main") },
								{ key: "aside", className: "u_gridAside", ids: columnIds("aside") }
							]
								.filter((column) => column.ids.length > 0)
								.map((column) => react_jsx_runtime.jsxs("div", {
									className: column.className,
									"data-column": column.key,
									"data-widget-count": column.ids.length,
									children: column.ids.map((id) => widgetCard(id))
								}, column.key));
							})()
						}),
							hiddenIds.length > 0 && react_jsx_runtime.jsxs("div", {
								className: "u_hiddenBox",
								children: [
									react_jsx_runtime.jsx("button", {
										type: "button",
										className: "u_hiddenToggle",
										children: translate("hidden.count", { count: hiddenIds.length })
									}),
									hiddenIds.map((id) => react_jsx_runtime.jsxs("div", {
										className: "u_hiddenRow",
										children: [
											react_jsx_runtime.jsx("span", { className: "u_hiddenName", children: translate(`widget.${id}`) }),
											react_jsx_runtime.jsx("button", {
												type: "button",
												className: "u_restore",
												onClick: () => toggleWidgetKey(id, "visible"),
												children: translate("hidden.restore")
											})
										]
									}, id))
								]
							}),
							updatedLabel !== "" && react_jsx_runtime.jsx("p", { className: "u_footerNote", children: updatedLabel }),
						]
					})
				]
			});

			// The panel and the two popups are mutually exclusive (same slot), so
			// only one of them is ever truthy here.
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [dock, panel, usagePop, heatmapPop] });
		}
		//#endregion

		//#region plugin body
		/** Services required by the client plugin body. */
		const inject = ["slots", "locale"];

		/**
		 * Client plugin body: register the dictionaries and the sidebar footer action.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "usage: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "usage",
				locale: NS,
				order: 10
			}, UsagePanel));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.UsagePanel = UsagePanel;
		exports.fmtTokens = fmtTokens;
		exports.fmtCompact = fmtCompact;
		exports.fmtCurrency = fmtCurrency;
		exports.fmtHit = fmtHit;
		exports.heatLevel = heatLevel;
		exports.heatColor = heatColor;
		exports.placeHeatTip = placeHeatTip;
		exports.heatHourRange = heatHourRange;
		exports.defaultSettings = defaultSettings;
		exports.normalizeSettings = normalizeSettings;
		exports.reorderWidget = reorderWidget;
		exports.createLoader = createLoader;
		return module.exports;
	}
});
