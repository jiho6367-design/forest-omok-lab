const assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const cli=path.resolve(__dirname,'../tools/prove-loss.cjs'),verify=require('../tools/verify-attack.cjs');
const run=(prefix,roots,depth=1)=>JSON.parse(cp.execFileSync(process.execPath,
 [cli,prefix,String(depth),'3','','black','black-first','','wide',`--root-moves=${roots}`],{encoding:'utf8',timeout:6000}));
const prefix='H8 A1 H9 B1 H10 C1 H11 D2';
const five=run(prefix,'H12',0);assert.equal(five.proof.move,'H12');
assert.deepEqual(five.rootMoveScope,['H12']);
const ignoredWin=run(prefix,'O15',0);
assert.equal(ignoredWin.proof,null,'a win outside selected roots must not escape');
assert.equal(ignoredWin.searchComplete,true,'completion refers only to selected scope');
const threatPrefix='H8 A1 H9 B1 H10 C1',threat=run(threatPrefix,'H7');
assert(threat.proof);assert.equal(threat.proof.pv?.[0]||threat.proof.move,'H7');
assert(verify({prefix:threatPrefix,attacker:1,certificate:{move:'H7'}},3000).verified);
for(const roots of ['H8','P1','A0','']){
 const result=cp.spawnSync(process.execPath,[cli,prefix,'1','1','','black','black-first','','wide',`--root-moves=${roots}`],{encoding:'utf8'});
 assert.notEqual(result.status,0,'invalid or occupied selected root must fail');
 assert.match(result.stderr,/Invalid selected root/);
}
console.log('PASS selected-root isolation, exact five, independent defense verification, invalid roots');
