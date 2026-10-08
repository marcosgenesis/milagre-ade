/** Searchable choices wait here because a native sheet route cannot carry callbacks. */
type ChoiceItem = { id: string; title: string; subtitle?: string; checked?: boolean; disabled?: boolean };
type ChoiceRequest = { title: string; placeholder: string; emptyLabel: string; items: ChoiceItem[]; onSelect: (id: string) => void };
type ChoiceRequestEntry = Omit<ChoiceRequest, "onSelect"> & { choose: (id: string | null) => void };

let current: ChoiceRequestEntry | null = null;
let present: (() => void) | null = null;

export function setChoicePresenter(open: () => void) {
  present = open;
}
export function currentChoice() {
  return current;
}

export function showChoiceSheet({ onSelect, ...request }: ChoiceRequest) {
  current?.choose(null);
  let done = false;
  const entry: ChoiceRequestEntry = {
    ...request,
    choose(id) {
      if (done) return;
      done = true;
      if (current === entry) current = null;
      if (id !== null && request.items.some((item) => item.id === id && !item.disabled)) onSelect(id);
    },
  };
  current = entry;
  present?.();
}
