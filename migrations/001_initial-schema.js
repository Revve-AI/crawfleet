exports.up = (pgm) => {
  pgm.sql(`
    create extension if not exists "pgcrypto";

    -- tenants
    create table public.tenants (
      id                 uuid primary key default gen_random_uuid(),
      user_id            uuid references auth.users(id) on delete set null,
      slug               text not null unique,
      display_name       text not null,
      email              text,
      enabled            boolean not null default true,
      container_id       text,
      container_status   text not null default 'stopped',
      access_app_id      text,
      image              text,
      env_overrides      jsonb,
      gateway_token      text not null,
      provider           text not null default 'docker' check (provider in ('docker', 'vps')),
      last_health_check  timestamptz,
      last_health_status text,
      created_at         timestamptz not null default now(),
      updated_at         timestamptz not null default now()
    );

    create index idx_tenants_user_id on public.tenants(user_id);
    create index idx_tenants_email on public.tenants(email);

    -- auto updated_at trigger
    create or replace function public.set_updated_at()
    returns trigger as $$
    begin new.updated_at = now(); return new; end;
    $$ language plpgsql;

    create trigger tenants_updated_at before update on public.tenants
      for each row execute function public.set_updated_at();

    -- vps_instances
    create table public.vps_instances (
      id           uuid primary key default gen_random_uuid(),
      tenant_id    uuid not null unique references public.tenants(id) on delete cascade,
      cloud        text not null,
      region       text not null,
      instance_id  text not null,
      machine_type text not null,
      external_ip  text,
      tunnel_id    text,
      tunnel_token text,
      git_tag      text,
      ssh_user     text not null default 'openclaw',
      ssh_port     integer not null default 22,
      vm_status    text not null default 'creating' check (vm_status in ('creating','running','stopped','error','destroying')),
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now()
    );

    create index idx_vps_instances_tenant_id on public.vps_instances(tenant_id);
    create trigger vps_instances_updated_at before update on public.vps_instances
      for each row execute function public.set_updated_at();

    -- global_settings
    create table public.global_settings (
      key        text primary key,
      value      text not null,
      updated_at timestamptz not null default now()
    );

    create trigger global_settings_updated_at before update on public.global_settings
      for each row execute function public.set_updated_at();

    -- audit_logs
    create table public.audit_logs (
      id         uuid primary key default gen_random_uuid(),
      tenant_id  uuid references public.tenants(id) on delete set null,
      action     text not null,
      details    jsonb,
      created_at timestamptz not null default now()
    );

    create index idx_audit_logs_tenant_id on public.audit_logs(tenant_id);
    create index idx_audit_logs_created_at on public.audit_logs(created_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table if exists public.audit_logs cascade;
    drop table if exists public.global_settings cascade;
    drop table if exists public.vps_instances cascade;
    drop table if exists public.tenants cascade;
    drop function if exists public.set_updated_at() cascade;
  `);
};
