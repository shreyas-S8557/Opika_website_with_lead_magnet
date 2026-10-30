#!/usr/bin/env node
// Optional: the site now does this itself on its first submission (see ensureSetup in lib/mailerlite.js).
// Run it if you want the fields and group to exist before then.
//   node lead-magnet/scripts/setup-mailerlite.js   (reads MAILERLITE_API_KEY from .env)
require('../lib/env');
const { client, LM_FIELDS, LEAD_FIELDS, GROUP_NAME } = require('../lib/mailerlite');

(async () => {
  const ml = client();
  const created = await ml.ensureFields([...LM_FIELDS, ...LEAD_FIELDS]);
  console.log(created.length ? `✓ Created fields: ${created.join(', ')}` : '✓ Fields already exist');
  const group = await ml.ensureGroup(GROUP_NAME);
  console.log(`✓ Group "${group.name}" → id ${group.id}`);
  console.log(`\n(Optional) MAILERLITE_GROUP_ID=${group.id}. The site finds the group by name if this isn't set.`);
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
