import type { WorktreeTranslate } from '../surface/types.js';
import type { RelativeTime, SessionStatusPresentation } from './session-view.js';

/** Localize the native-compatible Session status used by both surfaces. */
export function sessionStatusLabel(
  t: WorktreeTranslate,
  status: SessionStatusPresentation,
): string {
  switch (status.labelKey) {
    case 'running':
      return t('session.status.running');
    case 'subagentsRunning':
      return t(
        status.runningSubagentCount === 1
          ? 'session.status.subagentsRunning.one'
          : 'session.status.subagentsRunning.other',
        { n: status.runningSubagentCount },
      );
    case 'idle':
      return t('session.status.idle');
    case 'waitingApproval':
      return t('session.status.waitingApproval');
    case 'planReview':
      return t('session.status.planReview');
    case 'waitingAnswer':
      return t('session.status.waitingAnswer');
    case 'completed':
      return t('session.status.completed');
  }
}

/** Localize the compact relative time shown for idle Sessions. */
export function sessionTimeLabel(t: WorktreeTranslate, value: RelativeTime): string {
  switch (value.unit) {
    case 'now':
      return t('session.time.now');
    case 'minutes':
      return t('session.time.minutes', { n: value.n });
    case 'hours':
      return t('session.time.hours', { n: value.n });
    case 'days':
      return t('session.time.days', { n: value.n });
    case 'months':
      return t('session.time.months', { n: value.n });
    case 'years':
      return t('session.time.years', { n: value.n });
  }
}

/** Include the native relative-time suffix used in Session hover details. */
export function sessionHoverTimeLabel(t: WorktreeTranslate, value: RelativeTime): string {
  const label = sessionTimeLabel(t, value);
  return value.unit === 'now' ? label : t('session.time.ago', { t: label });
}
