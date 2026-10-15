export function calculatePurchaseCost(quantityInput,costPriceInput){
 const quantity=Number(quantityInput),costPrice=String(costPriceInput??'').trim();
 if(!Number.isSafeInteger(quantity)||quantity<=0)throw Error('Quantity must be a positive whole number.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(costPrice))throw Error('Enter a positive Cost Price with up to two decimal places.');
 const costPriceCents=Math.round(Number(costPrice)*100),totalCents=costPriceCents*quantity;
 if(!Number.isSafeInteger(costPriceCents)||costPriceCents<=0||!Number.isSafeInteger(totalCents))throw Error('Enter a valid Cost Price and Quantity.');
 return {quantity,costPriceCents,totalCents};
}
export function validatePurchase(input={}) {
 const date=String(input.date||''),supplier=String(input.supplier||'').trim(),product=String(input.product||'').trim(),notes=String(input.notes||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Select a valid Purchase Date.');
 if(supplier.length>200)throw Error('Supplier must be at most 200 characters.');
 if(!product||product.length>300)throw Error('Enter a Product (up to 300 characters).');
 const {quantity,costPriceCents,totalCents}=calculatePurchaseCost(input.quantity,input.costPrice);
 if(notes.length>2000)throw Error('Notes must be at most 2000 characters.');
 return {date,supplier,product,quantity,costPriceCents,totalCents,amountCents:totalCents,notes};
}

export function purchaseTotalCents(purchase){
 const cents=purchase.totalCents??purchase.amountCents;
 return Number.isSafeInteger(cents)&&cents>=0?cents:null;
}

export function totalPurchaseCents(purchases=[]) {
 const unique=new Map();for(const purchase of purchases)unique.set(purchase.id||purchase,purchase);
 return [...unique.values()].reduce((sum,purchase)=>sum+(purchaseTotalCents(purchase)??0),0);
}

export function registerPurchaseRoutes(app,{readDb,mutate}) {
 app.get('/api/purchases',(_req,res)=>{
  try {const purchases=readDb().purchases||[];res.json({purchases,totalCents:totalPurchaseCents(purchases)});}
  catch(error){res.status(500).json({error:error.message});}
 });
 app.post('/api/purchases',(req,res)=>{
  try {
   const purchase=validatePurchase(req.body),requestId=String(req.body.requestId||'');
   if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))throw Error('A valid save request ID is required.');
   const existing=(readDb().purchases||[]).find(row=>row.requestId===requestId);
   if(existing){
    if(JSON.stringify(Object.fromEntries(Object.keys(purchase).map(key=>[key,existing[key]])))!==JSON.stringify(purchase))return res.status(409).json({error:'Save request already used for a different purchase.'});
    return res.json({purchase:existing,replayed:true});
   }
   const saved=mutate(db=>{const record={...purchase,id:'purchase_'+crypto.randomUUID(),requestId,createdAt:new Date().toISOString()};(db.purchases||=[]).push(record);return record;});
   res.status(201).json({purchase:saved,replayed:false});
  }catch(error){res.status(400).json({error:error.message});}
 });
}
