-- Records that a superuser downloaded an exit pack, so the audit log shows who took a copy of the data and when.
-- Not applied automatically: run it once in the Supabase SQL editor (or apply as a migration).
-- The exit pack works without it; the download simply is not recorded in the audit log until this exists.
create or replace function public.log_export(p_org uuid, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.role_in(p_org) is distinct from 'superuser' then
    raise exception 'Only a superuser can record a data export' using errcode = '42501';
  end if;
  insert into public.audit_log (organisation_id, table_name, record_id, action, actor_id, actor_label, changed_fields, new_data)
  values (p_org, 'data_export', null, 'UPDATE', auth.uid(),
          (select email from public.profiles where id = auth.uid()),
          array['exit_pack'], coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke all on function public.log_export(uuid, jsonb) from public, anon;
grant execute on function public.log_export(uuid, jsonb) to authenticated;
