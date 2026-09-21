/* verify-top-performers.mjs — the Top performers card is the agent's OWN campaign's top ten
 * (Nick, 2026-09-21: "if we are looking at a Courtesy view agent they need to see top 10 in
 * their campaign"). Pure: drives worker/src/portal.mjs topPerformers() on a synthetic digest.
 *
 * Run: node verify-top-performers.mjs   (no network, no credentials)
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { topPerformers } = await import(pathToFileURL(path.join(HERE, '..', '..', 'worker', 'src', 'portal.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); } };

/* 14 Cuddle agents outselling 12 Courtesy agents, plus one with no campaign and one with nothing sold */
const agents = [];
for (let i = 1; i <= 14; i++) agents.push({ code: 'CB1' + String(i).padStart(2, '0'), name: 'Cuddle ' + i, campaign: 'Cuddle', sales: 40 - i, gwpEx: 5000 - i * 100 });
for (let i = 1; i <= 12; i++) agents.push({ code: 'CB2' + String(i).padStart(2, '0'), name: 'Courtesy ' + i, campaign: 'Courtesy', sales: 20 - i, gwpEx: 1500 - i * 50 });
agents.push({ code: 'CB300', name: 'Nobody Camp', campaign: '', sales: 3, gwpEx: 200 });
agents.push({ code: 'CB301', name: 'Sold Nothing', campaign: 'Courtesy', sales: 0, gwpEx: 0 });
const digest = { agents };

console.log('\n1 · a Courtesy agent sees Courtesy only');
{ const T = topPerformers(digest, 'CB211');   // Courtesy 11 — below the top ten
  ok('ten rows', T.floor.length === 10);
  ok('every row is Courtesy', T.floor.every((r) => r.campaign === 'Courtesy'), JSON.stringify(T.floor.map((r) => r.campaign)));
  ok('ranked by premium written', T.floor.every((r, i) => i === 0 || T.floor[i - 1].gwpEx >= r.gwpEx));
  ok('#1 is the top Courtesy seller, not the top Cuddle seller', T.floor[0].name === 'Courtesy 1', T.floor[0].name);
  ok('the card says which campaign', T.campaign === 'Courtesy');
  ok('my position is among Courtesy agents with sales (11 of 12)', T.myPos === 11 && T.n === 12, T.myPos + ' of ' + T.n);
  ok('an agent with nothing sold is not on the ladder', !T.floor.some((r) => r.name === 'Sold Nothing') && T.n === 12); }

console.log('\n2 · a Cuddle agent sees Cuddle only');
{ const T = topPerformers(digest, 'CB103');
  ok('every row is Cuddle', T.floor.every((r) => r.campaign === 'Cuddle'));
  ok('I am marked on my own row', T.floor.find((r) => r.me) && T.floor.find((r) => r.me).name === 'Cuddle 3');
  ok('my position is 3 of 14', T.myPos === 3 && T.n === 14, T.myPos + ' of ' + T.n); }

console.log('\n3 · campaign names match however they are cased or spaced');
{ const d2 = { agents: agents.map((a) => (a.code === 'CB205' ? { ...a, campaign: ' courtesy ' } : a)) };
  const T = topPerformers(d2, 'CB205');
  ok('a stray case/space still lands the agent in their campaign', T.n === 12 && T.myPos === 5, T.myPos + ' of ' + T.n); }

console.log('\n4 · no campaign on record: the floor, and the card says so');
{ const T = topPerformers(digest, 'CB300');
  ok('the floor ladder', T.floor.length === 10 && T.campaign === null);
  ok('ranked across both campaigns', T.floor[0].campaign === 'Cuddle');
  ok('my floor position is counted', T.myPos === 27 && T.n === 27, T.myPos + ' of ' + T.n); }

console.log('\n5 · an unknown caller gets the floor, no crash');
{ const T = topPerformers(digest, 'CB999');
  ok('ten rows, no position', T.floor.length === 10 && T.myPos === null); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
