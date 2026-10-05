'use strict';
const assert=require('node:assert/strict'),verify=require('../tools/verify-attack.cjs');
const quiet={prefix:'H8 A1 H9 B1 H10 C1',attacker:1,certificate:{move:'H7'}};
const immediate=verify(quiet,3000);assert(immediate.verified);assert.equal(immediate.vcf,0);assert(immediate.defenses>200);
const invalid=verify({...quiet,certificate:{move:'H7',replies:{A2:{move:'H8'}}}},3000);assert(!invalid.verified);assert.match(invalid.reason,/Illegal attack H8/);
const counter=verify({prefix:'H8 A1 H9 B1 H10 C1 F5 D1',attacker:1,certificate:{move:'H7'}},3000);assert(!counter.verified);assert.match(counter.reason,/Defender wins/);
console.log('PASS exact-five closure visits all legal defenses, rejects immediate counterwins and validates explicit illegal children');
