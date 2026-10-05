'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const file=path.resolve(__dirname,'../tools/strategy/manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));
const {index,replay}=require('../tools/strategy/replay.cjs'),baseline=path.resolve(__dirname,'../../baseline/src/node-engine.cjs'),E=require(fs.existsSync(baseline)?baseline:'../src/node-engine.cjs')({strategy:false});
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),fs.readFileSync(file+'.sha256','utf8').trim());
for(const split of ['development','holdout']){assert.equal(manifest.cases.filter(c=>c.split===split).length,12);for(const category of 'ABCDEF')assert.equal(manifest.cases.filter(c=>c.split===split&&c.category===category).length,2);}
const canonical=b=>Array.from({length:8},(_,t)=>{const z=Array(225).fill(0);b.forEach((q,i)=>z[E.transformed(i,t)]=q);return z.join('');}).sort()[0];
const seen=new Set();for(const c of manifest.cases){const r=replay(E,c);assert.deepEqual(r.board,c.board);assert.equal(r.p,c.p);assert.equal(r.winner,null);const key=canonical(c.board.map(q=>q===c.p?1:q===0?0:2));assert(!seen.has(key),'symmetry/color duplicate '+c.id);seen.add(key);}
for(const o of manifest.openings){assert.equal(replay(E,o).winner,null);assert.equal(E.winning(o.board,o.p).length,0);assert.equal(E.winning(o.board,3-o.p).length,0);}
assert.equal(manifest.games.length,36);for(const opening of manifest.openings)for(const mode of manifest.modes){const pair=manifest.games.filter(g=>g.opening===opening.id&&g.mode===mode.id);assert.equal(pair.length,2);assert.equal(pair.filter(g=>g.improvedFirst).length,1);}
const trap=manifest.cases.find(c=>c.id==='dev-E2'),b=trap.board.slice();b[index('F8')]=trap.p;assert.equal(E.winning(b,trap.p).map(E.coord).join(' '),'G8');b[index('G8')]=3-trap.p;assert.equal(E.winning(b,3-trap.p).length,2);assert.equal(E.winning(b,trap.p).length,0);
assert(manifest.cases.find(c=>c.id==='dev-F1').moves.includes('PASS'));
console.log('PASS frozen 12 new development / 12 holdout families, replay/PASS/current side, tactical countertrap and 36 balanced games');
