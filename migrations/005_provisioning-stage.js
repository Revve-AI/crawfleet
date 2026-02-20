exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE vps_instances ADD COLUMN provision_stage text;

    ALTER TABLE vps_instances DROP CONSTRAINT IF EXISTS vps_instances_vm_status_check;
    ALTER TABLE vps_instances ADD CONSTRAINT vps_instances_vm_status_check
      CHECK (vm_status IN ('creating','running','stopped','error','destroying','provisioning_failed'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE vps_instances DROP COLUMN IF EXISTS provision_stage;

    ALTER TABLE vps_instances DROP CONSTRAINT IF EXISTS vps_instances_vm_status_check;
    ALTER TABLE vps_instances ADD CONSTRAINT vps_instances_vm_status_check
      CHECK (vm_status IN ('creating','running','stopped','error','destroying'));
  `);
};
