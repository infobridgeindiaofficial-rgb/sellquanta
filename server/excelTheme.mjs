import XLSX from 'xlsx';

// Decorate the existing XLSX package, preserving all cells, references and layout.
// Existing number formats are retained by deriving each new style from its old XF.
export function writeThemedWorkbook(workbook,{report=false,template=false}={}){
 const zip=XLSX.CFB.read(XLSX.write(structuredClone(workbook),{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 const entry=name=>zip.FileIndex.find((item,i)=>zip.FullPaths[i].endsWith('/'+name));
 const styles=entry('xl/styles.xml');let xml=Buffer.from(styles.content).toString('utf8');
 const count=tag=>Number(xml.match(new RegExp(`<${tag} count="(\\d+)"`))[1]);
 const fontStart=count('fonts'),fillStart=count('fills'),borderStart=count('borders');
 const add=(tag,items)=>{xml=xml.replace(new RegExp(`<${tag} count="(\\d+)"([^>]*)>([\\s\\S]*?)</${tag}>`),(_,n,attrs,body)=>`<${tag} count="${Number(n)+items.length}"${attrs}>${body}${items.join('')}</${tag}>`);};
 const font=(color,bold,size=11)=>`<font><sz val="${size}"/><color rgb="FF${color}"/><name val="Calibri"/>${bold?'<b/>':''}</font>`;
 add('fonts',[font('151515',false),font('FFFFFF',true),font('151515',true),font('FFFFFF',true,18)]);
 add('fills',['2E5E4E','E8EFEB','FFFFFF','121212','8CC3AD'].map(color=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`));
 add('borders',[`<border>${['left','right','top','bottom'].map(side=>`<${side} style="thin"><color rgb="FFE4E4DF"/></${side}>`).join('')}<diagonal/></border>`]);
 const xfMatch=xml.match(/<cellXfs count="\d+"[^>]*>([\s\S]*?)<\/cellXfs>/);
 const originals=xfMatch[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)||[];
 const additions=[],cache=new Map();
 const style=(old,kind,numeric)=>{
  const key=[old,kind,numeric].join(':');if(cache.has(key))return cache.get(key);
  const original=originals[old]||originals[0];
  const numFmt=original.match(/numFmtId="(\d+)"/)?.[1]||'0';
  const fontId=fontStart+(kind==='title'?3:kind==='header'?1:kind==='summary'?2:0);
  const fillId=fillStart+(kind==='title'?3:kind==='header'?0:kind==='summary'?4:kind==='stripe'?1:2);
  const xf=`<xf numFmtId="${numFmt}" fontId="${fontId}" fillId="${fillId}" borderId="${borderStart}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="${numeric?'right':'left'}" wrapText="1"/></xf>`;
  const id=originals.length+additions.length;additions.push(xf);cache.set(key,id);return id;
 };
 for(let i=1;i<=workbook.SheetNames.length;i++){
  const sheet=entry(`xl/worksheets/sheet${i}.xml`);if(!sheet)continue;
  let content=Buffer.from(sheet.content).toString('utf8');
  content=content.replace(/<c\b([^>]*)(>[\s\S]*?<\/c>|\/>)/g,(full,attrs,end)=>{
   const row=Number(attrs.match(/\br="[A-Z]+(\d+)"/)?.[1]);
   const kind=template?(row===1?'title':[2,5].includes(row)?'header':row>=6&&row%2===0?'stripe':'body'):report?(row===1?'title':[4,7].includes(row)?'header':row===5?'summary':row>=8&&row%2===0?'stripe':'body'):(row===1?'header':row%2===0?'stripe':'body');
   const old=Number(attrs.match(/\bs="(\d+)"/)?.[1]||0);
   const type=attrs.match(/\bt="([^"]+)"/)?.[1];const numeric=(!type||type==='n')&&/<v>/.test(end);
   return `<c${attrs.replace(/\s+s="\d+"/,'')} s="${style(old,kind,numeric)}"${end}`;
  });
  if(template)content=content.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/,'<sheetViews><sheetView workbookViewId="0" zoomScale="90"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A6" sqref="A6"/></sheetView></sheetViews>');
  sheet.content=Buffer.from(content);sheet.size=sheet.content.length;
 }
 add('cellXfs',additions);styles.content=Buffer.from(xml);styles.size=styles.content.length;
 return Buffer.from(XLSX.CFB.write(zip,{type:'buffer',fileType:'zip'}));
}
