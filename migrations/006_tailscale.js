exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tenants ADD COLUMN access_mode text NOT NULL DEFAULT 'private'
      CHECK (access_mode IN ('private', 'funnel'));
    ALTER TABLE tenants ADD COLUMN tailscale_api_key text;
    ALTER TABLE tenants ADD COLUMN tailscale_tailnet text;

    ALTER TABLE vps_instances ADD COLUMN tailscale_device_id text;
    ALTER TABLE vps_instances ADD COLUMN tailscale_ip text;
    ALTER TABLE vps_instances ADD COLUMN tailscale_hostname text;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE vps_instances DROP COLUMN IF EXISTS tailscale_hostname;
    ALTER TABLE vps_instances DROP COLUMN IF EXISTS tailscale_ip;
    ALTER TABLE vps_instances DROP COLUMN IF EXISTS tailscale_device_id;

    ALTER TABLE tenants DROP COLUMN IF EXISTS tailscale_tailnet;
    ALTER TABLE tenants DROP COLUMN IF EXISTS tailscale_api_key;
    ALTER TABLE tenants DROP COLUMN IF EXISTS access_mode;
  `);
};
