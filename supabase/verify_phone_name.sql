-- Run once in Supabase SQL Editor (Ikayi project)
-- Allows checking name+phone for recovery WITHOUT logging the user in.

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

-- Check names are saved (you run this as yourself in SQL Editor):
-- select id, full_name, phone from public.profiles order by updated_at desc limit 20;
