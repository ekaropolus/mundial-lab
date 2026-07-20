import { HouseMatchBoard } from "../types";

const HOUSE_HISTORY_KEY = "mundial_lab_house_match_board_history";
const HOUSE_HISTORY_LIMIT = 8;

export function loadHouseHistory(): HouseMatchBoard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HOUSE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHouseHistory(board: HouseMatchBoard) {
  const savedBoard = { ...board, saved_at: new Date().toISOString() };
  if (typeof window === "undefined") return [savedBoard];
  const current = loadHouseHistory();
  const next = [savedBoard, ...current].slice(0, HOUSE_HISTORY_LIMIT);
  window.localStorage.setItem(HOUSE_HISTORY_KEY, JSON.stringify(next));
  return next;
}
