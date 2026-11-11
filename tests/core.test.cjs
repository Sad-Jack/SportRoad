const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*)<\/script>/)[1].split("\n$('#app').addEventListener('input'")[0];
function runtime() {
  const context = vm.createContext({
    console, Date, Intl, Math, JSON, Map, Set, Number, String, Object, Array, Error,
    localStorage: { getItem: () => null },
    document: { querySelector: () => ({ hidden: true, textContent: '' }) },
  });
  vm.runInContext(source, context);
  return code => vm.runInContext(code, context);
}
function sample(id, date, finishedAt, weights, bodyWeight = null) {
  return {id, program:'A', date, startedAt:1, finishedAt, bodyWeight, pullups:null,
    before:false, after:false, warmup:false, restUntil:null,
    exercises:[{id:'gravitron',skipped:false,sets:weights.map((weight,i)=>({weight,reps:8+i,done:true}))}]};
}
const a = sample('a','2026-11-10',100,[40,35,30],82);
const b = sample('b','2026-11-10',200,[35,30,25],81.8);
const c = sample('c','2026-11-11',300,[30,25,20],81.5);

test('several workouts on one day aggregate sets and repetitions, with separate dates', () => {
  const run=runtime();run(`store.sessions=${JSON.stringify([a,b,c])}`);
  assert.equal(run('grouped(store.sessions).length'),2);
  assert.equal(run("exercisePoints(grouped(store.sessions),'gravitron','sets')[0].value"),6);
  assert.equal(run("exercisePoints(grouped(store.sessions),'gravitron','reps')[0].value"),54);
  assert.equal(run("exercisePoints(grouped(store.sessions),'gravitron','sets')[1].value"),3);
});
test('assistance uses minimum, body weight uses latest completed entry', () => {
  const run=runtime();run(`store.sessions=${JSON.stringify([b,c,a])}`);
  assert.equal(run("exercisePoints(grouped(store.sessions),'gravitron','weight')[0].value"),25);
  assert.equal(run('bodyPoints(grouped(store.sessions))[0].value'),81.8);
  assert.equal(run('bodyPoints(grouped(store.sessions))[1].value'),81.5);
});
test('regular weight uses maximum; unchecked and skipped sets never count', () => {
  const run=runtime();const s=structuredClone(a);s.exercises[0].id='chest';s.exercises[0].sets[0].weight=200;s.exercises[0].sets[0].done=false;
  run(`store.sessions=${JSON.stringify([s])}`);
  assert.equal(run("exercisePoints(grouped(store.sessions),'chest','weight')[0].value"),35);
  assert.equal(run('doneSets(store.sessions[0]).length'),2);
  run('store.sessions[0].exercises[0].skipped=true');
  assert.equal(run('doneSets(store.sessions[0]).length'),0);
  assert.equal(run("exercisePoints(grouped(store.sessions),'chest','weight').length"),0);
});
test('decimal comma and zero weight are valid, malformed values and fractional reps are rejected', () => {
  const run=runtime();
  assert.equal(run("numericValue('82,5','bodyWeight')"),82.5);
  assert.equal(run("numericValue('0','weight')"),0);
  for (const code of ["numericValue('-5','weight')","numericValue('12oops','weight')","numericValue('2.5','reps')","numericValue('0','bodyWeight')","numericValue('Infinity','weight')"]) assert.equal(run(code),undefined);
  assert.equal(run("numericValue('','weight')"),null);
});
test('import validates records, rejects duplicates, impossible dates, missing weight and unknown exercises', () => {
  const run=runtime();const data={version:1,sessions:[a],active:null,settings:{theme:'night',rest:90,hyper:false}};
  assert.equal(run(`validate(${JSON.stringify(data)}).sessions.length`),1);
  for(const mutate of [d=>d.sessions.push(d.sessions[0]),d=>d.sessions[0].date='2026-02-30',d=>d.sessions[0].exercises[0].sets[0].weight=null,d=>d.sessions[0].exercises[0].id='<script>',d=>d.version=9,d=>d.sessions[0].pullups=2.5]) {
    const bad=structuredClone(data);mutate(bad);assert.throws(()=>run(`validate(${JSON.stringify(bad)})`));
  }
});
test('draft and completed workout cannot share an identity', () => {
  const run=runtime(),data={version:1,sessions:[a],active:{...a,finishedAt:null},settings:{theme:'day',rest:120,hyper:true}};
  assert.throws(()=>run(`validate(${JSON.stringify(data)})`));
  data.active.id='draft';assert.equal(run(`validate(${JSON.stringify(data)}).active.id`),'draft');
});
test('previous program and suggested weights use calendar day, not import order', () => {
  const run=runtime(),older={...a,program:'C',finishedAt:999},newer={...c,program:'A'};
  run(`store.sessions=${JSON.stringify([newer,older])}`);
  assert.equal(run('nextProgram()'),'B');
  assert.equal(run("previousSets('gravitron')[0].weight"),30);
});
test('chart supports a single date, zero results, and empty data without invalid coordinates', () => {
  const run=runtime();
  for(const data of [[],[{date:'2026-11-10',value:0}],[{date:'2026-11-10',value:40},{date:'2026-11-11',value:35}]]) {
    const svg=run(`chart(${JSON.stringify(data)},{zero:true})`);assert.ok(!/NaN|Infinity/.test(svg));
  }
});

test('legacy defaults enable hyperextension only in a draft and retain completed history', () => {
  const run=runtime();
  const hyper={id:'hyper',skipped:true,sets:[{weight:0,reps:12,done:false},{weight:0,reps:12,done:false}]};
  const completed=structuredClone(a);completed.exercises.push(structuredClone(hyper));
  const draft={...structuredClone(completed),id:'draft',finishedAt:null};
  const data={version:1,sessions:[completed],active:draft,settings:{theme:'day',rest:120,hyper:false}};
  run(`const migrated=validate(${JSON.stringify(data)})`);
  assert.equal(run("migrated.active.exercises.find(e=>e.id==='hyper').skipped"),false);
  assert.equal(run("migrated.sessions[0].exercises.find(e=>e.id==='hyper').skipped"),true);
  assert.equal(run('migrated.settings.rest'),120);
  assert.equal(run("JSON.stringify(migrated.sessions)"),JSON.stringify([completed]));
  run("migrated.active.exercises.find(e=>e.id==='hyper').skipped=true");
  assert.equal(run("validate(migrated).active.exercises.find(e=>e.id==='hyper').skipped"),true);
  data.settings.hyper=true;
  assert.equal(run(`validate(${JSON.stringify(data)}).active.exercises.find(e=>e.id==='hyper').skipped`),true);
  assert.equal(run('validate(fresh()).settings.rest'),90);
});

test('a completed workout without marked sets can be restored from a backup', () => {
  const run=runtime(),empty=structuredClone(a);
  empty.exercises[0].sets.forEach(s=>s.done=false);
  const data={version:1,sessions:[empty],active:null,settings:{rest:90}};
  run(`const restored=validate(${JSON.stringify(data)})`);
  assert.equal(run('restored.sessions.length'),1);
  assert.equal(run('doneSets(restored.sessions[0]).length'),0);
  assert.equal(run('grouped(restored.sessions)[0][1].length'),1);
});
