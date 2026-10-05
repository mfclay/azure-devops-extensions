// The golden oracle: the mockup's own state model and attention rules, so the ported rules in
// src/rules.ts can be held to them. Copied verbatim from the mockup (insights-template.html,
// lines 277, 291-293 and 298-371), which lives outside this repo. Do not edit the copied lines; if the
// mockup changes, copy them again. The wrapper supplies the globals the mockup's page defined:
// NOW, DAY, the view `state` and ARCHIVE. The extension has no archive folder, so the wrapper
// shows every pipeline and gives ARCHIVE a value no folder can equal, which turns off the
// mockup's archive rules without touching its lines.
//
// The mockup reads a reshaped pipeline list (DATA.pipelines); test/oracle/adapter.ts builds it
// from a fixture. Its `why` sentences carry HTML, so tests never compare them.

/**
 * @param {{ generated: string, pipelines: any[] }} DATA
 * @param {{ days: number, mainOnly: boolean }} view
 */
export function runMockup(DATA, view) {
  const NOW = Date.parse(DATA.generated);
  const DAY = 864e5;
  const state = { days: view.days, mainOnly: view.mainOnly, archive: true, q: "", filter: null, open: {} };
  const ARCHIVE = null;

  // ---- copied from the mockup ----
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const runState = r => r.status !== "completed"
  ? ((r.stages || []).some(s => s[3]) ? "wait" : "run")
  : ({ succeeded: "ok", failed: "fail", canceled: "cancel", partiallySucceeded: "partial" }[r.result] || "cancel");

function analyse(p) {
  const runs = p.runs.filter(r => !state.mainOnly || r.branch === "main");
  const active = runs.filter(r => r.status !== "completed");
  const waiting = active.filter(r => (r.stages || []).some(s => s[3]));
  const done = runs.filter(r => r.status === "completed");
  const last = done[0];
  const lastAny = runs[0];
  const since = Date.parse((lastAny || {}).queued || 0);
  let st;
  if (!runs.length) st = p.runs.length ? "offmain" : "never";
  else if (last && last.result === "failed") st = "fail";
  else if (waiting.length) st = "wait";
  else if (active.length) st = "run";
  else if (last && last.result === "partiallySucceeded") st = "partial";
  else if (last && last.result === "canceled") st = "cancel";
  else if (NOW - since > 30 * DAY) st = "idle";
  else st = "ok";
  const inWin = done.filter(r => NOW - Date.parse(r.finished || r.queued) <= state.days * DAY);
  const judged = inWin.filter(r => r.result !== "canceled");
  const okN = judged.filter(r => r.result === "succeeded").length;
  const durs = inWin.filter(r => r.started && r.finished).map(r => Date.parse(r.finished) - Date.parse(r.started)).sort((a, b) => a - b);
  return {
    p, runs, active, waiting, last, lastAny, st,
    rate: judged.length ? okN / judged.length : null, judged: judged.length, failedN: judged.length - okN,
    median: durs.length ? durs[Math.floor(durs.length / 2)] : null, windowRuns: inWin.length,
    manualOnly: p.triggers.length === 1 && p.triggers[0] === "Manual only",
    chain: (p.triggers.find(t => t.startsWith("After `")) || "").match(/After `([^`]+)`/)?.[1],
  };
}

function outcomePhrase(o) {
  const phrases = { succeeded: "succeeded", failed: "failed", partiallySucceeded: "partially succeeded", canceled: "was canceled",
    inProgress: "is still running", notStarted: "is queued", postponed: "is queued", cancelling: "is being canceled" };
  return phrases[o] ?? o.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function attention(list) {
  const items = [];
  for (const a of list) {
    const p = a.p;
    if (a.st === "fail") {
      const bad = (a.last.stages || []).find(s => s[2] === "failed");
      const prev = a.runs.filter(r => r.status === "completed")[1];
      const elsewhere = state.mainOnly ? p.runs.filter(r => r.branch !== "main" && Date.parse(r.queued) > Date.parse(a.last.queued)) : [];
      const parts = [bad ? `Failed at <span class="stage-name">${esc(bad[0])}</span>.` : ""];
      if (a.failedN > 1) parts.push(`${a.failedN} failures in the last ${state.days} days.`);
      else if (!prev) parts.push(state.mainOnly ? "It is the only run on main." : "It is the only finished run.");
      else if (prev.result === "succeeded") parts.push("The run before it passed.");
      if (elsewhere.length) {
        // Changed from the original mockup in step with core: singular wording, and outcome words rather than API values.
        const outcome = outcomePhrase(elsewhere[0].result || elsewhere[0].status);
        parts.push(elsewhere.length === 1 ? `A newer run from another branch ${outcome}.` : `${elsewhere.length} newer runs from other branches; the latest ${outcome}.`);
      }
      items.push({ sev: 0, k: "fail", a, when: a.last.finished, run: a.last.id,
        what: state.mainOnly ? "Last run on main failed" : "Last run failed", why: parts.filter(Boolean).join(" ") });
    }
    const groups = {};
    for (const r of a.waiting) {
      const s = r.stages.find(x => x[3]);
      (groups[s[0]] ||= []).push(r);
    }
    for (const [stage, rs] of Object.entries(groups)) {
      const oldest = rs[rs.length - 1];
      const old = NOW - Date.parse(oldest.queued) > DAY;
      const failedInRun = rs.flatMap(r => (r.stages || []).filter(s => s[2] === "failed").map(s => s[0]));
      let why = `${rs.length > 1 ? `${rs.length} runs are` : "A run is"} waiting at <span class="stage-name">${esc(stage)}</span>.`;
      if (old) why += " Waiting more than a day, so it may be stale. Newer runs of this pipeline can queue behind it.";
      if (failedInRun.length) why += ` In the same run, <span class="stage-name">${esc(failedInRun[0])}</span> failed.`;
      items.push({ sev: old ? 1 : 2, k: "wait", a, when: oldest.queued, run: oldest.id, what: old ? "Approval waiting a long time" : "Waiting for approval", why });
    }
    if (a.st !== "fail" && a.judged >= 4 && a.failedN / a.judged >= 0.25) {
      items.push({ sev: 3, k: "partial", a, when: a.last?.finished, run: a.last?.id, what: "Unreliable lately",
        why: `Failed ${a.failedN} of ${a.judged} runs in the last ${state.days} days, though the latest passed.` });
    }
    if (a.st === "idle" && !a.manualOnly && !p.disabled && p.folder !== ARCHIVE) {
      items.push({ sev: 4, k: "idle", a, when: a.lastAny?.queued, run: a.lastAny?.id, what: "Has triggers but hasn't run lately",
        why: `No runs in ${Math.round((NOW - Date.parse(a.lastAny.queued)) / DAY)} days. Check that its triggers still match where changes land.` });
    }
  }
  items.sort((x, y) => x.sev - y.sev || Date.parse(x.when || 0) - Date.parse(y.when || 0));
  const noOwner = list.filter(a => a.p.folder !== ARCHIVE && (!a.p.owner || a.p.owner.toUpperCase() === "TODO")).length;
  if (noOwner) items.push({ sev: 9, k: "info", what: `${noOwner} pipelines have no owner`, why: "Owners come from the <code>@pipeline-doc</code> header in each YAML. The Pipeline Catalog page lists them.", static: true });
  return items;
}
  // ---- end of copy ----

  // The first lines of the mockup's render().
  const all = DATA.pipelines.filter(p => state.archive || p.folder !== ARCHIVE).map(analyse);
  const items = attention(all);
  return { all, items, runState };
}
