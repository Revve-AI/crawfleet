exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE tenants ADD COLUMN user_ssh_public_key text`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE tenants DROP COLUMN IF EXISTS user_ssh_public_key`);
};
