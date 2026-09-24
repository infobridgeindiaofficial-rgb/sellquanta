const API = "http://127.0.0.1:8787/api";

async function json(path, options = {}) {
  const r = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed: ${r.status}`);
  return data;
}

async function backupDownload(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || `Export failed: ${r.status}`);
  }
  const disposition = r.headers.get("Content-Disposition") || "";
  return { blob: await r.blob(), name: disposition.match(/filename="([^"]+)"/)?.[1] || "SellQuanta_Backup.xlsx" };
}

export const api = {
  prepareBusinessReset: () => json("/business-reset/prepare", { method: "POST", body: "{}" }),
  completeBusinessReset: (token, confirmation) => json("/business-reset", { method: "POST", body: JSON.stringify({ token, confirmation }) }),
  exportWarehouseBackup: () => backupDownload("/products/export-backup"),
  exportCompanyBackup: companyId => backupDownload(`/product-master/export-backup?companyId=${encodeURIComponent(companyId)}`),
  state: () => json("/state"),
  health: () => json("/health"),
  backupInfo: () => json("/backup-info"),
  backupNow: () => json("/backup", { method: "POST" }),
  addCompany: name => json("/companies", { method: "POST", body: JSON.stringify({ name }) }),
  renameCompany: (id, name) => json(`/companies/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  removeCompany: id => json(`/companies/${id}`, { method: "DELETE" }),
  addAgent: (name, companyId) => json("/agents", { method: "POST", body: JSON.stringify({ name, companyId }) }),
  setAgentCompany: (id, companyId) => json(`/agents/${id}/company`, { method: "POST", body: JSON.stringify({ companyId }) }),
  deleteAgent: id => json(`/agents/${id}`, { method: "DELETE" }),
  resetAgentWallet: id => json(`/agents/${id}/reset-wallet`, { method: "POST", body: JSON.stringify({ confirm: true }) }),
  addProduct: body => json("/products", { method: "POST", body: JSON.stringify(body) }),
  updateProduct: (id, body) => json(`/products/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  removeProduct: id => json(`/products/${id}`, { method: "DELETE" }),
  updateMasterProduct: (id, productId, updateName) => json(`/product-master/${id}/product`, { method: "POST", body: JSON.stringify({ productId, updateName }) }),
  addMasterProduct: body => json("/product-master", { method: "POST", body: JSON.stringify(body) }),
  removeMasterProduct: id => json(`/product-master/${id}`, { method: "DELETE" }),
  productMasterTemplate: async (companyId, marketplace) => {
    const r = await fetch(`${API}/product-master/template?companyId=${encodeURIComponent(companyId)}&marketplace=${encodeURIComponent(marketplace)}`);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `Request failed: ${r.status}`);
    }
    const cd = r.headers.get("Content-Disposition") || "";
    return { blob: await r.blob(), name: cd.match(/filename="([^"]+)"/)?.[1] || "Product_Master.xlsx" };
  },
  importProductMaster: body => json("/product-master/import", { method: "POST", body: JSON.stringify(body) }),
  setProductImage: (id, image) => json(`/products/${id}/image`, { method: "POST", body: JSON.stringify({ image }) }),
  productImportTemplate: async () => {
    const r = await fetch(`${API}/products/import-template`);
    if (!r.ok) throw new Error(`Request failed: ${r.status}`);
    return r.blob();
  },
  previewProductImport: fileBase64 => json("/products/import-preview", { method: "POST", body: JSON.stringify({ fileBase64 }) }),
  importProducts: fileBase64 => json("/products/import", { method: "POST", body: JSON.stringify({ fileBase64 }) }),
  adjustStock: body => json("/stock-adjust", { method: "POST", body: JSON.stringify(body) }),
  refundSale: saleId => json("/refunds", { method: "POST", body: JSON.stringify({ saleId }) }),
  undoLastBatch: () => json("/sales/undo-last-batch", { method: "POST" }),
  addSales: rows => json("/sales", { method: "POST", body: JSON.stringify(rows) }),
  addPayment: body => json("/payments", { method: "POST", body: JSON.stringify(body) }),
  scanLabel: body => json("/label-scan", { method: "POST", body: JSON.stringify(body) }),
  scanDiagnostics: body => json("/scan-diagnostics", { method: "POST", body: JSON.stringify(body) }),
  monthCloseList: () => json("/month-close"),
  monthClose: (label = "") => json("/month-close", { method: "POST", body: JSON.stringify({ label }) }),
  closeDay: async () => {
    const r = await fetch(`${API}/close-day`, { method: "POST" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || "Close Day failed.");
    }
    const blob = await r.blob();
    const cd = r.headers.get("Content-Disposition") || "";
    const name = cd.match(/filename="([^"]+)"/)?.[1] || "SellQuanta-Daily.xlsx";
    return { blob, name };
  }
};
