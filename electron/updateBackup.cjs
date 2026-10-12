"use strict";
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
function backupBeforeUpdate(dataRoot,version){
 const source=path.join(dataRoot,'data','stockpilot.json');if(!fs.existsSync(source))return null;
 const bytes=fs.readFileSync(source),db=JSON.parse(bytes.toString('utf8'));
 if(!Array.isArray(db.products)||!Array.isArray(db.agents))throw Error('The business database could not be validated. Update installation stopped.');
 const dir=path.join(dataRoot,'backups','updates');fs.mkdirSync(dir,{recursive:true});
 const target=path.join(dir,`stockpilot-before-${version}-${Date.now()}-${crypto.randomUUID()}.json`);fs.writeFileSync(target,bytes,{flag:'wx'});
 if(!fs.readFileSync(target).equals(bytes))throw Error('Pre-update backup verification failed.');return target;
}
module.exports={backupBeforeUpdate};
