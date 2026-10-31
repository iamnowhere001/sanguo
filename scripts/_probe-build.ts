import { buildSeedDocument } from '../src/studio/seed';
import { runStructBuild } from '../src/studio/gateBuild';

const doc = buildSeedDocument();
const r = runStructBuild(doc);
console.log('ms', r.ms, 'sites', Object.keys(r.sites).length, 'issues', r.issues.length, 'failures', r.failures.length, 'skipped', r.skipped.length);
for (const f of r.failures.slice(0, 8)) console.log(' F', f);
for (const i of r.issues.slice(0, 8)) console.log(' I', i.ref.kind, i.ref.id, i.short, '|', i.text);
