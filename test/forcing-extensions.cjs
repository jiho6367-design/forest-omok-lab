const assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const cli=path.resolve(__dirname,'../tools/prove-loss.cjs');
const run=(prefix,depth,seconds,player,extend=true)=>JSON.parse(cp.execFileSync(process.execPath,
  [cli,prefix,String(depth),String(seconds),'',player,'black-first','','wide',...(extend?['--forcing-extensions']:[])],
  {encoding:'utf8',timeout:10000}));
const prefix='H8 G7 G6 H6 F8 I5 G8';
const base=run(prefix,0,3,'white',false),extended=run(prefix,0,3,'white');
assert.equal(base.proof,null);assert.equal(base.stats.forcingExtensions,0);
assert(extended.stats.forcingExtensions>0,'forced exchange is visited even without quiet stages');
assert.equal(extended.proof,null);assert.equal(extended.searchComplete,true);
assert.equal(extended.forcingExtensionLimit,8);
const counterwin=run('H8 A1 H9 B1 H10 C1 F5 D1',0,3,'black');
assert.equal(counterwin.proof,null,'opponent immediate five refutes a nominal four');
const five=run('H8 A1 H9 B1 H10 C1 H11 D2',0,3,'black');
assert(five.proof,'legal exact five remains certified');
const timeout=run(prefix,8,1,'white');
assert.equal(timeout.searchComplete,false);assert(timeout.ms<1300);
assert.equal(timeout.proof,null,'interrupted broad search must not fabricate a certificate');
assert(timeout.rootChecks.some(r=>r.status==='incomplete'),'record the interrupted root instead of implying full coverage');
const opening=run('H8 G7 G6 H6 F8',2,1,'white');
assert(opening.stats.certifiedPrunes>0);
assert(opening.rootChecks.some(r=>r.move==='I7'&&r.status==='certified_loss'&&r.winningReply==='E8'));
assert(!opening.rootChecks.some(r=>r.move==='I7'&&r.status!=='certified_loss'),'do not spend the budget re-searching a certified loss');
console.log('PASS forcing extension coverage, counterwin, exact five, bounded interruption');
