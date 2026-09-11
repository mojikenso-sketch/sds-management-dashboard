/**
 * SDS Management backend for Google Apps Script.
 *
 * Run setupSystem() once from the Apps Script editor. It creates the
 * spreadsheet and Drive folder used by this app and stores their IDs in
 * Script Properties.
 */

var SDS_HEADERS = [
  "id", "chemical", "cas", "supplier", "revision", "revisionDate",
  "status", "signalWord", "hazards", "pdfFileId", "pdfName", "updatedAt",
  "reviewDate", "thaiSds", "language"
];

// New installations start empty. SDS records are added by the administrator.
var SAMPLE_ROWS = [];

function doGet(e) {
  var params = (e && e.parameter) || {};

  if (params.action === "api") {
    var response = { ok: true, data: listSds() };
    return jsonResponse_(response, params.callback);
  }

  if (params.action === "file") {
    try {
      return jsonResponse_(getSdsFile(params.fileId || params.id), params.callback);
    } catch (error) {
      return jsonResponse_({ ok: false, error: error.message }, params.callback);
    }
  }

  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("ระบบจัดการ SDS | SDS Management")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) || "{}";
    var payload = JSON.parse(body);
    var action = payload.action;
    var result;

    if (action === "save") {
      result = saveSds(payload.record || {}, payload.file || null);
    } else if (action === "delete") {
      result = deleteSds(payload.id);
    } else {
      throw new Error("ไม่รองรับคำสั่งนี้ / Unsupported action.");
    }

    return jsonResponse_({ ok: true, data: result });
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message });
  }
}

/**
 * One-time setup. Run this function from the Apps Script editor and approve
 * the requested Sheets/Drive permissions.
 */
function setupSystem() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheet = SpreadsheetApp.create("SDS Management Database");
  var sheet = spreadsheet.getSheets()[0];
  sheet.setName("SDS");
  sheet.getRange(1, 1, 1, SDS_HEADERS.length).setValues([SDS_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, SDS_HEADERS.length).setFontWeight("bold");
  sheet.autoResizeColumns(1, SDS_HEADERS.length);

  if (SAMPLE_ROWS.length) {
    sheet.getRange(2, 1, SAMPLE_ROWS.length, SDS_HEADERS.length).setValues(SAMPLE_ROWS);
  }

  var folder = DriveApp.createFolder("SDS PDF Documents");
  var activeEmail = Session.getActiveUser().getEmail();
  var values = {
    SDS_SPREADSHEET_ID: spreadsheet.getId(),
    SDS_FOLDER_ID: folder.getId(),
    ADMIN_EMAILS: activeEmail || Session.getEffectiveUser().getEmail() || ""
  };
  properties.setProperties(values, true);

  return {
    spreadsheetUrl: spreadsheet.getUrl(),
    folderUrl: folder.getUrl(),
    adminEmails: values.ADMIN_EMAILS
  };
}

function listSds() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, SDS_HEADERS.length).getValues();
  return values.filter(function(row) {
    return row[0] !== "" && row[0] !== null;
  }).map(rowToObject_);
}

/**
 * Returns an uploaded PDF through the Apps Script web app instead of sending
 * viewers to Google Drive. The web app must be deployed to execute as the
 * owner and allow anonymous access for public viewers.
 */
function getSdsFile(fileId) {
  var id = clean_(fileId);
  if (!id) throw new Error("ไม่พบรหัสไฟล์ SDS");

  var file = DriveApp.getFileById(id);
  var blob = file.getBlob();
  return {
    ok: true,
    name: file.getName(),
    mimeType: blob.getContentType() || "application/pdf",
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

function saveSds(record, fileData) {
  assertAdmin_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheet_();
    var normalized = normalizeRecord_(record);
    var existing = findRowById_(sheet, normalized.id);
    var oldRow = existing ? sheet.getRange(existing, 1, 1, SDS_HEADERS.length).getValues()[0] : null;
    var pdfFileId = oldRow ? String(oldRow[9] || "") : "";
    var pdfName = oldRow ? String(oldRow[10] || "") : "";

    if (fileData && fileData.base64) {
      var folder = getFolder_();
      var bytes = Utilities.base64Decode(fileData.base64);
      var blob = Utilities.newBlob(bytes, fileData.mimeType || "application/pdf", fileData.name || "SDS.pdf");
      var file = folder.createFile(blob);
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (sharingError) {
        // Workspace administrators may disable public link sharing.
        console.warn(sharingError.message);
      }

      if (pdfFileId) {
        try { DriveApp.getFileById(pdfFileId).setTrashed(true); } catch (ignored) {}
      }
      pdfFileId = file.getId();
      pdfName = file.getName();
    }

    var row = [
      normalized.id,
      normalized.chemical,
      normalized.cas,
      normalized.supplier,
      normalized.revision,
      normalized.revisionDate,
      normalized.status,
      normalized.signalWord,
      normalized.hazards.join("|"),
      pdfFileId,
      pdfName,
      new Date().toISOString(),
      normalized.reviewDate,
      normalized.thaiSds,
      normalized.language
    ];

    if (existing) {
      sheet.getRange(existing, 1, 1, SDS_HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return rowToObject_(row);
  } finally {
    lock.releaseLock();
  }
}

function deleteSds(id) {
  assertAdmin_();
  var sheet = getSheet_();
  var rowNumber = findRowById_(sheet, id);
  if (!rowNumber) return { deleted: false };

  var row = sheet.getRange(rowNumber, 1, 1, SDS_HEADERS.length).getValues()[0];
  if (row[9]) {
    try { DriveApp.getFileById(String(row[9])).setTrashed(true); } catch (ignored) {}
  }
  sheet.deleteRow(rowNumber);
  return { deleted: true };
}

function getSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty("SDS_SPREADSHEET_ID");
  if (!id) throw new Error("ยังไม่ได้ตั้งค่าระบบ กรุณารัน setupSystem() ก่อน");
  var sheet = SpreadsheetApp.openById(id).getSheetByName("SDS");
  if (sheet.getMaxColumns() < SDS_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), SDS_HEADERS.length - sheet.getMaxColumns());
  }
  var header = sheet.getRange(1, 1, 1, SDS_HEADERS.length).getValues()[0];
  if (header.join("|") !== SDS_HEADERS.join("|")) {
    sheet.getRange(1, 1, 1, SDS_HEADERS.length).setValues([SDS_HEADERS]);
  }
  return sheet;
}

function getFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty("SDS_FOLDER_ID");
  if (!id) throw new Error("ยังไม่ได้ตั้งค่าโฟลเดอร์ PDF กรุณารัน setupSystem() ก่อน");
  return DriveApp.getFolderById(id);
}

function findRowById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var target = String(id || "");
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === target) return i + 2;
  }
  return null;
}

function normalizeRecord_(record) {
  var hazards = Array.isArray(record.hazards) ? record.hazards : [];
  hazards = hazards.map(function(item) { return clean_(item); }).filter(String).slice(0, 1);
  var thaiSds = record.thaiSds === true || String(record.thaiSds || "").toLowerCase() === "true";
  var language = clean_(record.language);
  if (["English", "Thai"].indexOf(language) === -1) language = thaiSds ? "Thai" : "English";

  return {
    // The original UI renders IDs inside inline onclick handlers, so keep
    // generated IDs numeric for compatibility with that view.
    id: String(record.id || Date.now()),
    chemical: clean_(record.chemical),
    cas: clean_(record.cas),
    supplier: clean_(record.supplier),
    revision: clean_(record.revision),
    revisionDate: clean_(record.revisionDate),
    reviewDate: clean_(record.reviewDate),
    status: normalizeStatus_(record.status),
    signalWord: ["Danger", "Warning", ""].indexOf(record.signalWord || "") !== -1 ? (record.signalWord || "") : "",
    hazards: hazards,
    thaiSds: thaiSds,
    language: language
  };
}

function normalizeStatus_(status) {
  var value = clean_(status);
  if (value === "Active") return "Current";
  if (value === "Expiring") return "Review Due";
  if (value === "Expired") return "Update Required";
  return ["Current", "Review Due", "Update Required"].indexOf(value) !== -1 ? value : "Current";
}

function clean_(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function rowToObject_(row) {
  var fileId = String(row[9] || "");
  return {
    id: String(row[0]),
    chemical: String(row[1] || ""),
    cas: String(row[2] || ""),
    supplier: String(row[3] || ""),
    revision: String(row[4] || ""),
    revisionDate: formatDateValue_(row[5]),
    status: normalizeStatus_(row[6]),
    signalWord: String(row[7] || ""),
    hazards: String(row[8] || "").split("|").filter(String).slice(0, 1),
    pdfFileId: fileId,
    pdfName: String(row[10] || ""),
    pdfUrl: fileId ? "https://drive.google.com/file/d/" + encodeURIComponent(fileId) + "/preview" : "",
    updatedAt: String(row[11] || ""),
    reviewDate: formatDateValue_(row[12]),
    thaiSds: String(row[13] || "").toLowerCase() === "true",
    language: ["English", "Thai"].indexOf(String(row[14] || "")) !== -1
      ? String(row[14])
      : (String(row[13] || "").toLowerCase() === "true" ? "Thai" : "English")
  };
}

function formatDateValue_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value);
}

function assertAdmin_() {
  var email = String(Session.getActiveUser().getEmail() || "").toLowerCase();
  var configured = PropertiesService.getScriptProperties().getProperty("ADMIN_EMAILS") || "";
  var admins = configured.split(",").map(function(item) { return item.trim().toLowerCase(); }).filter(String);
  if (!email || admins.indexOf(email) === -1) {
    throw new Error("ไม่มีสิทธิ์แก้ไขข้อมูล กรุณาเปิด Apps Script ด้วยบัญชีผู้ดูแลระบบ");
  }
}

function jsonResponse_(value, callback) {
  var json = JSON.stringify(value);
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
