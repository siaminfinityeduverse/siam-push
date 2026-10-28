// Siam Infinity EduVerse - free server-side auto push (runs on GitHub Actions).
// Every run polls ~4 times (once a minute): exam published -> all Allow devices,
// result published -> only that student's device. Nothing needs to stay open on your PC.
const admin = require('firebase-admin');
const { events, buildJobs, hash } = require('./logic');

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('FIREBASE_SERVICE_ACCOUNT secret is missing'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore();

async function once() {
  const now = Date.now();
  const doc = await db.collection('exams').doc('all_exams').get();
  if (!doc.exists) return console.log('no exams doc');
  const exams = (doc.data() || {}).exams || {};
  if (!Object.keys(exams).length) return console.log('no exams');

  const ev = events(exams, now);
  const map = new Map(); ev.out.forEach(e => map.set(hash(e.id), e));
  const inact = ev.inactive.map(hash);
  const ref = db.collection('push_config').doc('auto');

  let claimed = [], baseline = false;
  await db.runTransaction(async tx => {
    claimed = []; baseline = false;
    const snap = await tx.get(ref);
    if (!snap.exists) { baseline = true; tx.set(ref, { enabled: true, sent: [...map.keys()], createdMs: now }); return; }
    const d = snap.data(); if (d.enabled === false) return;
    const sent = new Set(d.sent || []); let changed = false;
    inact.forEach(x => { if (sent.delete(x)) changed = true; });
    map.forEach((e, x) => { if (!sent.has(x)) { claimed.push(Object.assign({ h: x }, e)); sent.add(x); changed = true; } });
    if (changed) tx.update(ref, { sent: [...sent], updatedMs: now });
  });
  if (baseline) return console.log('first run: existing items marked as already known');
  if (!claimed.length) return console.log('nothing new');

  const ts = await db.collection('push_tokens').get();
  const toks = ts.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(t => t.token && t.active !== false);
  const jobs = buildJobs(claimed, toks);
  console.log('events', claimed.length, 'devices', toks.length, 'messages', jobs.length);
  if (!jobs.length) return;

  let sent = 0, failed = 0, firstErr = '';
  for (let i = 0; i < jobs.length; i += 100) {
    await Promise.all(jobs.slice(i, i + 100).map(async j => {
      try {
        await admin.messaging().send({ token: j.t.token, data: j.data, webpush: { headers: { TTL: '86400', Urgency: 'high' } } });
        sent++;
      } catch (e) {
        failed++; if (!firstErr) firstErr = e.message || String(e);
        if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(e.code || '')) {
          await db.collection('push_tokens').doc(j.t.id).set({ active: false, token: '' }, { merge: true }).catch(() => {});
        }
      }
    }));
  }
  console.log('sent', sent, 'failed', failed, firstErr);
  await db.collection('broadcasts').add({
    title: 'Siam Infinity EduVerse', body: '🖥️ Server Auto Push — ' + claimed.length + ' টি ইভেন্ট',
    createdMs: Date.now(), showPush: true, showBanner: false, bannerActive: false, bannerUntilMs: 0, dismissible: false,
    auto: true, pushTotal: jobs.length, pushSent: sent, pushFailed: failed, status: 'done', lastError: firstErr
  });
  if (!sent && failed) await ref.update({ sent: admin.firestore.FieldValue.arrayRemove(...claimed.map(c => c.h)) }).catch(() => {});
}

(async () => {
  const rounds = Number(process.env.ROUNDS || 4);
  for (let i = 0; i < rounds; i++) {
    try { await once(); } catch (e) { console.error('round error:', e.message); }
    if (i < rounds - 1) await new Promise(r => setTimeout(r, 60000));
  }
  process.exit(0);
})();
