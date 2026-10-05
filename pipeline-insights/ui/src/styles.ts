/**
 * The page's stylesheet, ported from the mockup. Every class is `pi-` prefixed and every colour
 * and font is a `--pi-*` variable (see theme.ts), so the page sits inside any host unchanged.
 * Breakpoints are container queries on the page, not the viewport, because a host's own
 * navigation takes part of the width.
 */
export const styles = `
.pi-root { color: var(--pi-fg); font: 14px/1.45 var(--pi-font); }
.pi-page { container: pi-page / inline-size; background: var(--pi-bg); }
/* .pi-root, not .pi-page: the side panel and tooltip sit outside the contained page. */
.pi-root *, .pi-root *::before, .pi-root *::after { box-sizing: border-box; }
.pi-root a { color: var(--pi-accent); text-decoration: none; }
.pi-root a:hover { text-decoration: underline; }
.pi-root button { font: inherit; color: inherit; }
.pi-root :focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
.pi-num { font-variant-numeric: tabular-nums; }

.pi-main { min-width: 0; padding: 20px 32px 60px; display: grid; gap: 20px; align-content: start; }
.pi-head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px 24px; }
.pi-head h1 { margin: 0; font-size: 22px; font-weight: 600; }
.pi-sub { color: var(--pi-muted); font-size: 13px; }
.pi-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.pi-seg { display: inline-flex; border: 1px solid var(--pi-line-strong); border-radius: 4px; overflow: hidden; background: var(--pi-surface); }
.pi-seg button { border: 0; background: none; padding: 5px 11px; cursor: pointer; font-size: 13px; }
.pi-seg button + button { border-left: 1px solid var(--pi-line-strong); }
.pi-seg button[aria-pressed="true"] { background: var(--pi-accent); color: var(--pi-accent-fg); }
.pi-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--pi-muted); cursor: pointer; user-select: none; }
.pi-toggle input { accent-color: var(--pi-accent); margin: 0; }
.pi-head h1 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.pi-head .pi-crumb { border: 0; background: none; padding: 0; cursor: pointer; font-weight: 600; color: var(--pi-accent); }
.pi-crumb:hover { text-decoration: underline; }
.pi-crumb-sep { color: var(--pi-faint); font-weight: 400; }
.pi-picker-wrap { position: relative; }
.pi-picker { display: inline-flex; align-items: center; gap: 6px; margin-left: -6px; padding: 1px 8px 1px 6px; border: 1px solid transparent; border-radius: 4px; background: none; cursor: pointer; font-weight: 600; }
.pi-picker:hover, .pi-picker[aria-expanded="true"] { border-color: var(--pi-line-strong); background: var(--pi-surface); }
.pi-head .pi-picker-all { color: var(--pi-muted); font-weight: 400; }
.pi-caret { width: 10px; flex: none; color: var(--pi-muted); }
.pi-caret-down { transform: rotate(180deg); }
.pi-menu { position: absolute; z-index: 18; top: calc(100% + 4px); left: -6px; width: 300px; max-width: calc(100vw - 32px); max-height: 60vh; overflow-y: auto; background: var(--pi-raised); border: 1px solid var(--pi-line-strong); border-radius: 4px; box-shadow: var(--pi-shadow); padding: 4px 0; font-size: 13px; font-weight: 400; }
.pi-menu hr { border: 0; border-top: 1px solid var(--pi-line); margin: 4px 0; }
.pi-menu-item { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 6px 12px; border: 0; background: none; cursor: pointer; text-align: left; }
.pi-menu-item:hover, .pi-menu-item:focus-visible { background: var(--pi-accent-soft); outline: none; }
.pi-menu-item[aria-checked="true"] { background: var(--pi-accent-soft); font-weight: 600; }
.pi-faint { color: var(--pi-faint); }
.pi-pick { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--pi-line-strong); border-radius: 4px; padding: 1px 4px 1px 10px; background: var(--pi-surface); font-size: 13px; color: var(--pi-muted); }
.pi-pick[data-set="true"] { border-color: var(--pi-accent); background: var(--pi-accent-soft); }
.pi-pick select { border: 0; background: none; color: var(--pi-fg); font: inherit; font-weight: 600; padding: 3px 2px; cursor: pointer; max-width: 220px; }
.pi-search { border: 1px solid var(--pi-line-strong); border-radius: 4px; padding: 5px 10px; background: var(--pi-surface); color: var(--pi-fg); width: 200px; font: inherit; font-size: 13px; }

.pi-panel { background: var(--pi-surface); border: 1px solid var(--pi-line); border-radius: 4px; }
.pi-top { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 20px; }
.pi-panel h2 { margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
.pi-count { font-size: 12px; font-weight: 600; color: var(--pi-muted); }
.pi-panel-head { padding: 14px 16px 10px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.pi-hint { font-size: 12px; color: var(--pi-faint); }

.pi-attn { list-style: none; margin: 0; padding: 0; }
.pi-attn > li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 10px; padding: 11px 16px; border-top: 1px solid var(--pi-line); align-items: start; }
.pi-attn > li.pi-attn-note { display: block; color: var(--pi-muted); }
.pi-what { font-weight: 600; }
.pi-what button { border: 0; background: none; padding: 0; cursor: pointer; font-weight: 600; color: var(--pi-accent); text-align: left; }
.pi-why { color: var(--pi-muted); font-size: 13px; }
.pi-why code, .pi-stage-name { font-family: inherit; font-weight: 600; color: var(--pi-fg); }
.pi-age { font-size: 12px; color: var(--pi-muted); white-space: nowrap; text-align: right; }
.pi-age a { display: block; font-size: 12.5px; margin-top: 2px; }
.pi-attn > li.pi-more { display: block; padding: 10px 16px; font-size: 13px; }
.pi-more button { border: 0; background: none; color: var(--pi-accent); cursor: pointer; padding: 0; }

.pi-health { padding: 4px 16px 16px; display: grid; gap: 14px; }
.pi-bar { display: flex; height: 12px; border-radius: 3px; overflow: hidden; gap: 2px; }
.pi-bar span { min-width: 4px; }
.pi-legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px 12px; }
.pi-legend button { display: flex; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 4px; background: none; padding: 4px 6px; cursor: pointer; text-align: left; }
.pi-legend button:hover { border-color: var(--pi-line); }
.pi-legend button[aria-pressed="true"] { border-color: var(--pi-accent); background: var(--pi-accent-soft); }
.pi-n { font-weight: 600; font-size: 16px; min-width: 22px; }
.pi-l { color: var(--pi-muted); font-size: 12.5px; }
.pi-stats { display: flex; flex-wrap: wrap; gap: 6px 22px; border-top: 1px solid var(--pi-line); padding-top: 12px; }
.pi-stats div { display: grid; }
.pi-stats b { font-size: 18px; font-weight: 600; }
.pi-stats span { font-size: 12px; color: var(--pi-muted); }

.pi-folders { display: grid; gap: 16px; }
.pi-folder { overflow: hidden; }
.pi-folder-head { width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 12px 16px; border: 0; background: none; cursor: pointer; text-align: left; }
.pi-chev { width: 10px; transition: transform .15s; color: var(--pi-muted); }
.pi-folder[data-open="false"] .pi-chev { transform: rotate(-90deg); }
.pi-fname { font-size: 15px; font-weight: 600; }
.pi-fsum { display: flex; gap: 10px; font-size: 12.5px; color: var(--pi-muted); flex-wrap: wrap; }
.pi-fsum > span { display: inline-flex; align-items: center; gap: 5px; }
.pi-rows-scroll { overflow-x: auto; }
.pi-rows-scroll > div { min-width: 800px; }
.pi-cols, .pi-row { display: grid; grid-template-columns: 28px minmax(200px, 1.5fr) 190px minmax(190px, 1.3fr) 104px; gap: 14px; align-items: center; padding-inline: 16px; }
.pi-cols { font-size: 11.5px; color: var(--pi-faint); font-weight: 600; padding-block: 6px; border-top: 1px solid var(--pi-line); border-bottom: 1px solid var(--pi-line); background: var(--pi-bg); }
.pi-cols span:last-child, .pi-rate { text-align: right; }
.pi-row { padding-block: 10px; border-bottom: 1px solid var(--pi-line); cursor: pointer; }
.pi-row:last-child { border-bottom: 0; }
.pi-row:hover { background: var(--pi-accent-soft); }
.pi-pname { font-weight: 600; overflow-wrap: anywhere; }
.pi-purpose { color: var(--pi-muted); font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pi-chain { font-size: 11.5px; color: var(--pi-faint); }
.pi-latest { font-size: 12.5px; color: var(--pi-muted); display: grid; gap: 5px; min-width: 0; }
.pi-line1 { color: var(--pi-fg); }
.pi-rate b { display: block; font-weight: 600; }
.pi-rate span { font-size: 12px; color: var(--pi-muted); }
.pi-chev-closed { transform: rotate(-90deg); }
.pi-pname .pi-chev { margin-right: 6px; vertical-align: 1px; }
.pi-tag-line { background: var(--pi-accent-soft); color: var(--pi-accent); }
.pi-line-head .pi-pname { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
.pi-line-head .pi-pname .pi-chev { margin-right: 0; }
.pi-row.pi-member { background: var(--pi-bg); padding-block: 8px; }
/* Archived or disabled: still listed, last in its folder, and drawn quiet. The name stays legible. */
.pi-row.pi-retired { background: var(--pi-bg); }
.pi-row.pi-retired > :not(:nth-child(2)), .pi-row.pi-retired .pi-purpose, .pi-row.pi-retired .pi-chain { opacity: .5; }
.pi-row.pi-retired .pi-pname { color: var(--pi-muted); }
.pi-who { position: relative; padding-left: 22px; }
.pi-who::before { content: ""; position: absolute; left: 6px; top: -9px; bottom: 50%; width: 10px; border-left: 1.5px solid var(--pi-line-strong); border-bottom: 1.5px solid var(--pi-line-strong); border-bottom-left-radius: 4px; }
.pi-role { font-size: 11px; font-weight: 600; color: var(--pi-faint); text-transform: uppercase; letter-spacing: .05em; margin-right: 8px; }
.pi-stack { display: grid; gap: 3px; }
.pi-stack > div { display: grid; grid-template-columns: 54px auto; gap: 6px; align-items: center; }
.pi-stack-role { font-size: 10.5px; color: var(--pi-faint); font-weight: 600; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-stack .pi-hist { height: 7px; gap: 2px; }
.pi-stack .pi-hist i { width: 6px; height: 7px; }
.pi-stack .pi-hist i.pi-pr { height: 4px; }
.pi-stack .pi-hist i.pi-blank { height: 3px; }
.pi-empty { padding: 16px; color: var(--pi-muted); font-size: 13px; }

.pi-hist { display: flex; gap: 2px; align-items: flex-end; height: 18px; }
.pi-hist i { width: 10px; height: 18px; border-radius: 2px; flex: none; }
.pi-hist i.pi-pr { height: 10px; opacity: .65; }
.pi-hist i.pi-blank { background: var(--pi-line); height: 6px; }
.pi-stages { display: flex; gap: 2px; height: 8px; max-width: 260px; }
.pi-stages i { flex: 1 1 0; min-width: 3px; max-width: 34px; border-radius: 2px; }

.pi-s-ok { background: var(--pi-ok); } .pi-s-fail { background: var(--pi-fail); } .pi-s-wait { background: var(--pi-wait); }
.pi-s-run { background: var(--pi-run); } .pi-s-cancel { background: var(--pi-cancel); } .pi-s-partial { background: var(--pi-partial); }
.pi-s-pending { background: var(--pi-line-strong); } .pi-s-skip { background: var(--pi-line); } .pi-s-idle { background: var(--pi-idle); }

.pi-ico { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; color: var(--pi-on-state); flex: none; }
.pi-ico svg { width: 12px; height: 12px; }
.pi-ico-ok { background: var(--pi-ok); } .pi-ico-fail { background: var(--pi-fail); } .pi-ico-wait { background: var(--pi-wait); }
.pi-ico-run { background: var(--pi-run); } .pi-ico-cancel { background: var(--pi-cancel); } .pi-ico-idle { background: var(--pi-idle); }
.pi-ico-partial { background: var(--pi-partial); } .pi-ico-info { background: var(--pi-line-strong); }
.pi-ico-never { background: none; border: 1.5px dashed var(--pi-line-strong); }
.pi-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }

.pi-tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 3px; background: var(--pi-idle-bg); color: var(--pi-muted); white-space: nowrap; }
.pi-tag-fail { background: var(--pi-fail-bg); color: var(--pi-fail); } .pi-tag-wait { background: var(--pi-wait-bg); color: var(--pi-wait); }

.pi-scrim { position: fixed; inset: 0; background: var(--pi-scrim); z-index: 20; }
.pi-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 21; width: min(560px, 100vw); background: var(--pi-raised); color: var(--pi-fg); box-shadow: var(--pi-shadow); display: grid; grid-template-rows: auto minmax(0, 1fr); }
.pi-drawer header { position: relative; padding: 16px 20px 12px; border-bottom: 1px solid var(--pi-line); display: grid; gap: 4px; }
.pi-x { position: absolute; right: 12px; top: 12px; border: 0; background: none; font-size: 20px; cursor: pointer; color: var(--pi-muted); width: 32px; height: 32px; border-radius: 4px; }
.pi-x:hover { background: var(--pi-line); }
.pi-drawer-state { display: flex; gap: 8px; align-items: center; font-size: 12.5px; color: var(--pi-muted); }
.pi-drawer h3 { margin: 0; font-size: 18px; font-weight: 600; padding-right: 36px; overflow-wrap: anywhere; }
.pi-drawer-links { display: flex; gap: 14px; font-size: 13px; flex-wrap: wrap; }
.pi-dbody { overflow-y: auto; padding: 16px 20px 40px; display: grid; gap: 18px; align-content: start; }
.pi-kv { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 6px 12px; font-size: 13px; margin: 0; }
.pi-kv dt { color: var(--pi-muted); } .pi-kv dd { margin: 0; overflow-wrap: anywhere; }
.pi-kv ul { margin: 0; padding-left: 16px; }
.pi-suggest { border: 1px dashed var(--pi-line-strong); border-radius: 4px; padding: 10px 12px; font-size: 13px; display: grid; gap: 4px; }
.pi-suggest code { font-family: inherit; font-weight: 600; }
.pi-notes { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.pi-drawer h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--pi-muted); text-transform: uppercase; letter-spacing: .04em; }
.pi-runlist { list-style: none; margin: 0; padding: 0; border: 1px solid var(--pi-line); border-radius: 4px; }
.pi-runlist > li { padding: 10px 12px; border-top: 1px solid var(--pi-line); display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 10px; align-items: start; }
.pi-runlist > li:first-child { border-top: 0; }
.pi-runlist > li.pi-attn-note { display: block; color: var(--pi-muted); }
.pi-rn { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.pi-rm { font-size: 12px; color: var(--pi-muted); }
.pi-rt { font-size: 12px; color: var(--pi-muted); text-align: right; white-space: nowrap; }
.pi-stage-list { display: grid; gap: 3px; margin-top: 6px; font-size: 12px; }
.pi-stage-list div { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 6px; align-items: center; color: var(--pi-muted); }
.pi-stage-list i { width: 10px; height: 10px; border-radius: 2px; }
.pi-stage-list .pi-hot { color: var(--pi-fg); font-weight: 600; }
.pi-footnote { font-size: 12px; color: var(--pi-faint); margin: 8px 0 0; }

.pi-loading { display: grid; justify-items: center; align-content: center; gap: 14px; min-height: 260px; }
.pi-loading-strip { display: flex; gap: 3px; align-items: flex-end; height: 26px; }
.pi-loading-strip i { width: 14px; height: 8px; border-radius: 3px; background: var(--pi-line); animation: pi-cell 3.2s ease-out infinite; }
@keyframes pi-cell {
  0% { background: var(--pi-line); height: 8px; }
  6%, 78% { background: var(--pi-cell); height: 26px; opacity: 1; }
  90%, 100% { background: var(--pi-line); height: 8px; opacity: .6; }
}
.pi-loading-label { color: var(--pi-muted); font-size: 13px; }
.pi-loading-count { color: var(--pi-faint); font-size: 12px; min-height: 18px; }
.pi-busy { display: inline-flex; align-items: center; gap: 6px; margin-left: 12px; color: var(--pi-faint); }
.pi-busy i { width: 6px; height: 6px; border-radius: 50%; background: var(--pi-accent); animation: pi-pulse 1.2s ease-in-out infinite; }
.pi-ring { display: inline-block; width: 11px; height: 11px; margin-left: 6px; vertical-align: -1px; border-radius: 50%; border: 1.5px solid var(--pi-line-strong); border-top-color: var(--pi-accent); animation: pi-spin .8s linear infinite; }
.pi-stages-pending { display: flex; gap: 2px; height: 8px; max-width: 200px; margin-top: 6px; }
.pi-stages-pending i { flex: 1; border-radius: 2px; background: var(--pi-line-strong); animation: pi-pulse 1.2s ease-in-out infinite; }
.pi-stages-pending i:nth-child(2) { animation-delay: .15s; } .pi-stages-pending i:nth-child(3) { animation-delay: .3s; } .pi-stages-pending i:nth-child(4) { animation-delay: .45s; }
@keyframes pi-pulse { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
@keyframes pi-spin { to { transform: rotate(360deg); } }

.pi-dock { position: fixed; right: 20px; bottom: 0; z-index: 15; width: min(560px, calc(100vw - 40px)); background: var(--pi-raised); color: var(--pi-fg); border: 1px solid var(--pi-line-strong); border-bottom: 0; border-radius: 6px 6px 0 0; box-shadow: var(--pi-shadow); }
.pi-dock-bar { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 14px; border: 0; background: none; cursor: pointer; font-size: 13px; text-align: left; }
.pi-dock-bar b { font-weight: 600; }
.pi-badge { background: var(--pi-accent); color: var(--pi-accent-fg); font-size: 11px; font-weight: 600; border-radius: 9px; padding: 0 7px; line-height: 18px; }
.pi-grow { flex: 1; }
.pi-dock-body { border-top: 1px solid var(--pi-line); max-height: min(440px, 70vh); overflow-y: auto; padding: 4px 0 12px; }
.pi-dock-note { margin: 12px 14px; color: var(--pi-muted); font-size: 13px; }
.pi-group { margin: 0; padding: 12px 14px 4px; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--pi-faint); }
.pi-items { list-style: none; margin: 0; padding: 0; }
.pi-items > li { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--pi-line); align-items: start; }
.pi-items > li:last-child { border-bottom: 0; }
.pi-mark { width: 14px; height: 14px; border-radius: 50%; margin-top: 2px; display: grid; place-items: center; }
.pi-mark-todo { border: 1.5px solid var(--pi-wait); }
.pi-mark-part { border: 1.5px solid var(--pi-wait); background: conic-gradient(var(--pi-wait) 0 50%, transparent 0); }
.pi-mark-done { background: var(--pi-ok); }
.pi-mark-done::after { content: ""; width: 6px; height: 3px; border-left: 1.5px solid var(--pi-on-state); border-bottom: 1.5px solid var(--pi-on-state); transform: translateY(-1px) rotate(-45deg); }
.pi-item-title { font-weight: 600; font-size: 13px; }
.pi-item-detail { color: var(--pi-muted); font-size: 12.5px; }
.pi-item-detail code, .pi-help code { font-family: var(--pi-mono); font-size: 12px; font-weight: 400; color: var(--pi-fg); }
.pi-item-count { font-size: 12px; color: var(--pi-faint); white-space: nowrap; text-align: right; }
.pi-meter { width: 64px; height: 4px; border-radius: 2px; background: var(--pi-line); overflow: hidden; margin: 4px 0 0 auto; }
.pi-meter i { display: block; height: 100%; background: var(--pi-accent); }
.pi-checked { list-style: none; margin: 0; padding: 6px 14px 10px; font-size: 12.5px; color: var(--pi-muted); display: flex; flex-wrap: wrap; gap: 4px 16px; }
.pi-checked li::before { content: "✓ "; color: var(--pi-ok); font-weight: 600; }
.pi-help { padding: 4px 14px 0; display: grid; gap: 8px; font-size: 12.5px; color: var(--pi-muted); }
.pi-help p { margin: 0; }
.pi-help pre { margin: 0; background: var(--pi-bg); border: 1px solid var(--pi-line); border-radius: 4px; padding: 10px 12px; font: 12px/1.5 var(--pi-mono); color: var(--pi-fg); overflow-x: auto; }
.pi-help a, .pi-dock-foot a { font-weight: 600; }
.pi-check { display: flex; gap: 8px; align-items: flex-start; color: var(--pi-fg); cursor: pointer; }
.pi-check input { margin: 2px 0 0; accent-color: var(--pi-accent); }
.pi-check small { display: block; color: var(--pi-muted); font-size: 12px; margin-top: 2px; }
.pi-dock-foot { margin: 12px 14px 0; padding-top: 10px; border-top: 1px solid var(--pi-line); display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; font-size: 12px; color: var(--pi-faint); }
.pi-dock-foot b { color: var(--pi-muted); font-weight: 600; }

.pi-tip { position: fixed; z-index: 30; pointer-events: none; background: var(--pi-fg); color: var(--pi-bg); font-size: 12px; padding: 5px 8px; border-radius: 4px; max-width: 280px; }

@container pi-page (max-width: 880px) { .pi-top { grid-template-columns: 1fr; } }
@container pi-page (max-width: 640px) { .pi-main { padding-inline: 16px; } .pi-controls { width: 100%; } .pi-search { width: 100%; } }
@media (prefers-reduced-motion: reduce) {
  .pi-root *, .pi-root *::before, .pi-root *::after { transition: none !important; animation: none !important; }
  .pi-loading-strip i { background: var(--pi-cell); height: 26px; }
}
`;
