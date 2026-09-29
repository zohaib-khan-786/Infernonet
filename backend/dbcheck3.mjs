import Database from "better-sqlite3";
const db = new Database("./data/freshguard.db", { readonly: true });
const cols = db.prepare("PRAGMA table_info(reading)").all().map(r => r.name);
console.log("  reading columns:", cols.join(", "));
const has = (c) => cols.includes(c);
const pick = ["seq","device_seq","snapshot_seq"].find(c => has(c));
const last = db.prepare("SELECT * FROM reading ORDER BY id DESC LIMIT 1").get();
if (last) {
  for (const k of ["seq","device_seq","snapshot_seq","received_at","recorded_at"].filter(has)) {
    console.log(`  newest reading ${k} = ${last[k]}`);
  }
} else console.log("  (reading table empty)");
const d = db.prepare("SELECT reported_at, received_at, thresholds_rev FROM device").get();
console.log("  device row:", JSON.stringify(d));
const n = db.prepare("SELECT COUNT(*) c FROM reading").get();
console.log("  total readings:", n.c);
db.close();
