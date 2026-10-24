/** Single source for keyboard shortcuts: the docs page and the in-app "?" sheet both render this. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

export interface Shortcut {
  keys: string[];
  action: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Anywhere in the app',
    items: [
      { keys: [MOD, 'K'], action: 'Open the command palette: search documents and diagrams, run commands' },
      { keys: ['?'], action: 'Show keyboard shortcuts' },
    ],
  },
  {
    title: 'Diagram canvas',
    items: [
      { keys: ['V'], action: 'Select tool' },
      { keys: ['R'], action: 'Rectangle tool' },
      { keys: ['O'], action: 'Ellipse tool' },
      { keys: ['T'], action: 'Text tool' },
      { keys: ['C'], action: 'Connector tool (click two shapes)' },
      { keys: ['Enter'], action: 'Edit the selected shape’s text' },
      { keys: ['Delete'], action: 'Delete the selection (in a state: hide it there)' },
      { keys: ['Esc'], action: 'Clear selection / cancel the current tool' },
      { keys: ['←', '↑', '→', '↓'], action: 'Nudge the selection 1px (hold Shift for 10px)' },
      { keys: [MOD, 'A'], action: 'Select all' },
      { keys: [MOD, 'D'], action: 'Duplicate the selection' },
      { keys: ['+', '−'], action: 'Zoom in / out' },
      { keys: ['0'], action: 'Zoom to fit' },
      { keys: ['Alt', 'drag'], action: 'Pan (or use the scroll wheel)' },
    ],
  },
  {
    title: 'Markdown editor',
    items: [
      { keys: [MOD, 'B'], action: 'Bold' },
      { keys: [MOD, 'I'], action: 'Italic' },
      { keys: [MOD, 'E'], action: 'Inline code' },
      { keys: [MOD, 'S'], action: 'Save now (Clara also saves as you type)' },
    ],
  },
  {
    title: 'Present mode',
    items: [
      { keys: ['←', '→'], action: 'Previous / next state' },
      { keys: ['Space'], action: 'Play or pause auto-advance' },
      { keys: ['Esc'], action: 'Exit' },
    ],
  },
  {
    title: 'Playground',
    items: [
      { keys: [MOD, 'S'], action: 'Copy a share link to this diagram' },
      { keys: ['Tab'], action: 'Indent in the code editor (Esc, then Tab, to move focus on)' },
    ],
  },
];
