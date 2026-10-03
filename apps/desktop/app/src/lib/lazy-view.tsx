import { createElement, lazy, Suspense, type ComponentType } from "react";

/**
 * A component loaded from its own chunk the first time it renders, so panels and dialogs that aren't on screen at
 * first paint stay out of the main bundle. Nothing shows while the chunk loads; `preload` fetches it ahead.
 */
export function lazyView<Props extends object>(load: () => Promise<ComponentType<Props>>) {
  const Loaded = lazy(() => load().then((component) => ({ default: component })));
  const View = (props: Props) => (
    <Suspense fallback={null}>{createElement(Loaded as ComponentType<Props>, props)}</Suspense>
  );
  View.preload = () => void load().catch(() => {});
  return View;
}
