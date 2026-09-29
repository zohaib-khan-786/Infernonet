import { connect } from 'mqtt';
const c = connect('mqtt://127.0.0.1:1883', { username: process.argv[2], password: process.argv[3], clientId: 'credtest-'+Date.now(), connectTimeout: 6000 });
c.on('connect', () => { console.log('  device creds ACCEPTED'); c.end(); process.exit(0); });
c.on('error', (e) => { console.log('  device creds REJECTED:', e.message); process.exit(0); });
setTimeout(()=>{console.log('  timeout');process.exit(0);},9000);
