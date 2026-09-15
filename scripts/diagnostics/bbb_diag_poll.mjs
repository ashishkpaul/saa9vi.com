// Timing poll for a single meeting ID — read-only.
// DIAGNOSTIC-ONLY: reads .env / DB-derived inputs; not an application pattern.
import { readFileSync } from 'fs';
import crypto from 'crypto';
const env = Object.fromEntries(readFileSync('/home/ashish/edu/saa9vi_com/.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const apiUrl = process.argv[2];
const meetingId = process.argv[3];
const enc = process.argv[4];
function decrypt(b64){const buf=Buffer.from(b64,'base64');const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(env.BBB_ENCRYPTION_KEY,'hex'),buf.subarray(0,12));d.setAuthTag(buf.subarray(12,28));return d.update(buf.subarray(28)).toString('utf8')+d.final('utf8');}
const secret = decrypt(enc);
for (const delay of [0,1000,3000,10000,30000]) {
  if (delay) await new Promise(r=>setTimeout(r,delay));
  const qs = new URLSearchParams({ meetingID: meetingId }).toString();
  const ck = crypto.createHash('sha256').update('getMeetingInfo'+qs+secret).digest('hex');
  try {
    const res = await (await fetch(`${apiUrl.replace(/\/$/,'')}/api/getMeetingInfo?${qs}&checksum=${ck}`)).text();
    const ok = res.includes('SUCCESS');
    console.log(`t+${delay}ms: ${ok ? 'SUCCESS ' + res.match(/<meetingName>([^<]*)/)?.[1] : res.replace(/\s+/g,' ').slice(0,150)}`);
  } catch(e){ console.log(`t+${delay}ms: FETCH ERROR ${e.message}`); }
}
