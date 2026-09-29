const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
function replay(id,kind,moves,first=1){const board=Array(225).fill(0);moves.forEach((c,k)=>board[idx(c)]=k%2?3-first:first);return {id,kind,board,p:moves.length%2?3-first:first};}
const line=s=>s.split(' ');
const win=replay('instant-win','immediate win',line('H8 A1 H9 C1 H10 E1 H11 G1'));
const block=replay('mandatory-block','unique defense',line('H8 H7 H9 A1 H10 C1 H11'));
const vcf=replay('forcing-four','VCF',line('H8 A1 H9 C1 H10 E1'));
const terminal=replay('terminal','terminal exact five',line('H8 A1 H9 C1 H10 E1 H11 G1 H12'));
const opening=replay('sixth-move','known I7 loss excluded',line('H8 G7 G6 H6 F8'));
const quiet=replay('quiet-middle','quiet middle',line('H8 G7 G6 H6 F8 J4 E8 G8 F7 I5 K3 H5'));
const known=replay('known-refutations','known F6/F10 losses',line('H8 G7 G6 H6 F8 I7 E8 G8 F7 D9 F9'));
const broad=replay('wide-middle','many candidates',require('../../test/reader/game33.cjs').coords.slice(0,28),2);
const complex=replay('complex-middle','complex defenses',require('../../test/reader/game31.cjs').coords.slice(0,24),1);
const forbidden=replay('forbidden-defense','proven immediate loss',require('../../test/reader/game95.cjs').coords,2);
module.exports=[win,block,vcf,terminal,opening,quiet,known,broad,complex,forbidden];
