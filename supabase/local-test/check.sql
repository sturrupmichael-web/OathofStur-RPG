-- Tries what a player could do to saves_oath. Each step says whether it should work.
\set ON_ERROR_STOP 0
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo 'A saves (should work):'
insert into public.saves_oath (data) values ('{"name":"A"}') returning user_id;
\echo 'A saves again as a second row (should fail: one per account):'
insert into public.saves_oath (data) values ('{"name":"A2"}');
\echo 'A writes a row for B (should fail):'
insert into public.saves_oath (user_id, data) values ('22222222-2222-2222-2222-222222222222', '{"name":"fake"}');
\echo 'A updates their save (should work, 1 row):'
update public.saves_oath set data = '{"name":"A","x":1}';

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo 'B reads (should see 0 rows):'
select count(*) from public.saves_oath;
\echo 'B updates A save (should change 0 rows):'
update public.saves_oath set data = '{"hacked":true}' where user_id = '11111111-1111-1111-1111-111111111111';
\echo 'B deletes A save (should delete 0 rows):'
delete from public.saves_oath where user_id = '11111111-1111-1111-1111-111111111111';
\echo 'B saves (should work):'
insert into public.saves_oath (data) values ('{"name":"B"}') returning user_id;
\echo 'B deletes their own save (should delete 1 row):'
delete from public.saves_oath;

set role anon;
\echo 'Signed out reads (should fail: permission denied):'
select count(*) from public.saves_oath;
reset role;
\echo 'Left (should be A with x=1 only):'
select user_id, data from public.saves_oath;

-- saves_oath_online (002): only the game server, never a player.
reset role;
insert into public.saves_oath_online (user_id, data) values ('11111111-1111-1111-1111-111111111111', '{"name":"A"}');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo 'A reads their online character (should fail: permission denied):'
select count(*) from public.saves_oath_online;
\echo 'A edits their online character (should fail: permission denied):'
update public.saves_oath_online set data = '{"name":"A","rich":true}';
set role anon;
\echo 'Signed out reads online characters (should fail: permission denied):'
select count(*) from public.saves_oath_online;
