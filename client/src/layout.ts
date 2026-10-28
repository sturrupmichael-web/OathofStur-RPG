/**
 * Screen shapes that change the layout. Keep these in step with the media
 * queries in styles.css.
 */

/** A phone held on its side: short and wide. */
export const SIDEWAYS_PHONE = '(orientation: landscape) and (max-height: 500px)';

/** Any phone layout, upright or sideways: the panels open as a sheet. */
export const PHONE = `(max-width: 720px), ${SIDEWAYS_PHONE}`;
