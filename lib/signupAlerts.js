const { getPool } = require('../db/postgres');

async function queueSignupAlert(client, user, invited) {
  const recipient = String(process.env.CD_SIGNUP_ALERT_TO || '').trim();
  if (!recipient) return;
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) throw new Error('Invalid signup alert recipient');
  await client.query(`insert into signup_alerts(uid,recipient,payload) values($1,$2,$3::jsonb) on conflict(uid) do nothing`, [user.uid, recipient, JSON.stringify({
    name: user.name || '', company: user.company || '', email: user.email,
    accountType: invited ? 'Invited team member' : 'New company',
  })]);
}

function signupAlertMail(row) {
  const p = row.payload;
  const when = new Intl.DateTimeFormat('en-US', {dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(row.created_at));
  return {
    from: process.env.AUTH_EMAIL_FROM, to: row.recipient,
    messageId: '<signup-' + row.uid.replace(/[^a-zA-Z0-9_-]/g, '') + '@getcontractordesk.com>',
    subject: 'Contractor Desk: new verified account',
    text: 'A new Contractor Desk account has completed email verification.\n\n' +
      'Name: ' + (p.name || 'Not provided') + '\nCompany: ' + (p.company || 'Not provided') +
      '\nEmail: ' + p.email + '\nAccount type: ' + p.accountType + '\nCreated: ' + when + ' (America/New_York)\n',
  };
}

async function drainSignupAlerts() {
  if (!process.env.CD_SIGNUP_ALERT_TO) return;
  const pool = getPool();
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = require('nodemailer').createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,
    auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:15000});
  try {
    for (let i=0;i<10;i++) {
      // Claim a five-minute lease atomically; separate workers cannot send the same pending row concurrently.
      const r = await pool.query(`update signup_alerts set attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
        where uid=(select uid from signup_alerts where sent_at is null and next_attempt_at<=now()
          order by created_at for update skip locked limit 1) returning *`);
      if (!r.rows.length) break;
      const row = r.rows[0];
      try {
        const info = await transport.sendMail(signupAlertMail(row));
        if (!info || !Array.isArray(info.accepted) || !info.accepted.length) throw new Error('Alert recipient not accepted');
        await pool.query('update signup_alerts set sent_at=now() where uid=$1', [row.uid]);
        console.log('Signup alert accepted by mail server');
      } catch (_) {
        await pool.query("update signup_alerts set next_attempt_at=now()+($2 * interval '1 minute') where uid=$1", [row.uid,Math.min(60,2**Math.min(row.attempts,6))]);
        console.warn('Signup alert delivery deferred; will retry');
      }
    }
  } finally { transport.close?.(); }
}

function startSignupAlertWorker() {
  if (!process.env.CD_SIGNUP_ALERT_TO) return;
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await drainSignupAlerts();}catch(_){console.warn('Signup alert worker unavailable; will retry');}finally{running=false;}};
  void tick();
  const timer=setInterval(tick,30000);timer.unref();
  console.log('Verified signup email alerts enabled');
  return timer;
}
module.exports={queueSignupAlert,signupAlertMail,drainSignupAlerts,startSignupAlertWorker};
