# Supabase: Oath of Stur's cloud saves

Oath of Stur uses the same Supabase project and the same Google sign-in as Helpdesk
Survivors (HelpDeskSurvivor and HelpDeskSurvivors3D), with a table of its own for saves.
Settings are in `client/src/net/supabase.ts`.

| File | What it does |
| --- | --- |
| `001_oath.sql` | `saves_oath`: one private cloud save per account. Each player can read, write and delete only their own row. |
| `002_oath_online.sql` | `saves_oath_online`: characters in the online world. Only the game server (with the secret key) can read or write them; players can't touch the table. |

## Setting it up (once, about 3 minutes)

1. **SQL Editor:** New query, paste all of `001_oath.sql`, Run. It's safe to run again.
2. **Authentication, URL Configuration, Redirect URLs:** add
   `https://michaelsturrup.com/oathofstur/**`. Without it, Supabase sends players who sign
   in with Google back to the Site URL (the Helpdesk Survivors game) instead of Oath of Stur.
3. Nothing else: the Google provider is already on for the other games.

### For the online world (once)

1. **SQL Editor:** run all of `002_oath_online.sql`.
2. **Project Settings, API Keys:** copy a **secret key** (`sb_secret_...`). Add it to the game
   repo on GitHub as the Actions secret `SUPABASE_SECRET_KEY`; the deploy hands it to the
   server. It must never go in the client or anywhere public.
3. **Redirect URLs:** also add `https://oath-of-stur.fly.dev/**`, so sign-in works on the
   online server's own copy of the game.

## How it works

- Sign-in is optional. Without it the game saves in the browser, as before.
- Signed in, every save (every 30 seconds, and when the tab closes) also goes to the cloud.
  Opening the game on another device after signing in there loads the cloud character.
- When this browser and the cloud both changed since they last synced (played on two
  devices), the game asks which character to keep, and offers to export the other first.
- An account is the same Google account as in Helpdesk Survivors, but progress is separate.

## Testing the SQL without the live project

`local-test/` runs the file on a plain Postgres with Supabase's roles and `auth.uid()`
faked, then tries what a player could do (save, save twice, write or read someone else's
save, delete, read while signed out). Each step says whether it should work or fail.

```sh
createdb t
psql -d t -f local-test/fake-supabase.sql -f 001_oath.sql -f local-test/check.sql
```
