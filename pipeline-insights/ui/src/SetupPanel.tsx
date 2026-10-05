import { CATALOG_NAME } from '@pipeline-insights/core';
import { useCallback, useState } from 'react';
import { clock } from './format.js';
import { PhraseView } from './parts.js';
import type { SetupItem, SetupStatus } from './setup.js';

/** Where the open or minimized choice is kept, per browser. */
const OPEN_KEY = 'pipeline-insights.setup-open';
/** Where the viewer's choice to search whole repos is kept, per browser. */
const SEARCH_KEY = 'pipeline-insights.search-repos';

const EXAMPLE = `pipelines:
  pipelines/web-app-build.yaml:
    owner: Platform Team
    category: production
    component: web-app
    purpose: >-
      Builds and pushes the web app image.`;

/** The viewer's choice to search a whole repo for its metadata file, when none is in a well-known folder. */
export interface RepoSearch {
  on: boolean;
  onChange: (on: boolean) => void;
}

/**
 * The search choice, remembered per browser and off until the viewer turns it on. A host passes
 * `on` to `loadMetadata()` as `searchRepos`, reads again when it changes, and hands the pair to
 * the page. A host whose source cannot list a whole repo leaves it out, and the box is not shown.
 */
export function useRepoSearch(): RepoSearch {
  const [on, setOn] = useState(() => stored(SEARCH_KEY));
  const onChange = useCallback((next: boolean) => {
    setOn(next);
    store(SEARCH_KEY, next);
  }, []);
  return { on, onChange };
}

/** The panel's footer: what is installed, and where to read about it. */
export interface About {
  /** The extension's version, or what the host is, such as "dev page". */
  version: string;
  /** The extension's page, which carries the description format in full. */
  href?: string;
}

interface Props {
  /** Null until the descriptions have been read. */
  status: SetupStatus | null;
  readingMetadata: boolean | undefined;
  about: About | undefined;
  now: number;
  /** How long the descriptions took to read after the runs. */
  metadataMs: number | undefined;
  /** Absent when the host cannot search a whole repo. */
  repoSearch?: RepoSearch | undefined;
}

function stored(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function store(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage can be blocked; the choice then lasts only as long as the page.
  }
}

/**
 * "Get more from Insights": a tab docked at the bottom right that opens upward. What the project
 * still has to describe, each with what it unlocks; the checks that passed; how to describe a
 * pipeline; and the extension's version and when the data was read.
 */
export function SetupPanel({ status, readingMetadata, about, now, metadataMs, repoSearch }: Props) {
  const [open, setOpen] = useState(() => stored(OPEN_KEY));
  const toggle = () => {
    setOpen(!open);
    store(OPEN_KEY, !open);
  };
  const count = status?.todo.length ?? 0;

  return (
    <aside className="pi-dock" aria-label="Get more from Insights">
      <button type="button" className="pi-dock-bar" aria-expanded={open} onClick={toggle}>
        <b>Get more from Insights</b>
        {count > 0 && (
          <span className="pi-badge pi-num" aria-label={`${count} to set up`}>
            {count}
          </span>
        )}
        <span className="pi-grow" />
        <svg className={open ? 'pi-caret pi-caret-down' : 'pi-caret'} viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 6.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="pi-dock-body">
          {status ? (
            <>
              {status.todo.length > 0 && (
                <>
                  <h3 className="pi-group">To set up</h3>
                  <ul className="pi-items">
                    {status.todo.map((item) => (
                      <Item key={item.title} item={item} />
                    ))}
                  </ul>
                </>
              )}
              {status.checked.length > 0 && (
                <>
                  <h3 className="pi-group">Checked</h3>
                  <ul className="pi-checked">
                    {status.checked.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <p className="pi-dock-note">{readingMetadata ? 'Reading descriptions…' : 'Descriptions have not been read.'}</p>
          )}
          <h3 className="pi-group">How to describe a pipeline</h3>
          <div className="pi-help">
            <p>
              Give each repo one <code>{CATALOG_NAME}</code> file, in <code>pipelines/</code>, <code>.azuredevops/</code> or the
              repo root, with an entry for each pipeline keyed by its YAML path. Insights reads it from the default branch.
            </p>
            <p>
              Add <code>archived: true</code> to an entry to keep a pipeline listed but out of every count and of Needs attention.
              Disabled pipelines are treated the same way.
            </p>
            <pre>{EXAMPLE}</pre>
            {about?.href && (
              <a href={about.href} target="_blank" rel="noopener">
                The full format ›
              </a>
            )}
            {repoSearch && (
              <label className="pi-check">
                <input type="checkbox" checked={repoSearch.on} onChange={(e) => repoSearch.onChange(e.target.checked)} />
                <span>
                  Search the whole repository for the metadata file
                  <small>Only where none is in a well-known folder. Off by default: it lists every file in the repo.</small>
                </span>
              </label>
            )}
          </div>
          <div className="pi-dock-foot">
            <span>
              {about && (
                <>
                  Pipeline Insights <b className="pi-num">{about.version}</b> ·{' '}
                </>
              )}
              data read {clock(now)}
              {metadataMs !== undefined && `, descriptions ${(metadataMs / 1000).toFixed(1)} s after`}
            </span>
            {about?.href && (
              <a href={about.href} target="_blank" rel="noopener">
                About this extension ›
              </a>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function Item({ item }: { item: SetupItem }) {
  const p = item.progress;
  const mark = p && p.of && p.done >= p.of ? 'done' : p && p.done > 0 ? 'part' : 'todo';
  return (
    <li>
      <span className={`pi-mark pi-mark-${mark}`} aria-hidden="true" />
      <div>
        <div className="pi-item-title">{item.title}</div>
        <div className="pi-item-detail">
          <PhraseView phrase={item.detail} />
        </div>
      </div>
      {p && (
        <div className="pi-item-count pi-num">
          {p.done} of {p.of}
          {p.unit}
          <div className="pi-meter" aria-hidden="true">
            <i style={{ width: `${p.of ? Math.round((100 * p.done) / p.of) : 0}%` }} />
          </div>
        </div>
      )}
    </li>
  );
}
