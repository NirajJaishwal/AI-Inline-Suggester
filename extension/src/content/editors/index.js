import { nativeControlAdapter } from "./nativeControl.js";
import { contenteditableAdapter } from "./contenteditable.js";

export const editorSelector = nativeControlAdapter.selector + ", " + contenteditableAdapter.selector;
export function resolveEditorAdapter(candidate) {
  if (nativeControlAdapter.resolveOwner(candidate)) return nativeControlAdapter;
  return contenteditableAdapter.resolveOwner(candidate) ? contenteditableAdapter : null;
}
export function resolveEditorOwner(candidate) {
  return resolveEditorAdapter(candidate)?.resolveOwner(candidate) || null;
}
