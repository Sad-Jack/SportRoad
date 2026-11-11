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
test('assistance uses repetition-weighted mean, body weight uses latest entry', () => {
  const run=runtime();run(`store.sessions=${JSON.stringify([b,c,a])}`);
  assert.equal(run("exercisePoints(grouped(store.sessions),'gravitron','weight')[0].value"),1735/54);
  assert.equal(run('bodyPoints(grouped(store.sessions))[0].value'),81.8);
  assert.equal(run('bodyPoints(grouped(store.sessions))[1].value'),81.5);
});
test('regular weight uses repetition-weighted mean; unchecked and skipped sets never count', () => {
  const run=runtime();const s=structuredClone(a);s.exercises[0].id='chest';s.exercises[0].sets[0].weight=200;s.exercises[0].sets[0].done=false;
  run(`store.sessions=${JSON.stringify([s])}`);
  assert.equal(run("exercisePoints(grouped(store.sessions),'chest','weight')[0].value"),615/19);
  assert.equal(run('doneSets(store.sessions[0]).length'),2);
  run('store.sessions[0].exercises[0].skipped=true');
  assert.equal(run('doneSets(store.sessions[0]).length'),0);
  assert.equal(run("exercisePoints(grouped(store.sessions),'chest','weight').length"),0);
});
test('daily exercise average weights repetitions and counts sets per workout', () => {
 const run=runtime(),first=structuredClone(a),second=structuredClone(b);
 first.exercises[0].sets=[{weight:100,reps:1,done:true},{weight:50,reps:8,done:true}];
 second.exercises[0].sets=[{weight:50,reps:8,done:true}];
 run(`store.sessions=${JSON.stringify([first,second])}`);
 assert.equal(run("exercisePoints(grouped(store.sessions),'gravitron','weight')[0].value"),900/17);
 assert.equal(run("exercisePoints(grouped(store.sessions),'gravitron','weight')[0].avgReps"),17/3);
 assert.equal(run("exercisePoints(grouped(store.sessions),'gravitron','weight')[0].avgSets"),1.5);
});
test('empty workout ignores prefilled sets but preserves actual inputs and legacy drafts', () => {
 const run=runtime(),draft=structuredClone(a);draft.finishedAt=null;draft.bodyWeight=null;draft.edited=false;
 draft.exercises[0].sets.forEach(set=>set.done=false);
 run(`const draft=${JSON.stringify(draft)}`);
 assert.equal(run('hasWorkoutData(draft)'),false);
 assert.equal(run('(draft.bodyWeight=75,hasWorkoutData(draft))'),true);
 assert.equal(run('(draft.bodyWeight=null,draft.running={before:{speed:7,minutes:null},after:{speed:null,minutes:null}},hasWorkoutData(draft))'),true);
 assert.equal(run('(draft.running.before.speed=null,draft.exercises[0].sets[0].done=true,hasWorkoutData(draft))'),true);
 assert.equal(run('(draft.exercises[0].sets[0].done=false,draft.edited=true,hasWorkoutData(draft))'),true);
 assert.equal(run('(delete draft.edited,hasWorkoutData(draft))'),true);
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

test('streak counts unique days, accepts one- or two-day gaps and expires after two days', () => {
 const run=runtime();
 const dates=['2026-11-01','2026-11-03','2026-11-05','2026-11-05','2026-11-06'];
 run(`const dated=${JSON.stringify(dates.map(date=>({date})))}`);
 assert.equal(run("currentStreak(dated,'2026-11-06')"),4);
 assert.equal(run("currentStreak(dated,'2026-11-08')"),4);
 assert.equal(run("currentStreak(dated,'2026-11-09')"),0);
 assert.equal(run("currentStreak(dated,'2026-11-04')"),2);
 assert.equal(run("currentStreak([],'2026-11-06')"),0);
 assert.equal(run("currentStreak([{date:'2026-01-01'},{date:'2025-12-30'}],'2026-01-02')"),2);
});
test('running aggregates complete segments by day and weights speed by duration', () => {
 const run=runtime();const one={...structuredClone(a),running:{before:{speed:8,minutes:10},after:{speed:10,minutes:5}}};
 const two={...structuredClone(b),running:{before:{speed:12,minutes:5},after:{speed:20,minutes:null}}};
 run(`const rr=grouped(${JSON.stringify([one,two])})`);
 assert.equal(run("runningPoints(rr,'minutes')[0].value"),20);
 assert.equal(run("runningPoints(rr,'speed')[0].value"),9.5);
 assert.equal(run("runningPoints(grouped([{}].map(x=>({date:'2026-11-10'}))),'speed').length"),0);
});
test('running data is optional for old backups and invalid values are rejected', () => {
 const run=runtime(),data={version:1,sessions:[structuredClone(a)],active:null,settings:{rest:90}};
 assert.equal(run(`validate(${JSON.stringify(data)}).sessions.length`),1);
 data.sessions[0].running={before:{speed:8.5,minutes:10},after:{speed:null,minutes:null}};
 assert.equal(run(`validate(${JSON.stringify(data)}).sessions[0].running.before.speed`),8.5);
 for(const value of [-1,0,41,'fast']){data.sessions[0].running.before.speed=value;assert.throws(()=>run(`validate(${JSON.stringify(data)})`))}
});
test('gravitron chart puts lower assistance higher and shows latest kg', () => {
 const run=runtime();const svg=run("chart([{date:'2026-11-10',value:40},{date:'2026-11-11',value:20}],{invert:true,unit:'кг'})");
 const line=svg.match(/d="M[\d.]+,([\d.]+) L[\d.]+,([\d.]+)" fill="none"/);
 assert.ok(line);assert.ok(Number(line[2])<Number(line[1]));assert.match(svg,/20 кг/);assert.doesNotMatch(svg,/<circle/);
});

test('legacy backups gain the original editable program and keep their history', () => {
 const run=runtime(),data={version:1,sessions:[a],active:null,settings:{rest:90}};
 run(`const migrated=validate(${JSON.stringify(data)})`);
 assert.equal(run("migrated.plan.order.join(',')"),'A,B,C');
 assert.equal(run("migrated.plan.before.join(',')"),'run:before');
 assert.equal(run("migrated.plan.after.join(',')"),'abs,hyper,run:after');
 assert.equal(run('migrated.sessions[0].exercises[0].sets[0].weight'),40);
});
test('custom days, shared exercises and workout snapshots survive validation', () => {
 const run=runtime();run(`const p=defaultPlan();p.exercises.custom={name:'Тяга',n:2,min:6,max:8,help:true};p.programs.customDay={name:'Новый день',ex:['custom']};p.order.unshift('customDay');p.before.push('pulldown');p.programs.A.ex=p.programs.A.ex.filter(x=>x!=='pulldown');`);
 assert.equal(run('validatePlan(p).order[0]'),'customDay');
 const custom=structuredClone(a);custom.program='customDay';custom.programName='Новый день';custom.programLabel='A';custom.exercises=[{id:'custom',skipped:false,definition:{name:'Тяга',n:2,min:6,max:8,help:true},sets:[{weight:30,reps:6,done:true},{weight:25,reps:7,done:true}]}];custom.layout=['run:before','pulldown','custom','abs','hyper','run:after'];
 // A workout layout must reference exactly its own exercise records.
 run(`const example=${JSON.stringify(custom)};example.layout=['run:before','custom','run:after'];const imported=validate({version:1,sessions:[example],active:null,settings:{rest:90},plan:p});`);
 assert.equal(run('imported.sessions[0].exercises[0].definition.help'),true);
 assert.equal(run('imported.sessions[0].programName'),'Новый день');
 assert.equal(run('imported.sessions[0].layout.length'),3);
});
test('plan validation rejects duplicate workout positions and malformed definitions', () => {
 const run=runtime();run('const p=defaultPlan()');
 for(const mutation of ["p.order.push('A')","p.before.push('abs')","p.exercises.gravitron.n=0","p.exercises.gravitron.help='yes'","p.programs.A.name=''","p.after.push('run:before')","p.order.push('missing')"]){
  assert.throws(()=>{run('Object.assign(p,defaultPlan())');run(mutation);run('validatePlan(p)')});
 }
});
test('historical definitions and names do not change after editing the plan', () => {
 const run=runtime();run(`const p=defaultPlan();const old=${JSON.stringify(structuredClone(a))};freezeLegacy(old,p);p.programs.A.name='Другая спина';p.exercises.gravitron.name='Переименованное';p.exercises.gravitron.n=2;`);
 assert.equal(run('old.programName'),'Спина и подтягивания');
 assert.equal(run('old.exercises[0].definition.name'),'Гравитрон');
 assert.equal(run('old.exercises[0].definition.n'),3);
 assert.equal(run('validate({version:1,sessions:[old],active:null,settings:{rest:90},plan:p}).sessions[0].exercises[0].sets.length'),3);
});

test('import separates opposite weight meanings and repeat import reuses the same series', () => {
 const run=runtime();
 run(`const local=validate({version:1,sessions:[${JSON.stringify(a)}],active:null,settings:{rest:90}});const remote=validate({version:1,sessions:[${JSON.stringify(b)}],active:null,settings:{rest:90}});remote.plan.exercises.gravitron.help=false;const combined=mergeBackup(local,remote,true);`);
 assert.equal(run('combined.sessions.length'),2);
 assert.equal(run('combined.plan.exercises.gravitron.help'),true);
 assert.equal(run('combined.sessions[0].exercises[0].id'),'gravitron');
 assert.notEqual(run('combined.sessions[1].exercises[0].id'),'gravitron');
 assert.equal(run('combined.plan.exercises[combined.sessions[1].exercises[0].id].help'),false);
 assert.equal(run('combined.plan.exercises[combined.sessions[1].exercises[0].id].sourceId'),'gravitron');
 run('const repeated=mergeBackup(combined,remote,true)');
 assert.equal(run('repeated.sessions.length'),2);
 assert.equal(run('repeated.sessions[1].exercises[0].id'),run('combined.sessions[1].exercises[0].id'));
 assert.equal(run('repeated.plan.programs.A.ex[0]'),run('combined.plan.programs.A.ex[0]'));
});
test('old backup imports do not replace the current program and preserve the active workout', () => {
 const run=runtime();
 run(`const local=validate({version:1,sessions:[],active:null,settings:{rest:90}});local.plan.programs.A.name='Своя программа';local.plan.order=['C','A'];const remote=validate({version:1,sessions:[${JSON.stringify(a)}],active:null,settings:{rest:120}});const combined=mergeBackup(local,remote,false);`);
 assert.equal(run('combined.plan.order.join()'),'C,A');
 assert.equal(run('combined.plan.programs.A.name'),'Своя программа');
 assert.equal(run('combined.sessions[0].programName'),'Спина и подтягивания');
 assert.equal(run('combined.settings.rest'),90);
});

test('an empty edited program remains valid and its analytics handles no exercises', () => {
 const run=runtime();
 run('const empty=defaultPlan();empty.order=[];empty.before=[];empty.after=[];store.plan=validatePlan(empty);store.sessions=[];store.active=null;installPlan(store.plan)');
 assert.equal(run('analyticsExerciseIds().length'),0);
 assert.equal(run('nextProgram()'),null);
 assert.doesNotMatch(run('renderPrograms()'),/class="panel routine/);
 assert.doesNotThrow(()=>run('renderAnalytics()'));
});
test('a run-only workout and its layout remain valid after reload', () => {
 const run=runtime(),data={version:1,sessions:[],active:null,settings:{rest:90}};
 run(`const data=${JSON.stringify(data)};data.plan=defaultPlan();data.plan.programs.A.ex=[];data.plan.after=[];const draft={...${JSON.stringify(a)},id:'run-only',finishedAt:null,exercises:[],layout:['run:before'],running:{before:{speed:8,minutes:10},after:{speed:null,minutes:null}}};data.active=draft;const restored=validate(data);`);
 assert.equal(run('restored.active.exercises.length'),0);
 assert.equal(run('restored.active.layout[0]'),'run:before');
 assert.equal(run('restored.active.running.before.speed'),8);
});
test('saved workouts reject a snapshot inconsistent with their sets or layout', () => {
 const run=runtime(),data={version:1,sessions:[structuredClone(a)],active:null,settings:{rest:90}};
 data.sessions[0].exercises[0].definition={name:'Гравитрон',n:2,min:8,max:12,help:true};
 assert.throws(()=>run(`validate(${JSON.stringify(data)})`));
 data.sessions[0].exercises[0].definition.n=3;data.sessions[0].layout=['run:before'];
 assert.throws(()=>run(`validate(${JSON.stringify(data)})`));
});

test('plan references and workout identifiers must be strings', () => {
 const run=runtime();
 run("const p=defaultPlan();p.programs['1']={name:'Day',ex:[]};p.exercises['2']={name:'Exercise',n:1,min:1,max:1,help:false}");
 assert.throws(()=>run('p.order=[1];validatePlan(p)'));
 assert.throws(()=>run("p.order=['1'];p.before=[2];validatePlan(p)"));
 assert.throws(()=>run("p.before=[];p.programs['1'].ex=[2];validatePlan(p)"));
});
