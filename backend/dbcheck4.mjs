import Database from "better-sqlite3";
const db = new Database("./data/freshguard.db", { readonly: true });
console.log("  ALL event rows (id, event_id, type, uid):");
for (const r of db.prepare("SELECT id, event_id, type, uid, message FROM event ORDER BY id").all()) {
  console.log(`    row ${r.id}  event_id=${r.event_id}  type=${r.type}  uid=${r.uid ?? "-"}  ${String(r.message).slice(0,44)}`);
}
const dupes = db.prepare("SELECT event_id, COUNT(*) c, GROUP_CONCAT(DISTINCT type) t FROM event GROUP BY event_id HAVING c > 1").all();
console.log(`  event_ids reused by more than one row: ${dupes.length}`);
for (const d of dupes) console.log(`    event_id=${d.event_id}  count=${d.c}  types=${d.t}`);
db.close();
