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

-- Restrictive policies run alongside the existing account-owner policies.
drop policy if exists hide_deleted_parties on public.parties;
create policy hide_deleted_parties on public.parties as restrictive for select
  to authenticated using (not exists (
    select 1 from public.credit_party_deletions d
    where d.user_id = parties.user_id and d.local_id = parties.local_id
  ));

drop policy if exists hide_deleted_debts on public.debts;
create policy hide_deleted_debts on public.debts as restrictive for select
  to authenticated using (not exists (
    select 1 from public.credit_party_deletions d
    where d.user_id = debts.user_id and d.local_id = debts.party_local_id
  ));

drop policy if exists hide_deleted_payments on public.payments;
create policy hide_deleted_payments on public.payments as restrictive for select
  to authenticated using (not exists (
    select 1 from public.credit_party_deletions d
    where d.user_id = payments.user_id and d.local_id = payments.party_local_id
  ));

revoke delete on public.parties, public.debts, public.payments from public, anon, authenticated;

-- Retire the physical-delete trigger if an earlier draft was installed.
drop trigger if exists apply_ikayi_credit_deletion on public.credit_party_deletions;
drop function if exists public.apply_ikayi_credit_deletion();

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
  if exists (
    select 1 from public.credit_party_deletions d
    where d.user_id = new.user_id and d.local_id = party_id
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.ignore_deleted_ikayi_credit() from public;

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
