-- Apply before releasing clients that sync deletion markers.
begin;

create table if not exists public.credit_party_deletions (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id bigint not null,
  primary key (user_id, local_id)
);
alter table public.credit_party_deletions enable row level security;
revoke all on public.credit_party_deletions from anon, authenticated;
grant select, insert on public.credit_party_deletions to authenticated;

drop policy if exists own_deletions_read on public.credit_party_deletions;
create policy own_deletions_read on public.credit_party_deletions for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists own_deletions_insert on public.credit_party_deletions;
create policy own_deletions_insert on public.credit_party_deletions for insert
  to authenticated with check ((select auth.uid()) = user_id);

create index if not exists debts_user_party_idx on public.debts (user_id, party_local_id);
create index if not exists payments_user_party_idx on public.payments (user_id, party_local_id);

create or replace function public.apply_ikayi_credit_deletion()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text), hashtext(new.local_id::text));
  delete from public.debts where user_id = new.user_id and party_local_id = new.local_id;
  delete from public.payments where user_id = new.user_id and party_local_id = new.local_id;
  delete from public.parties where user_id = new.user_id and local_id = new.local_id;
  return null;
end;
$$;

create or replace function public.ignore_deleted_ikayi_credit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  party_id bigint;
begin
  if (select auth.uid()) is distinct from new.user_id then
    return new;
  end if;
  if tg_table_name = 'parties' then
    party_id := new.local_id;
  else
    party_id := new.party_local_id;
  end if;
  perform pg_advisory_xact_lock(hashtext(new.user_id::text), hashtext(party_id::text));
  if exists (
    select 1 from public.credit_party_deletions d
    where d.user_id = new.user_id and d.local_id = party_id
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.apply_ikayi_credit_deletion() from public;
revoke all on function public.ignore_deleted_ikayi_credit() from public;

drop trigger if exists apply_ikayi_credit_deletion on public.credit_party_deletions;
create trigger apply_ikayi_credit_deletion after insert on public.credit_party_deletions
for each row execute function public.apply_ikayi_credit_deletion();

drop trigger if exists ignore_deleted_ikayi_credit on public.parties;
create trigger ignore_deleted_ikayi_credit before insert or update on public.parties
for each row execute function public.ignore_deleted_ikayi_credit();
drop trigger if exists ignore_deleted_ikayi_credit on public.debts;
create trigger ignore_deleted_ikayi_credit before insert or update on public.debts
for each row execute function public.ignore_deleted_ikayi_credit();
drop trigger if exists ignore_deleted_ikayi_credit on public.payments;
create trigger ignore_deleted_ikayi_credit before insert or update on public.payments
for each row execute function public.ignore_deleted_ikayi_credit();

commit;
