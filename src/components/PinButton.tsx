import { isPinned, togglePin, useShelfData, type ShelfItem, type ShelfKind } from '../shelves';

/** The "put it on the shelf" star that sits on every case in the cabinet. */
export function PinButton({ kind, item }: { kind: ShelfKind; item: ShelfItem }) {
  useShelfData();
  const on = isPinned(kind, item);
  return (
    <button
      type="button"
      className={`pin ${on ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        togglePin(kind, item);
      }}
      title={on ? 'Take off the shelf' : 'Put on the shelf'}
      aria-pressed={on}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
