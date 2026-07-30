export function mustQuery<T extends Element = Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Expected element matching ${selector}`);
  return element;
}

export function mustQueryAll<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function asInput(element: Element): HTMLInputElement {
  return element as HTMLInputElement;
}
