const assert=require('node:assert/strict'),S=require('../src/analysis-settings.js');
const store=initial=>{const values=new Map(Object.entries(initial||{}));return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),values};};
let count=0;function test(name,fn){fn();count++;console.log('PASS',name);}
test('GPU legacy auto/deep wins over conflicting old manual time',()=>{
 for(const [profile,mode] of [['optimized','auto'],['deep','deep']]){const db=store({'omok-gpu-profile':profile,unrelated:'keep'}),r=S.load(db,{compute:'gpu',budget:'1000'});assert.equal(r.state.mode,mode);assert.equal(db.values.get('unrelated'),'keep');assert.equal(db.values.get('omok-gpu-profile'),profile);assert(S.valid(JSON.parse(db.getItem(S.KEY))));}
});
test('valid new settings win; legacy numeric settings and invalid JSON remain bounded',()=>{
 const existing={version:1,mode:'custom',manualMs:1000};assert.deepEqual(S.load(store({[S.KEY]:JSON.stringify(existing),'omok-gpu-profile':'deep'})).state,existing);
 assert.equal(S.load(store(),{compute:'cpu',budget:'1000'}).state.mode,'custom');
 for(const value of ['NaN','Infinity','-1','0','999999'])assert.equal(S.load(store({[S.KEY]:'{broken'}),{compute:'cpu',budget:value}).state.mode,'auto');
 const blocked={getItem:()=>'{',setItem:()=>{throw Error('quota');}};assert.equal(S.load(blocked).saved,false);
});
test('same fixed board preserves automatic planning, deep and custom budgets',()=>{
 const board=Array(225).fill(0),planner=(b,p,remaining)=>({ms:Math.min(b[0]?15000:2500,remaining-3000),reason:'候補 stable'});
 const state=S.defaults();let p=S.resolve(state,board,1,40000,planner);assert(p.budget.automatic);assert.equal(p.externalMs,2500);assert.equal(p.internalMs,2350);
 board[0]=1;assert.equal(S.resolve(state,board,1,40000,planner).externalMs,15000);
 assert.equal(S.resolve({...state,mode:'deep'},board,1,40000,planner).externalMs,25000);
 p=S.resolve({...state,mode:'custom',manualMs:1000},board,1,40000,planner);assert.equal(p.externalMs,1000);assert.equal(p.internalMs,940);assert.equal(p.selectedLabel,'직접 설정 · 1초');
 p=S.resolve(state,board,1,3500,planner);assert.equal(p.externalMs,500);assert(p.clockLimited);assert.equal(p.mode,'auto');
});
console.log(count+' analysis settings groups passed; real search starts 0');
