export function validateManualReceipt(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))return {valid:false,error:'Enter the required receipt fields.'};
  if(!['Amazon','Flipkart','Meesho'].includes(input.marketplace)) return {valid:false,error:'Select Amazon, Flipkart or Meesho.'};
  const date=String(input.date||'');
  const parsed=new Date(`${date}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==date) return {valid:false,error:'Enter a valid received date.'};
  const amount=String(input.amount??'').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(amount)) return {valid:false,error:'Enter a positive amount with at most two decimal places.'};
  const [whole,fraction='']=amount.split('.'),amountCents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(amountCents)||amountCents<=0) return {valid:false,error:'Enter a positive amount within the supported range.'};
  const reference=String(input.reference||'').trim();
  if(!reference||reference.length>200||! /^[A-Za-z0-9 ._/#:-]+$/.test(reference)||/^[-. /#:_0]+$/.test(reference)) return {valid:false,error:'Enter the actual bank reference / UTR (up to 200 characters).'};
  const notes=String(input.notes||'').trim();
  if(notes.length>2000) return {valid:false,error:'Notes must be no longer than 2000 characters.'};
  return {valid:true,value:{marketplace:input.marketplace,date,amountCents,reference,notes}};
}
