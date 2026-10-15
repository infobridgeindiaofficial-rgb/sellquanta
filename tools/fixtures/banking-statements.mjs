// Entirely synthetic IOB-like tables. These are not copies of the missing user statements.
export const headers = ['Transaction Date', 'Value Date', 'Narration', 'Reference', 'Debit', 'Credit', 'Balance'];
export function statementRows(month = '08') {
  const narrations = [
    'NEFT/MEESHO TEC-/CUST/ MEE', 'NEFT/MEESHO PAY', 'NEFT/MEESHO TEC',
    'NEFT/FLIPKART I', 'IMPS/TEST/Amazon /HSBC', 'INTERNAL A-DAS TEST',
    'PERSONAL TRANSFER', 'GOVERNMENT SUBSIDY', 'BANK CHARGE'
  ];
  let balance = 100000;
  const rows = narrations.map((narration, index) => {
    const debit = index === narrations.length - 1 ? 700 : 0;
    const credit = debit ? 0 : 10000 + index * 100;
    balance += credit - debit;
    return [`${String(index + 1).padStart(2, '0')}/${month}/2026`, `${String(index + 1).padStart(2, '0')}/${month}/2026`, narration, `TEST-UTR-${index + 1}`, debit ? (debit / 100).toFixed(2) : '', credit ? (credit / 100).toFixed(2) : '', (balance / 100).toFixed(2)];
  });
  const totalCredit = rows.reduce((sum, row) => sum + Math.round(Number(row[5]) * 100), 0);
  const footer = [`Total Transactions: ${rows.length}`, '', '', '', '7.00', (totalCredit / 100).toFixed(2), ''];
  return { rows, footer, count: rows.length, totalCredit };
}
export function statementPdfPages(month = '08') {
  const { rows, footer } = statementRows(month);
  const positions = [20, 105, 190, 430, 520, 600, 690];
  const makePage = (rows, pageNumber) => ({ pageNumber, items: rows.flatMap((row, index) => row.map((text, column) => ({ text: String(text), x: positions[column], y: 800 - index * 20 })).filter(item => item.text)) });
  const split = [...rows[0]]; split[2] = 'NEFT/MEESHO TEC-/CUST/';
  const continuation = ['', '', 'MEE', '', '', '', ''];
  return [makePage([['Indian Overseas Bank'], ['Account No: 00000000001234'], headers, split, continuation, ...rows.slice(1, 5)], 1), makePage([headers, rows[0], ...rows.slice(5), footer, ['Page 2 of 2']], 2)];
}

// Synthetic transactions in the observed IOB geometry; no source statement values.
export function iobStatementPages(month = '08') {
  const {rows,footer}=statementRows(month);
  const monthName=month==='08'?'Aug':'Sep';
  const headerItems=[['Date(Value',50,787],['Date)',63,779],['Particulars',168,784],['Ref No.',283,790],['/Cheque No',275,778],['Transaction',334,787],['Type',347,779],['Debit(Rs)',399,784],['Credit(Rs)',456,784],['Balance(Rs)',507,784]].map(([text,x,y])=>({text,x,y}));
  const body=(values,start)=>values.flatMap((row,index)=>{
    const y=start-index*33, date=`${row[0].slice(0,2)}-${monthName}-26`;
    const words=row[2].split(' '), split=Math.max(1,Math.floor(words.length/2));
    return [{text:date,x:45,y:y+4},{text:`(${date})`,x:45,y:y-5},
      {text:words.slice(0,split).join(' '),x:112,y:y+5},{text:words.slice(split).join(' '),x:112,y:y-5},
      {text:row[3],x:279,y},{text:'TRANSFER',x:344,y},
      {text:row[4]||'-',x:row[4]?415:437,y},{text:row[5]||'-',x:row[5]?474:496,y},{text:row[6],x:533,y}].filter(item=>item.text);
  });
  return [{pageNumber:1,items:[{text:'Account No',x:49,y:671},{text:': 00000000001234',x:168,y:679},{text:'Private test metadata only',x:49,y:620}]},
    {pageNumber:2,items:[...headerItems,...body(rows.slice(0,4),750),{text:'Page 2 of 3',x:277,y:15}]},
    {pageNumber:3,items:[...body(rows.slice(4),790),{text:footer[4],x:415,y:610},{text:footer[5],x:474,y:610},{text:'Computer-generated statement notice',x:44,y:575},{text:'Page 3 of 3',x:277,y:15}]}];
}
