// Pure logic (same rules as the Admin panel) - decides which exams / results are "published".
const TZ = '+06:00'; // Bangladesh time: exam dates in the admin panel are typed in local time

const ms = (d, t) => new Date(`${d}T${t}:00${TZ}`).getTime();

function autoPubAtMs(exam) {
  const a = exam && exam.autoPublish;
  if (!a || !a.enabled) return null;
  if (a.mode === 'at') return a.atMs || null;
  const s = ms(exam.startDate || '', exam.startTime || '10:00');
  if (isNaN(s)) return null;
  return s - (a.minutesBefore || 0) * 60000;
}

function effStatus(exam, now) {
  let st = exam.status;
  if (st === 'draft') {
    const ap = autoPubAtMs(exam);
    if (ap !== null && now >= ap) st = 'published'; else return 'draft';
  }
  if (st === 'published' || st === 'ended') {
    const end = ms(exam.endDate || '2026-07-24', exam.endTime || '22:00') + (exam.timeExtension || 0) * 60000;
    return now > end ? 'ended' : 'published';
  }
  return exam.status;
}

function effKeys(exam, now) {
  const pk = Object.assign({}, exam.publishedResultKeys || {});
  if (exam.autoResultAt && now >= exam.autoResultAt) {
    Object.entries(exam.results || {}).forEach(([k, r]) => {
      if (pk[k] === false) return;
      const t = (r && (r.submittedAtMs || Date.parse(r.submittedAt || ''))) || 0;
      if (!t || t <= exam.autoResultAt) pk[k] = true;
    });
  }
  return pk;
}

function hash(str) { // identical to the Admin panel's hash, so both share the "already sent" list
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function events(exams, now) {
  const out = [], inactive = [];
  Object.values(exams || {}).forEach(exam => {
    if (!exam || !exam.id) return;
    const eff = effStatus(exam, now), pid = 'pub_' + exam.id;
    if (eff === 'published') out.push({ id: pid, type: 'pub', exam });
    else if (eff === 'draft') inactive.push(pid);
    const keys = effKeys(exam, now), res = exam.results || {};
    Object.keys(res).forEach(k => {
      const id = 'res_' + exam.id + '_' + k;
      if (keys[k]) out.push({ id, type: 'res', exam, key: k, r: res[k] }); else inactive.push(id);
    });
  });
  return { out, inactive };
}

const norm = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

function buildJobs(claimed, toks) {
  const jobs = [];
  claimed.forEach(e => {
    const ex = e.exam;
    if (e.type === 'pub') {
      const when = ex.startDate ? ' | শুরু: ' + ex.startDate + (ex.startTime ? ' ' + ex.startTime : '') : '';
      toks.forEach(t => {
        const nm = (t.studentName || '').trim();
        jobs.push({ t, exam: ex, type: 'pub', data: { title: 'Siam Infinity EduVerse', tag: 'pub_' + ex.id,
          body: (nm ? nm + ', ' : '') + 'নতুন পরীক্ষা Publish হয়েছে! কোর্স: ' + ex.name + ' | বিষয়: ' + (ex.subject || '-') + when + '। সাইটে গিয়ে অংশগ্রহণ করে নিজের প্রস্তুতি যাচাই করুন। শুভকামনা! ✨' } });
      });
    } else {
      const rn = norm(e.r && e.r.studentName), ck = ex.id + '::' + e.key;
      toks.filter(t => (Array.isArray(t.resKeys) && t.resKeys.indexOf(ck) >= 0) || (rn && norm(t.studentName) === rn)).forEach(t => {
        jobs.push({ t, exam: ex, type: 'res', data: { title: 'Siam Infinity EduVerse', tag: 'res_' + ex.id + '_' + e.key,
          body: ((e.r && e.r.studentName) || 'প্রিয় শিক্ষার্থী') + ', আপনার রেজাল্ট প্রকাশিত হয়েছে! কোর্স: ' + ex.name + ' | বিষয়: ' + (ex.subject || '-') + '। হোম পেজ থেকে বিস্তারিত রেজাল্ট দেখে নিন।' } });
      });
    }
  });
  return jobs;
}

module.exports = { effStatus, effKeys, hash, events, buildJobs };
