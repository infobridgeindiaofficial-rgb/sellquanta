// Warehouse inventory summary, calculated on every render from the warehouse product records themselves (nothing is stored):
//   Total Products      = number of active products (removed / archived products have active === false)
//   Total Stock Units   = SUM(Current Stock)
//   Current Stock Value = SUM(Current Stock x warehouse COST PRICE)   (never a selling price)
export function warehouseSummary(products) {
  const active = products.filter(p => p.active !== false);
  let units = 0, value = 0;
  for (const p of active) {
    const stock = Number(p.stock || 0);
    units += stock;
    value += stock * Number(p.costPrice || 0);
  }
  return { products: active.length, units, value: Math.round(value * 100) / 100 };
}
