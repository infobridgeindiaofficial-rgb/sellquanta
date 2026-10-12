// Uses the store's synchronous atomic replacement. No asynchronous operation may interleave a receipt.
export function purchaseTransaction(read, save, apply) {
  const db = read();
  const result = apply(db);
  if (!result?.replayed) save(db);
  return result;
}
