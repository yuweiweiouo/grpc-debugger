import { writable } from 'svelte/store';
import { STORAGE_KEYS } from './settings';

const DEFAULT_LIST_PANE_WIDTH = 400;

const initialWidth = parseInt(localStorage.getItem(STORAGE_KEYS.LIST_PANE_WIDTH)) || DEFAULT_LIST_PANE_WIDTH;

export const listPaneWidth = writable(initialWidth);

listPaneWidth.subscribe(val => {
  localStorage.setItem(STORAGE_KEYS.LIST_PANE_WIDTH, val.toString());
});
