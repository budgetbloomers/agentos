// enforce2FAFor + TWOFA_EXEMPT: a named account skips the second step while TWOFA_ENFORCE=all still holds for
// everyone else, and the exemption can never reach an out-of-scope role or escape its own list.
// Pure logic, no network, no DB. Run: node nicks_code/diagnostics/verify-twofa-exempt.mjs
import { enforce2FAFor } from '../../worker/src/twofa.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; console.log('  FAIL  ' + n); } };

const exec = { username: 'tester', role: 'exec', cb: null };
const nick = { username: 'nick', role: 'admin', cb: null };
const tlByCb = { username: 'cb145', role: 'team_leader', cb: 'CB145' };
const agent = { username: 'cb57', role: 'agent', cb: 'CB57' };

// With enforce=all and NO exempt list, every in-scope role still gets 2FA.
ok('all + no exempt: exec enforced', enforce2FAFor(exec, 'all', '') === true);
ok('all + no exempt: admin enforced', enforce2FAFor(nick, 'all', undefined) === true);
ok('all + no exempt: TL enforced', enforce2FAFor(tlByCb, 'all', '') === true);
ok('agent is never in scope', enforce2FAFor(agent, 'all', 'cb57') === false);

// The exempt list drops ONLY the named account; everyone else under `all` is untouched.
ok('exempt tester: tester skips', enforce2FAFor(exec, 'all', 'tester') === false);
ok('exempt tester: nick still enforced', enforce2FAFor(nick, 'all', 'tester') === true);
ok('exempt tester: TL still enforced', enforce2FAFor(tlByCb, 'all', 'tester') === true);
ok('exempt matches by CB too', enforce2FAFor(tlByCb, 'all', 'cb145') === false);
ok('exempt list is case/space-insensitive', enforce2FAFor(exec, 'all', ' TESTER , someoneelse ') === false);
ok('a different name in the list does not exempt tester', enforce2FAFor(exec, 'all', 'someoneelse') === true);

// The exemption cannot manufacture access for an out-of-scope role, and deleting the secret restores 2FA.
ok('exempting an agent changes nothing (already out of scope)', enforce2FAFor(agent, 'all', 'cb57') === false);
ok('empty exempt == full enforcement (kill switch)', enforce2FAFor(exec, 'all', '') === true);
ok('enforce unset: nobody, exempt irrelevant', enforce2FAFor(exec, '', 'tester') === false);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
