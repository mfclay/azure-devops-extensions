import type { Lines, Phrase, Pipeline, RepoCatalog } from '@pipeline-insights/core';
import { CATALOG_NAME, isRetired } from '@pipeline-insights/core';
import { notCounted } from './format.js';
import { declared } from './scope.js';

/**
 * What the setup panel says: what a project still has to describe, each with what it unlocks,
 * and the checks that passed. Worked out for the whole project, whatever folder is in view.
 */
export interface SetupItem {
  title: string;
  detail: Phrase;
  /** How many pipelines have it so far; absent where a count says nothing. */
  progress?: { done: number; of: number; unit?: string };
}

export interface SetupStatus {
  /** Required first, then the optional fields that turn on a filter or a grouping. */
  todo: SetupItem[];
  checked: string[];
}

/** What the host read beside the pipelines. A check it could not make is left out. */
export interface SetupFacts {
  /** Each repo's metadata file, as `loadMetadata()` found it. */
  catalogs?: readonly RepoCatalog[];
  /** Whether the branch policies could be read, for the PR trigger lines. */
  policiesRead?: boolean;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Null until the descriptions have been read: before then every count would read as zero.
 * Archived and disabled pipelines count toward no progress, though an archived one's entry is
 * still read, so its problems are still listed.
 */
export function setupStatus(all: readonly Pipeline[], lines: Lines, facts: SetupFacts): SetupStatus | null {
  if (!all.some((p) => p.facts.purposeSource)) return null;
  const estate = all.filter((p) => !isRetired(p));
  const of = estate.length;
  const count = (test: (p: Pipeline) => unknown) => estate.filter(test).length;
  // A pipeline whose YAML could not be read has unknown, not absent, descriptions.
  const unread = estate.filter((p) => p.facts.yaml?.state === 'unreadable');
  const describable = estate.filter((p) => !p.facts.yaml).length;
  const archived = all.filter((p) => p.facts.archived).length;
  const disabled = all.length - of - archived;

  const owners = count((p) => declared(p.facts.owner));
  const purposes = count((p) => ['catalog', 'derived'].includes(p.facts.purposeSource ?? ''));
  const derived = count((p) => p.facts.purposeSource === 'derived');
  const written = count((p) => p.facts.purposeSource === 'catalog');
  const drafts = count((p) => p.facts.draft);
  // A draft is usually a written purpose, but the mark counts wherever it is found.
  const confirmable = count((p) => p.facts.draft || p.facts.purposeSource === 'catalog');
  const problems = all.filter((p) => p.facts.metadataProblems?.length).length;
  const components = count((p) => declared(p.facts.component));
  const categories = count((p) => declared(p.facts.category));
  const related = lines.suggestions.length;
  // Repos that could not be read at all already show as YAML that could not be read.
  const catalogs = facts.catalogs?.filter((c) => c.readable);
  const fileless = catalogs?.filter((c) => !c.path) ?? [];
  const broken = catalogs?.filter((c) => c.path && c.problems.length) ?? [];
  const orphans = catalogs?.flatMap((c) => c.orphans.map((path) => ({ repo: c.repo, path }))) ?? [];
  const searched = catalogs?.filter((c) => c.foundBy === 'search') ?? [];

  const n = { owners: of - owners, undescribed: describable - purposes };
  const list = <T>(items: readonly T[], phrase: (item: T) => Phrase): Phrase => items.flatMap((item, i) => [...(i ? ['; '] : []), ...phrase(item)]);

  // Each entry is shown only when its condition holds; the order is the order on screen.
  const todo: (SetupItem | false)[] = [
    n.owners > 0 && {
      title: 'Owners',
      detail: [
        `${owners ? plural(n.owners, '1 pipeline names no owner.', `${n.owners} pipelines name no owner.`) : 'No pipeline names an owner.'} With owners, the side panel says who to ask about one.`,
      ],
      progress: { done: owners, of },
    },
    n.undescribed > 0 && {
      title: 'Descriptions',
      detail: [
        plural(
          n.undescribed,
          '1 pipeline has no description, so the page shows a summary of its YAML instead.',
          `${n.undescribed} pipelines have no description, so the page shows a summary of their YAML instead.`,
        ),
      ],
      progress: { done: purposes, of: describable },
    },
    drafts > 0 && {
      title: 'Confirm the drafted descriptions',
      detail: [
        plural(drafts, '1 description is still marked ', `${drafts} descriptions are still marked `),
        { code: '(TODO: verify)' },
        plural(drafts, ', so the side panel tags it draft. Remove the mark once it is checked.', ', so the side panel tags them draft. Remove the mark once one is checked.'),
      ],
      progress: { done: confirmable - drafts, of: confirmable, unit: ' confirmed' },
    },
    problems > 0 && {
      title: 'Fix description problems',
      detail: [plural(problems, '1 description has a problem. The side panel says what to fix.', `${problems} descriptions have problems. Their side panels say what to fix.`)],
    },
    fileless.length > 0 && {
      title: 'Metadata files',
      detail: [
        plural(fileless.length, '1 repo has no ', `${fileless.length} repos have no `),
        { code: CATALOG_NAME },
        ': ',
        ...list(fileless, (c) => [{ code: c.repo }]),
        '. Insights looks in ',
        { code: 'pipelines/' },
        ', then ',
        { code: '.azuredevops/' },
        ', then the repo root.',
      ],
      progress: { done: catalogs!.length - fileless.length, of: catalogs!.length, unit: ' repos' },
    },
    broken.length > 0 && {
      title: 'Fix the metadata files',
      detail: list(broken, (c) => [{ code: `${c.repo}/${c.path}` }, `: ${c.problems.join(' ')}`]),
    },
    orphans.length > 0 && {
      title: 'Entries without a pipeline',
      detail: [
        plural(orphans.length, '1 entry names a YAML that no pipeline uses: ', `${orphans.length} entries name a YAML that no pipeline uses: `),
        ...list(orphans, (o) => [{ code: `${o.repo}: ${o.path}` }]),
        '. Fix the path, or remove the entry.',
      ],
    },
    unread.length > 0 && {
      title: 'YAML that could not be read',
      detail: [
        plural(unread.length, "1 pipeline's YAML could not be read: ", `${unread.length} pipelines' YAML could not be read: `),
        ...unread.flatMap((p, i) => [...(i ? [', '] : []), { code: p.name }]),
        plural(
          unread.length,
          '. Its repo was deleted, or your sign-in cannot open it, so its triggers and description are unknown. Disable or delete it if it is retired.',
          '. Their repo was deleted, or your sign-in cannot open it, so their triggers and descriptions are unknown. Disable or delete any that are retired.',
        ),
      ],
    },
    facts.policiesRead === false && {
      title: 'Branch policies',
      detail: ['They could not be read with your sign-in, so pull request triggers are not shown.'],
    },
    related > 0 && {
      title: 'Components',
      detail: [
        'Declaring ',
        { code: 'component:' },
        ' groups pipelines into lines, and turns on the Component filter. ',
        plural(related, '1 pair already looks related; both side panels say so.', `${related} pairs already look related; their side panels say which.`),
      ],
      progress: { done: components, of },
    },
    !categories && {
      title: 'Categories',
      detail: ['A short slug such as ', { code: 'production' }, '. It turns on the Category filter.'],
      progress: { done: 0, of },
    },
  ];

  const checked: (string | false)[] = [
    !n.undescribed && `${purposes} of ${describable} have a purpose${derived ? ` (${derived} from the YAML's opening comment)` : ''}`,
    lines.lines.length > 0 && plural(lines.lines.length, '1 line found', `${lines.lines.length} lines found`),
    !!catalogs?.length && !fileless.length && plural(catalogs.length, 'The repo has a metadata file', `All ${catalogs.length} repos have a metadata file`),
    ...searched.map((c) => `Found by searching ${c.repo}: ${c.path}`),
    !!catalogs?.length && !broken.length && catalogs.length > fileless.length && 'No problems in metadata files',
    !!catalogs?.length && !orphans.length && catalogs.length > fileless.length && 'Every entry matches a pipeline',
    !problems && 'No problems in descriptions',
    facts.policiesRead === true && 'Branch policies readable',
    !n.owners && 'Every pipeline names an owner',
    !drafts && written > 0 && 'No drafted descriptions left',
    !related && components > 0 && `${components} of ${of} declare a component`,
    categories > 0 && `${categories} of ${of} declare a category`,
    archived + disabled > 0 && `Not counted: ${notCounted(archived, disabled)}`,
  ];

  return { todo: todo.filter((i): i is SetupItem => Boolean(i)), checked: checked.filter((c): c is string => Boolean(c)) };
}
