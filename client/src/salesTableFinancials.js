import {estimatedFigures,saleFinancials} from '../../server/financialSnapshot.mjs';

export function salesTableFinancials(sale,state) {
  const estimates=estimatedFigures([sale],[],state,new Map([[sale.id,sale]]));
  const capturedCost=sale.financialSnapshot?.perUnit?.cost_price;
  const inferredCost=saleFinancials(sale,state).snapshot?.perUnit?.cost_price;
  const quantity=Number(sale.qty||0);
  const perUnit=Number.isFinite(capturedCost)?capturedCost:!Number.isFinite(sale.costTotal)&&Number.isFinite(inferredCost)?inferredCost:null;
  const cents=perUnit!==null?Math.round(perUnit*100)*quantity:Number.isFinite(sale.costTotal)?Math.round(sale.costTotal*100):null;
  return {cost:cents!==null&&Number.isSafeInteger(cents)?cents/100:null,settlement:estimates.estimated_settlement.amount,profit:estimates.estimated_profit.amount};
}

export function salesTableTotals(rows,state) {
  const values=rows.map(sale=>({qty:Number(sale.qty||0),amount:Number(sale.saleAmount||0),...salesTableFinancials(sale,state)}));
  const sum=(key,money=true)=>{
    if(values.some(row=>row[key]===null||!Number.isFinite(row[key])))return null;
    const total=values.reduce((sum,row)=>sum+(money?Math.round(row[key]*100):row[key]),0);
    return Number.isSafeInteger(total)?total/(money?100:1):null;
  };
  return {qty:sum('qty',false),amount:sum('amount'),cost:sum('cost'),settlement:sum('settlement'),profit:sum('profit')};
}
