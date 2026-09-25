'use strict';
// Runs a few decisive cases against the ruleset that is LIVE in production (Firebase Rules API "test").
// Needs a Firebase CLI login (token read from the CLI's configstore).
const token = require(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json').tokens.access_token;
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const P = 'projects/wynajemradar';

const LIST = { name: 'Kraków', ownerUid: 'A', ownerEmail: 'matteohoffman2@gmail.com', memberEmails: ['matteohoffman2@gmail.com', 'kasia@gmail.com'], members: {} };
const auth = (uid, email) => ({ uid, token: { email, email_verified: true } });
const path = p => `/databases/(default)/documents/${p}`;
const cases = [
  { expectation: 'DENY', label: 'member removes the administrator', request: { auth: auth('B', 'kasia@gmail.com'), method: 'update', path: path('lists/L'), resource: { data: { ...LIST, memberEmails: ['kasia@gmail.com'] } } }, resource: { data: LIST } },
  { expectation: 'DENY', label: 'member invites someone', request: { auth: auth('B', 'kasia@gmail.com'), method: 'update', path: path('lists/L'), resource: { data: { ...LIST, memberEmails: [...LIST.memberEmails, 'x@gmail.com'] } } }, resource: { data: LIST } },
  { expectation: 'ALLOW', label: 'member leaves', request: { auth: auth('B', 'kasia@gmail.com'), method: 'update', path: path('lists/L'), resource: { data: { ...LIST, memberEmails: ['matteohoffman2@gmail.com'] } } }, resource: { data: LIST } },
  { expectation: 'ALLOW', label: 'administrator removes a member', request: { auth: auth('A', 'matteohoffman2@gmail.com'), method: 'update', path: path('lists/L'), resource: { data: { ...LIST, memberEmails: ['matteohoffman2@gmail.com'] } } }, resource: { data: LIST } },
  { expectation: 'ALLOW', label: 'site admin reads another user', request: { auth: auth('A', 'matteohoffman2@gmail.com'), method: 'get', path: path('users/B') }, resource: { data: { email: 'kasia@gmail.com' } } },
  { expectation: 'DENY', label: 'regular user reads another user', request: { auth: auth('B', 'kasia@gmail.com'), method: 'get', path: path('users/A') }, resource: { data: { email: 'matteohoffman2@gmail.com' } } }
];

(async () => {
  const rel = await (await fetch(`https://firebaserules.googleapis.com/v1/${P}/releases/cloud.firestore`, { headers: H })).json();
  const rs = await (await fetch(`https://firebaserules.googleapis.com/v1/${rel.rulesetName}`, { headers: H })).json();
  const body = { source: rs.source, testSuite: { testCases: cases.map(({ label, ...c }) => c) } };
  const res = await (await fetch(`https://firebaserules.googleapis.com/v1/${P}:test`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();
  if (res.error) { console.log('API error:', res.error.message); process.exit(1); }
  let bad = 0;
  res.testResults.forEach((r, i) => { const ok = r.state === 'SUCCESS'; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${cases[i].expectation.padEnd(5)} ${cases[i].label}${ok ? '' : ' :: ' + JSON.stringify(r.debugMessages || r)}`); });
  console.log(`\nlive ruleset ${rel.rulesetName.split('/').pop()} (updated ${rel.updateTime}): ${cases.length - bad}/${cases.length} as expected`);
  process.exit(bad ? 1 : 0);
})();
