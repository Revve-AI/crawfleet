exports.up = (pgm) => {
  pgm.sql(`
    -- helper function
    create or replace function public.is_admin()
    returns boolean as $$
    begin
      return coalesce((auth.jwt()->'app_metadata'->>'role') = 'admin', false);
    end;
    $$ language plpgsql security definer stable;

    -- tenants
    alter table public.tenants enable row level security;

    create policy "Admins full access" on public.tenants for all to authenticated
      using (public.is_admin()) with check (public.is_admin());

    create policy "Users view own tenants" on public.tenants for select to authenticated
      using (user_id = auth.uid() or email = (auth.jwt()->>'email'));

    -- vps_instances
    alter table public.vps_instances enable row level security;

    create policy "Admins full access" on public.vps_instances for all to authenticated
      using (public.is_admin()) with check (public.is_admin());

    create policy "Users view own" on public.vps_instances for select to authenticated
      using (exists (
        select 1 from public.tenants t
        where t.id = vps_instances.tenant_id
          and (t.user_id = auth.uid() or t.email = (auth.jwt()->>'email'))
      ));

    -- global_settings (admin only)
    alter table public.global_settings enable row level security;

    create policy "Admins only" on public.global_settings for all to authenticated
      using (public.is_admin()) with check (public.is_admin());

    -- audit_logs
    alter table public.audit_logs enable row level security;

    create policy "Admins full access" on public.audit_logs for all to authenticated
      using (public.is_admin()) with check (public.is_admin());

    create policy "Users view own" on public.audit_logs for select to authenticated
      using (exists (
        select 1 from public.tenants t
        where t.id = audit_logs.tenant_id
          and (t.user_id = auth.uid() or t.email = (auth.jwt()->>'email'))
      ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- audit_logs
    drop policy if exists "Users view own" on public.audit_logs;
    drop policy if exists "Admins full access" on public.audit_logs;
    alter table public.audit_logs disable row level security;

    -- global_settings
    drop policy if exists "Admins only" on public.global_settings;
    alter table public.global_settings disable row level security;

    -- vps_instances
    drop policy if exists "Users view own" on public.vps_instances;
    drop policy if exists "Admins full access" on public.vps_instances;
    alter table public.vps_instances disable row level security;

    -- tenants
    drop policy if exists "Users view own tenants" on public.tenants;
    drop policy if exists "Admins full access" on public.tenants;
    alter table public.tenants disable row level security;

    drop function if exists public.is_admin();
  `);
};
