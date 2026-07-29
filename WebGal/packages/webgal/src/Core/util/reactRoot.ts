import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const roots = new WeakMap<Element, Root>();

export function renderReact(node: ReactNode, container: Element | null) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(node);
}

export function unmountReact(container: Element | null) {
  if (!container) return;
  roots.get(container)?.unmount();
  roots.delete(container);
}
