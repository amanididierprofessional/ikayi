-- ============================================================
-- Ikayi Yange — paste ALL of this once in Supabase SQL Editor
-- Project: ikayi → SQL Editor → New query → Run
-- Does: (1) verify name+phone  (2) set new password in Auth
-- No Edge Function. No CLI.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- Step A: check only (app uses this first)
create or replace function public.verify_phone_name(p_phone text, p_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where length(trim(coalesce(pr.full_name, ''))) > 0
      and lower(trim(regexp_replace(pr.full_name, '\s+', ' ', 'g')))
          = lower(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')))
      and (
        regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g')
          = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
        or regexp_replace(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g'), '^0', '250')
          = regexp_replace(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '^0', '250')
      )
  );
$$;

revoke all on function public.verify_phone_name(text, text) from public;
grant execute on function public.verify_phone_name(text, text) to anon, authenticated;

-- Step B: after verify — set Auth password if name+phone match
create or replace function public.recover_phone_password(
  p_phone text,
  p_name text,
  p_new_password text
)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid uuid;
  v_phone text;
  v_name text;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone := regexp_replace(v_phone, '^0', '250');
  v_name := lower(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));

  if length(v_name) < 1 or length(v_phone) < 8 then
    return json_build_object('ok', false, 'error', 'bad_input');
  end if;

  if p_new_password is null or length(p_new_password) < 6 then
    return json_build_object('ok', false, 'error', 'bad_password');
  end if;

  select pr.id into v_uid
  from public.profiles pr
  where length(trim(coalesce(pr.full_name, ''))) > 0
    and lower(trim(regexp_replace(pr.full_name, '\s+', ' ', 'g'))) = v_name
    and (
      regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g') = v_phone
      or regexp_replace(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g'), '^0', '250') = v_phone
    )
  limit 1;

  if v_uid is null then
    return json_build_object('ok', false, 'error', 'mismatch');
  end if;

  update auth.users
  set
    encrypted_password = crypt(p_new_password, gen_salt('bf')),
    updated_at = now()
  where id = v_uid;

  if not found then
    return json_build_object('ok', false, 'error', 'user_missing');
  end if;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.recover_phone_password(text, text, text) from public;
grant execute on function public.recover_phone_password(text, text, text) to anon, authenticated;

-- Optional check after Run:
-- select id, full_name, phone from public.profiles where full_name <> '' order by updated_at desc;
