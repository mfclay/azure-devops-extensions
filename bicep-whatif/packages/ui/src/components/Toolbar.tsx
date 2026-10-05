import type { StackView } from '../model/estate.js';
import { StackFilterMenu } from './StackFilterMenu.js';

export interface ToolbarProps {
  stacks: readonly StackView[];
  selectedStacks: ReadonlySet<string> | null;
  query: string;
  hideNoise: boolean;
  shown: number;
  total: number;
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
