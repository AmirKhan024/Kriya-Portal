/**
 * Watch-completion logic (feature 3a). Pure + unit-tested. The client tracks the
 * HTML5 <video> progress and records an activity-session once watched ≥ this %.
 */
import { WATCH_COMPLETE_PCT } from './constants';

export function isWatchComplete(percent: number): boolean {
  return percent >= WATCH_COMPLETE_PCT;
}
