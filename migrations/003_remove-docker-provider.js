exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE tenants DROP COLUMN IF EXISTS container_id`);
  pgm.sql(`ALTER TABLE tenants DROP COLUMN IF EXISTS image`);
  pgm.sql(`ALTER TABLE tenants DROP COLUMN IF EXISTS provider`);
  pgm.sql(`ALTER TABLE tenants RENAME COLUMN container_status TO status`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE tenants RENAME COLUMN status TO container_status`);
  pgm.sql(`ALTER TABLE tenants ADD COLUMN provider text NOT NULL DEFAULT 'vps'`);
  pgm.sql(`ALTER TABLE tenants ADD COLUMN container_id text`);
  pgm.sql(`ALTER TABLE tenants ADD COLUMN image text`);
};
