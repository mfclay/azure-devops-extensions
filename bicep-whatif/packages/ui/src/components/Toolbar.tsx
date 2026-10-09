import type { StackView } from '../model/estate.js';
import type { Layout } from '../model/view.js';
import { StackFilterMenu } from './StackFilterMenu.js';

export interface ToolbarProps {
  stacks: readonly StackView[];
  selectedStacks: ReadonlySet<string> | null;
  query: string;
  hideNoise: boolean;
  shown: number;
  total: number;
  layout: Layout;
  /** Whether any stack is open, which turns "Expand all" into "Collapse all". */
  anyOpen: boolean;
  onLayout: (layout: Layout) => void;
  onExpandAll: (expand: boolean) => void;
  onQuery: (q: string) => void;
  onStacks: (keys: string[]) => void;
  onHideNoise: (value: boolean) => void;
  onReset: () => void;
}

export function Toolbar(props: ToolbarProps): React.ReactElement {
  const filtered = props.total - props.shown;
  return (
    <div className="toolbar">
      <input
        className="toolbar__search"
        type="search"
        placeholder="Search resources, types and property paths"
        value={props.query}
        onChange={(e) => {
          props.onQuery(e.target.value);
        }}
      />

      <div className="seg" role="group" aria-label="Layout">
        <button
          type="button"
          aria-pressed={props.layout === 'stacks'}
          onClick={() => {
            props.onLayout('stacks');
          }}
        >
          By stack
        </button>
        <button
          type="button"
          aria-pressed={props.layout === 'resources'}
          onClick={() => {
            props.onLayout('resources');
          }}
        >
          All resources
        </button>
      </div>

      <StackFilterMenu stacks={props.stacks} selected={props.selectedStacks} onChange={props.onStacks} />

      {/*
        Decision C4: Azure's own baseline beats any hardcoded blocklist, so this
        is a thin toggle rather than a noise engine — and it is off by default,
        because hiding a real change is the one failure that destroys trust.
      */}
      <label className="toggle">
        <input
          type="checkbox"
          checked={props.hideNoise}
          onChange={(e) => {
            props.onHideNoise(e.target.checked);
          }}
        />
        Hide unchanged properties
      </label>

      <span className="toolbar__spacer" />

      {props.layout === 'stacks' && (
        <button
          type="button"
          className="linkbtn linkbtn--bar"
          onClick={() => {
            props.onExpandAll(!props.anyOpen);
          }}
        >
          {props.anyOpen ? 'Collapse all' : 'Expand all'}
        </button>
      )}

      <span className="toolbar__status">
        {props.shown} of {props.total} shown
        {filtered > 0 ? ` · ${filtered} filtered out` : ''}
      </span>

      <button type="button" className="btn" onClick={props.onReset}>
        Reset
      </button>
    </div>
  );
}
