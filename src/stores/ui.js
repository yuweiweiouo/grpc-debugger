/**
 * UI 導航狀態管理
 */
import { writable } from 'svelte/store';

export const activePage = writable('network'); // 'network' | 'services' | 'playground' | 'settings'

export function navigate(page) {
  activePage.set(page);
}
