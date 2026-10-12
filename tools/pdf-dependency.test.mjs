import test from 'node:test';import assert from 'node:assert/strict';
test('patched PDF dependency extracts and renders a synthetic shipping label with the existing canvas API',async()=>{
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const stream='BT /F1 12 Tf 20 180 Td (SellQuanta synthetic label Order 123-4567890-1234567) Tj ET';objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
 let pdf='%PDF-1.4\n',offsets=[0];for(let n=0;n<objects.length;n++){offsets.push(Buffer.byteLength(pdf));pdf+=`${n+1} 0 obj\n${objects[n]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const pdfjs=await import('../client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');const {createCanvas}=await import('../client/node_modules/@napi-rs/canvas/index.js');
 const task=pdfjs.getDocument({data:new Uint8Array(Buffer.from(pdf)),useSystemFonts:true});
 try{const doc=await task.promise;assert.equal(doc.numPages,1);const page=await doc.getPage(1);assert.match((await page.getTextContent()).items.map(i=>i.str).join(' '),/123-4567890-1234567/);const viewport=page.getViewport({scale:2.2});const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;assert.ok(canvas.toBuffer('image/png').length>500);}finally{await task.destroy();}
});
