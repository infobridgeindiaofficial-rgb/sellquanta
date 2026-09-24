import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

// Synchronous, like the existing store transactions: no other request in this
// server can interleave a save between snapshot verification and the commit.
// io/clock injection is for isolated failure tests; HTTP clients cannot supply it.
export function createCompleteReset({ paths, emptyDb, io = fs, now = () => new Date() }) {
  const confirmations = new Map();
  let running = false;
  const readOriginal = () => {
    const bytes = io.readFileSync(paths.dbFile);
    const db = JSON.parse(bytes.toString("utf8"));
    if (!db || !Array.isArray(db.products) || !Array.isArray(db.agents) || !Array.isArray(db.companies)) {
      throw failure("The current database is invalid. Complete Reset was not performed.");
    }
    return { bytes, db };
  };

  return {
    prepare() {
      if (running) throw failure("A reset is already running.", 409);
      const { bytes, db } = readOriginal();
      const token = crypto.randomUUID();
      const expiresAt = now().getTime() + 10 * 60 * 1000;
      // Bound memory even if someone repeatedly opens/cancels confirmation.
      for (const [key, value] of confirmations) if (value.expiresAt <= now().getTime()) confirmations.delete(key);
      if (confirmations.size >= 64) confirmations.delete(confirmations.keys().next().value);
      confirmations.set(token, { sha256: hash(bytes), expiresAt });
      return { token, expiresAt, counts: Object.fromEntries(Object.entries(db).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])) };
    },

    reset({ token, confirmation } = {}) {
      if (confirmation !== "RESET") throw failure("Type RESET exactly to confirm.");
      if (running) throw failure("A reset is already running.", 409);
      const prepared = confirmations.get(token);
      if (!prepared || prepared.expiresAt <= now().getTime()) throw failure("Reset confirmation expired or was already used. Start confirmation again.", 409);
      confirmations.delete(token); // Every attempted destructive request is single-use.
      running = true;
      const ownedTemps = new Set();
      const writeDurably = (file, bytes) => {
        const fd = io.openSync(file, "wx", 0o600);
        ownedTemps.add(file);
        try {
          io.writeFileSync(fd, bytes);
          io.fsyncSync(fd);
        } finally { io.closeSync(fd); }
      };
      const verify = (file, intended, label) => {
        const actual = io.readFileSync(file);
        if (!actual.equals(intended) || hash(actual) !== hash(intended)) throw failure(`${label} verification failed. Nothing was reset.`);
        try { JSON.parse(actual.toString("utf8")); }
        catch { throw failure(`${label} verification failed: invalid JSON. Nothing was reset.`); }
      };
      try {
        const { bytes } = readOriginal();
        if (hash(bytes) !== prepared.sha256) throw failure("Business data changed after confirmation started. Review it and start again.", 409);
        const stamp = now().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\.\d{3}Z$/, "");
        const unique = crypto.randomUUID();
        const folder = path.join(paths.backupDir, "business-reset");
        const backupFile = path.join(folder, `stockpilot-before-reset-${stamp}-${unique}.json`);
        const backupTemp = `${backupFile}.tmp`;
        io.mkdirSync(folder, { recursive: true });
        writeDurably(backupTemp, bytes);
        verify(backupTemp, bytes, "Full backup");
        io.renameSync(backupTemp, backupFile);
        ownedTemps.delete(backupTemp);
        verify(backupFile, bytes, "Published full backup");

        // A new schema whitelist removes even unknown legacy business fields,
        // correction/undo logs and embedded images. Never spread the old database.
        const database = emptyDb();
        const clean = Buffer.from(JSON.stringify(database, null, 2), "utf8");
        const resetTemp = `${paths.dbFile}.business-reset-${unique}.tmp`;
        writeDurably(resetTemp, clean);
        verify(resetTemp, clean, "Fresh database");
        if (!io.readFileSync(paths.dbFile).equals(bytes)) throw failure("Business data changed during backup. Nothing was reset; review and retry.", 409);

        const result = { backup: path.relative(paths.root, backupFile).replace(/\\/g, "/"), sha256: prepared.sha256, database };
        // The only operation that touches the active database; same-directory
        // atomic replacement. No fallible filesystem work follows this commit.
        io.renameSync(resetTemp, paths.dbFile);
        ownedTemps.delete(resetTemp);
        confirmations.clear();
        return result;
      } finally {
        // Only this attempt's uniquely named temporary files, never directories,
        // the original database, published safety backups or historical exports.
        for (const file of ownedTemps) { try { io.unlinkSync(file); } catch {} }
        running = false;
      }
    }
  };
}
