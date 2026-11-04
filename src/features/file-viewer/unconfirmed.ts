import { VIEWER_UNCONFIRMED } from '../../shared/platform/refusals';

/**
 * The refusal of a viewer request because the background has not confirmed the sign-in cookie
 * for the student yet (decision 11). It differs from every other refusal, because a check that
 * runs once more can lift it.
 */
export class ViewerUnconfirmedError extends Error {
  constructor(message = VIEWER_UNCONFIRMED) {
    super(message);
    this.name = 'ViewerUnconfirmedError';
  }
}
