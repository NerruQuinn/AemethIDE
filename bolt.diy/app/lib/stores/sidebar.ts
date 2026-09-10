import { atom } from 'nanostores';

/**
 * Shared open/closed state for the chat-history sidebar (Menu).
 * Kept in a store so the Header hamburger and the Menu drawer (which live in
 * different component trees) can drive the same state on every viewport.
 */
export const sidebarStore = atom(false);

export function toggleSidebar() {
  sidebarStore.set(!sidebarStore.get());
}

export function closeSidebar() {
  sidebarStore.set(false);
}
