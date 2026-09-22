/**
 * The one DOM helper the kid overlay needs.
 *
 * Shared rather than copied, so the welcome card and the step card build
 * their elements the same way.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
