/**
 * Cloud saves through Supabase: the same project and the same Google sign-in as
 * Michael's other games (HelpDeskSurvivor, HelpDeskSurvivors3D), with Oath of Stur's own
 * table (supabase/001_oath.sql). The publishable key is meant to be public: row level
 * security lets each account read and write only its own save.
 */
export const SUPABASE = {
  url: 'https://abeqdmurddrkrqbnfylb.supabase.co',
  key: 'sb_publishable_8WUpbX-clRvdKgset72mkQ_C_NFL5E8',
  saves: 'saves_oath',
  /** ms before a request counts as failed (the game then plays from this browser's save). */
  timeout: 8000,
};
