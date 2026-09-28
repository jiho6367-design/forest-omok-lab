// Bounded independent verification; reuse only fully checked branches.
const fs=require('node:fs'),verify=require('./verify-attack.cjs');
const path=process.argv[2],limit=Number(process.argv[3]||6);
if(!path||!Number.isInteger(limit)||limit<1||limit>12)throw Error('Usage: node tools/verify-session.cjs certificate.json [batches 1..12]');
const session=verify.createSession(JSON.parse(fs.readFileSync(path,'utf8'))),runs=[];
for(let k=0;k<limit;k++){
  const result=session.run(25000);runs.push(result);console.log(JSON.stringify(result));
  if(result.verified||!result.reason.toLowerCase().includes('timeout'))break;
}
if(!runs.at(-1).verified)process.exitCode=1;
