import XLSX from "xlsx";

const warehouseColumns = ["Warehouse Product Code", "Product Name", "Cost Price", "Opening Stock", "Current Stock", "Low Stock Level", "Status", "Product ID", "Created At", "Updated At", "Archived At", "Has Product Image"];
const masterColumns = ["Warehouse Product Code", "Marketplace SKU", "Product Name", "Mapping ID", "Warehouse Product ID", "Company ID", "Company Name", "Marketplace", "Created At"];

function sheet(columns, rows) {
  // Explicit headers keep empty exports usable. Strings stay strings (including
  // leading-zero SKUs and text starting with '='); no formulas are generated.
  const ws = XLSX.utils.aoa_to_sheet([columns, ...rows]);
  ws["!cols"] = columns.map(name => ({ wch: name.includes("Name") ? 36 : name.includes("ID") ? 42 : name.includes("At") ? 26 : 24 }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  return ws;
}

export function buildWarehouseBackup(db) {
  const opening = new Map();
  for (const movement of db.stockMovements || []) {
    if (movement.type === "OPENING") opening.set(movement.productId, (opening.get(movement.productId) ?? 0) + Number(movement.qty));
  }
  const rows = (db.products || []).map(p => [
    p.sku ?? "", p.name ?? "", p.costPrice ?? "",
    p.openingStock ?? opening.get(p.id) ?? "", // Never substitute today's stock for missing opening history.
    p.stock ?? "", p.lowStockLevel ?? "", p.active === false ? "Archived" : "Active",
    p.id ?? "", p.createdAt ?? "", p.updatedAt ?? "", p.removedAt ?? "", Boolean(p.image)
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(warehouseColumns, rows), "WAREHOUSE");
  return wb;
}

export function buildCompanyMasterBackup(db, companyId) {
  const company = (db.companies || []).find(c => c.id === companyId);
  if (!company) throw new Error("Select an existing Company to export.");
  const products = new Map((db.products || []).map(p => [p.id, p]));
  const own = (db.productMaster || []).filter(m => m.companyId === company.id);
  const wb = XLSX.utils.book_new();
  for (const marketplace of ["AMAZON", "FLIPKART", "MEESHO"]) {
    const rows = own.filter(m => String(m.marketplace).trim().toUpperCase() === marketplace).map(m => [
      products.get(m.productId)?.sku ?? "", m.marketplaceSku ?? "", m.productName ?? "",
      m.id ?? "", m.productId ?? "", company.id, company.name, m.marketplace ?? "", m.createdAt ?? ""
    ]);
    XLSX.utils.book_append_sheet(wb, sheet(masterColumns, rows), marketplace);
  }
  return wb;
}

export function companyBackupFilename(name, date) {
  const safeName = String(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "Company";
  return `StockPilot_Product_Master_${safeName}_Backup_${date}.xlsx`;
}

export function backupDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
