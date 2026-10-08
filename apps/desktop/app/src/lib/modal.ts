/**
 * What's open on top of the app: a native dialog shown with showModal (the command palette, the image viewer)
 * or a panel marked aria-modal (the commit dialog, the handoff brief). Approval and question cards and the
 * chip popovers use role="dialog" too, but they are not modal: the app's shortcuts keep working over them.
 */
const MODAL_SELECTOR = 'dialog[open], [aria-modal="true"]';

/** The open modal, if any. */
export function openModal(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(MODAL_SELECTOR);
}

export function isModalOpen(root: ParentNode = document): boolean {
  return openModal(root) !== null;
}
