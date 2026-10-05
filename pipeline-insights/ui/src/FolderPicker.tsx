import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { folderTitle } from './format.js';
import type { FolderOption } from './scope.js';

interface Props {
  /** From `folderOptions()`. */
  options: FolderOption[];
  folder: string | null;
  /** Every pipeline, for "All folders". */
  total: number;
  onPick(folder: string | null): void;
}

/**
 * The folder half of the heading: the folder in view, or "All folders", opening a menu of every
 * folder with its pipeline count, subfolders indented under their parent.
 */
export function FolderPicker({ options, folder, total, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const pick = (f: string | null) => {
    setOpen(false);
    button.current?.focus();
    if (f !== folder) onPick(f);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => items[(to + items.length) % items.length]?.focus();
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(-1);
    else return;
    e.preventDefault();
  };

  const item = (f: string | null, name: string, count: number, depth = 0) => (
    <button
      key={f ?? ''}
      type="button"
      role="menuitemradio"
      aria-checked={f === folder}
      className="pi-menu-item"
      aria-label={`${name}, ${count} ${count === 1 ? 'pipeline' : 'pipelines'}`}
      style={depth ? { paddingLeft: 12 + depth * 16 } : undefined}
      onClick={() => pick(f)}
    >
      <span>{name}</span>
      <span className="pi-num pi-faint">{count}</span>
    </button>
  );

  return (
    <span className="pi-picker-wrap" ref={root}>
      <button
        ref={button}
        type="button"
        className={folder ? 'pi-picker' : 'pi-picker pi-picker-all'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Folder: ${folder ? folderTitle(folder) : 'All folders'}`}
        onClick={() => setOpen(!open)}
      >
        {folder ? folderTitle(folder) : 'All folders'}
        <Caret />
      </button>
      {open && (
        <div className="pi-menu" role="menu" aria-label="Folders" ref={menu} onKeyDown={onKeyDown}>
          {item(null, 'All folders', total)}
          <hr />
          {options.map((o) => item(o.folder, o.name, o.count, o.depth))}
        </div>
      )}
    </span>
  );
}

export function Caret() {
  return (
    <svg className="pi-caret" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
