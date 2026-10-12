"use strict";
const crypto=require('node:crypto');
const fs=require('node:fs');
const semver=require('semver');
const RELEASE_BASE='https://github.com/infobridgeindiaofficial-rgb/sellquanta/releases/download/';
function verifyManifest(envelope,publicKey,currentVersion){
 if(!envelope||typeof envelope.signature!=='string'||!envelope.payload)throw Error('Update metadata is missing its signature.');
 if(!crypto.verify(null,Buffer.from(JSON.stringify(envelope.payload)),publicKey,Buffer.from(envelope.signature,'base64')))throw Error('Update metadata signature is invalid.');
 const p=envelope.payload;
 if(!/^\d+\.\d+\.\d+$/.test(p.version)||!semver.valid(p.version)||!Number.isSafeInteger(p.size)||p.size<1||p.size>2*1024**3)throw Error('Update metadata has an invalid version or size.');
 if(typeof p.sha512!=='string'||Buffer.from(p.sha512,'base64').length!==64||!/^[a-f0-9]{64}$/.test(p.sha256||''))throw Error('Update metadata has invalid checksums.');
 const expected=`${RELEASE_BASE}v${p.version}/SellQuanta-Setup-${p.version}.exe`;
 if(p.url!==expected||typeof p.releaseNotes!=='string'||p.releaseNotes.length>20000||!Number.isFinite(Date.parse(p.releaseDate)))throw Error('Update metadata has an invalid package or release description.');
 if(semver.lt(p.version,currentVersion))throw Error('An older update was rejected. Use the documented manual rollback procedure.');
 return Object.freeze({...p});
}
function verifyNativeInfo(info,p){
 if(info?.version!==p.version||info.files?.length!==1)throw Error('Update feed does not match signed metadata.');
 const f=info.files[0];
 if(f.url!==p.url||f.sha512!==p.sha512||f.size!==p.size||info.packages)throw Error('Update package does not match signed metadata.');
}
async function verifyInstaller(file,p){
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size!==p.size)throw Error('Downloaded installer size does not match.');
 const a=crypto.createHash('sha512'),b=crypto.createHash('sha256');
 for await(const chunk of fs.createReadStream(file)){a.update(chunk);b.update(chunk);}
 if(a.digest('base64')!==p.sha512||b.digest('hex')!==p.sha256)throw Error('Downloaded installer checksum does not match.');
}
module.exports={verifyManifest,verifyNativeInfo,verifyInstaller};
