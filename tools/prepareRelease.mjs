import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {verifyManifest,verifyNativeInfo,verifyInstaller}=require('../electron/updateTrust.cjs');
const [installer,notesFile,output]=process.argv.slice(2);
if(!installer||!notesFile||!output)throw Error('Usage: node tools/prepareRelease.mjs installer.exe release-notes.md output-directory');
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version;
if(path.basename(installer)!==`SellQuanta-Setup-${version}.exe`)throw Error('Installer filename must match package version.');
const packaged=path.join(path.dirname(installer),'win-unpacked/resources/app');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
for(const dir of ['server','electron','client/dist'])for(const file of walk(dir).filter(f=>!f.includes('.test.')&&!f.endsWith('.map'))){
 const shipped=path.join(packaged,file);if(!fs.existsSync(shipped)||!fs.readFileSync(file).equals(fs.readFileSync(shipped)))throw Error('Packaged files do not match the reviewed source/build. Rebuild before signing.');
}
const a=crypto.createHash('sha256'),b=crypto.createHash('sha512');
for await(const chunk of fs.createReadStream(installer)){a.update(chunk);b.update(chunk);}
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8',windowsHide:true}).trim())throw Error('Commit the reviewed source locally before signing release metadata.');
const payload={version,sourceCommit,url:`https://github.com/infobridgeindiaofficial-rgb/sellquanta/releases/download/v${version}/SellQuanta-Setup-${version}.exe`,size:fs.statSync(installer).size,sha256:a.digest('hex'),sha512:b.digest('base64'),releaseNotes:fs.readFileSync(notesFile,'utf8'),releaseDate:new Date().toISOString()};
const privateKey=process.env.SELLQUANTA_UPDATE_SIGN_KEY;delete process.env.SELLQUANTA_UPDATE_SIGN_KEY;
if(!privateKey)throw Error('A securely supplied update signing key is required. No unsigned feed will be generated.');
const envelope={payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64')};
verifyManifest(envelope,require('../electron/update-public-key.json').key,version);
const info={version,files:[{url:payload.url,sha512:payload.sha512,size:payload.size}],path:payload.url,sha512:payload.sha512,releaseDate:payload.releaseDate};
verifyNativeInfo(info,payload);await verifyInstaller(installer,payload);
fs.mkdirSync(output,{recursive:true});
const write=(name,bytes)=>fs.writeFileSync(path.join(output,name),bytes,{flag:'wx'});
write('latest.json',JSON.stringify(envelope,null,2)+'\n');
write('latest.yml',`version: ${version}\nfiles:\n  - url: ${JSON.stringify(payload.url)}\n    sha512: ${payload.sha512}\n    size: ${payload.size}\npath: ${JSON.stringify(payload.url)}\nsha512: ${payload.sha512}\nreleaseDate: ${JSON.stringify(payload.releaseDate)}\n`);
write(`${path.basename(installer)}.sha256`,`${payload.sha256}  ${path.basename(installer)}\n`);
write('checksums.json',JSON.stringify({file:path.basename(installer),sourceCommit,size:payload.size,sha256:payload.sha256,sha512:payload.sha512},null,2)+'\n');
write('release-notes.md',payload.releaseNotes);
console.log(JSON.stringify({version,size:payload.size,sha256:payload.sha256,metadataVerified:true}));
