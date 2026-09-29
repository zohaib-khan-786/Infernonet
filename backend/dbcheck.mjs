import Database from 'better-sqlite3';

const db = new Database('./data/freshguard.db', { readonly: true });
const now = Math.floor(Date.now() / 1000);
const ep = (s) => (s ? Math.floor(new Date(s).getTime() / 1000) : null);

console.log('server now epoch:', now);

for (const r of db.prepare('SELECT dev, reported_at, time_valid, thresholds_rev FROM device').all()) {
  const e = ep(r.reported_at);
  console.log(`\n  dev=${r.dev}`);
  console.log(`    device.reported_at = ${r.reported_at}`);
  console.log(`    as epoch           = ${e}`);
  console.log(`    server - that      = ${e === null ? 'n/a' : now - e} s`);
  console.log(`    time_valid=${r.time_valid}  thresholds_rev=${r.thresholds_rev}`);
}

console.log('\n  newest 5 reading rows (reported_at is the DEVICE clock):');
for (const r of db
  .prepare('SELECT reported_at, recorded_at FROM reading ORDER BY id DESC LIMIT 5')
  .all()) {
  const re = ep(r.reported_at);
  const rc = ep(r.recorded_at);
  console.log(
    `    reported_at=${r.reported_at}  recorded_at=${r.recorded_at}  device-server=${re !== null && rc !== null ? re - rc : 'n/a'}`,
  );
}
db.close();
