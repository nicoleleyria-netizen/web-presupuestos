const SPREADSHEET_ID = 'PASTE_SPREADSHEET_ID_HERE';
const SHEET_NAME = 'Presupuestos';
const HEADER = [
  'id',
  'source',
  'createdAt',
  'fechaPresupuesto',
  'comitente',
  'trabajo',
  'ubicacion',
  'moneda',
  'total',
  'approved',
];

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || 'list').toLowerCase();

  try {
    let result;
    switch (action) {
      case 'ping':
        result = { ok: true, action: 'ping' };
        break;
      case 'list':
        result = { ok: true, records: listRecords_() };
        break;
      case 'create':
        result = { ok: true, record: createRecord_(parseJsonParam_(params.record)) };
        break;
      case 'toggle':
        result = { ok: true, record: toggleRecord_(String(params.id || '')) };
        break;
      case 'delete':
        result = { ok: true, deleted: deleteRecord_(String(params.id || '')) };
        break;
      case 'clear':
        clearRecords_();
        result = { ok: true, cleared: true };
        break;
      default:
        result = { ok: false, error: 'Accion no soportada' };
    }
    return toResponse_(result, params.callback);
  } catch (error) {
    return toResponse_({ ok: false, error: error && error.message ? error.message : String(error) }, params.callback);
  }
}

function listRecords_() {
  const sheet = getSheet_();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const records = rows.slice(1).map(rowToRecord_).filter(Boolean);
  const migrated = migrateIfNeeded_(sheet, records);
  return migrated;
}

function createRecord_(input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const records = listRecords_();
    const record = normalizeRecord_(input, true);

    const last = records[0];
    if (last) {
      const seconds = (new Date(record.createdAt).getTime() - new Date(last.createdAt).getTime()) / 1000;
      const isSame =
        last.comitente === record.comitente &&
        last.trabajo === record.trabajo &&
        Number(last.total) === Number(record.total) &&
        last.moneda === record.moneda;
      if (isSame && seconds < 15) {
        return { duplicate: true, record: last };
      }
    }

    records.unshift(record);
    saveRecords_(sheet, records.slice(0, 500));
    return record;
  } finally {
    lock.releaseLock();
  }
}

function toggleRecord_(id) {
  if (!id) throw new Error('Falta el id');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const records = listRecords_();
    const updated = records.map((record) => {
      if (record.id !== id) return record;
      return { ...record, approved: !record.approved };
    });
    saveRecords_(sheet, updated);
    return updated.find((record) => record.id === id) || null;
  } finally {
    lock.releaseLock();
  }
}

function deleteRecord_(id) {
  if (!id) throw new Error('Falta el id');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const records = listRecords_();
    const updated = records.filter((record) => record.id !== id);
    saveRecords_(sheet, updated);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function clearRecords_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    ensureHeader_(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, HEADER.length).clearContent();
    }
  } finally {
    lock.releaseLock();
  }
}

function saveRecords_(sheet, records) {
  ensureHeader_(sheet);
  const rows = records.map(recordToRow_);
  const dataRows = Math.max(0, sheet.getLastRow() - 1);

  if (dataRows > 0) {
    sheet.getRange(2, 1, dataRows, HEADER.length).clearContent();
  }

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, HEADER.length).setValues(rows);
  }
}

function getSheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === 'PASTE_SPREADSHEET_ID_HERE') {
    throw new Error('Configurá SPREADSHEET_ID en Code.gs');
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }
  ensureHeader_(sheet);
  return sheet;
}

function ensureHeader_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
  const matches = HEADER.every((header, index) => String(firstRow[index] || '') === header);
  if (!matches) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  }
}

function migrateIfNeeded_(sheet, records) {
  const migrated = records.map((record) => normalizeRecord_(record, false));
  const needsWrite = migrated.some((record, index) => {
    const original = records[index] || {};
    return JSON.stringify(original) !== JSON.stringify(record);
  });
  if (needsWrite) {
    saveRecords_(sheet, migrated);
  }
  return migrated;
}

function rowToRecord_(row) {
  if (!row || row.length < 10) return null;
  return normalizeRecord_({
    id: row[0],
    source: row[1],
    createdAt: row[2],
    fechaPresupuesto: row[3],
    comitente: row[4],
    trabajo: row[5],
    ubicacion: row[6],
    moneda: row[7],
    total: row[8],
    approved: row[9],
  }, false);
}

function recordToRow_(record) {
  const normalized = normalizeRecord_(record, false);
  return [
    normalized.id,
    normalized.source,
    normalized.createdAt,
    normalized.fechaPresupuesto,
    normalized.comitente,
    normalized.trabajo,
    normalized.ubicacion,
    normalized.moneda,
    normalized.total,
    normalized.approved ? true : false,
  ];
}

function normalizeRecord_(record, forceNewId) {
  const safeRecord = record && typeof record === 'object' ? record : {};
  return {
    id: forceNewId || !safeRecord.id ? Utilities.getUuid() : String(safeRecord.id),
    source: safeRecord.source ? String(safeRecord.source) : 'pdf',
    createdAt: safeRecord.createdAt ? String(safeRecord.createdAt) : new Date().toISOString(),
    fechaPresupuesto: safeRecord.fechaPresupuesto ? String(safeRecord.fechaPresupuesto) : '',
    comitente: safeRecord.comitente ? String(safeRecord.comitente) : 'Sin nombre',
    trabajo: safeRecord.trabajo ? String(safeRecord.trabajo) : '—',
    ubicacion: safeRecord.ubicacion ? String(safeRecord.ubicacion) : '',
    moneda: safeRecord.moneda ? String(safeRecord.moneda) : 'ARS',
    total: Number(safeRecord.total) || 0,
    approved: safeRecord.approved === true || String(safeRecord.approved).toLowerCase() === 'true',
  };
}

function parseJsonParam_(value) {
  if (!value) return {};
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch (error) {
    return JSON.parse(value);
  }
}

function toResponse_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
