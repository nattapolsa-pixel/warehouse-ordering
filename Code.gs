const APP_CONFIG = {
  spreadsheetId: '1kCChpSKGm2hoXTmEPja6aXsDFK3YIFCv1JAtQspDcuk',
  timezone: 'Asia/Bangkok',
  sheets: {
    orderPun: 'สาขาสั่งสินค้า_Pun',
    orderGfa: 'สาขาสั่งสินค้า_GFA',
    masterBranch: 'Master_Pun&GFA',
    masterItemPun: 'Master_Item_Pun',
    masterItemGfa: 'Master_Item_GFA',
    logs: 'Logs'
  },
  // Admin whitelist: ถ้าต้องการเพิ่ม/ลบ Admin ให้แก้รายชื่ออีเมลตรงนี้แล้ว Deploy Apps Script ใหม่
  adminEmails: [
    'nattapol.sa@pt.co.th',
    'jirawan.ti@pt.co.th',
    'supaporn.ko@pt.co.th'
  ],
  // GitHub Pages / static hosting cannot read the Google Chrome signed-in email directly.
  // Set this Script Property in Apps Script: WAREHOUSE_GOOGLE_CLIENT_ID
  // Admin Google login tokens are stored server-side in CacheService.
  adminLogin: {
    googleClientIdPropertyKey: 'WAREHOUSE_GOOGLE_CLIENT_ID',
    tokenTtlSeconds: 21600
  },
  // n8n integration: ใส่ Production Webhook URL แล้วเปลี่ยน enabled เป็น true เมื่อพร้อมใช้งาน
  n8n: {
    enabled: true,
    webhookUrl: 'https://nattapol11.app.n8n.cloud/webhook/warehouse-order-submitted',
    secret: 'b7472f1c848df4212df932a172927a96717898d28a5917d3b3131725e1c4100f'
  },
  owners: {
    PUN: {
      key: 'PUN',
      label: 'Punthai',
      menuLabel: 'สั่งสินค้า Punthai',
      compCode: '1021',
      cutoffTime: '13:00',
      orderSheet: 'สาขาสั่งสินค้า_Pun',
      masterItemSheet: 'Master_Item_Pun'
    },
    GFA: {
      key: 'GFA',
      label: 'Coffee World',
      menuLabel: 'สั่งสินค้า Coffee World',
      compCode: '1025',
      cutoffTime: '12:00',
      orderSheet: 'สาขาสั่งสินค้า_GFA',
      masterItemSheet: 'Master_Item_GFA'
    }
  },
  // v8: คอลัมน์ A = วันที่สั่งที่ผู้ใช้เลือก + เวลากดบันทึก
  // คอลัมน์ R = วันที่และเวลาบันทึกข้อมูลจริง ณ เวลาที่กดบันทึก
  orderHeaders: [
    'วันที่สั่ง',
    'Owner',
    'COMP_CODE',
    'รหัสสาขา',
    'ชื่อสาขา',
    'เลขที่เอกสาร',
    'ตรวจสอบรอบสั่ง',
    'ITEM_NO',
    'รหัส Item',
    'ชื่อ Item',
    'QTY',
    'ขนาดรรจุสินค้า',
    'UOM',
    'หมายเหตุ',
    'E-mail สาขา',
    'จังหวัด',
    'Status',
    'วันที่และเวลาบันทึกข้อมูล'
  ],
  logHeaders: [
    'Timestamp',
    'Action',
    'Owner',
    'Document_No',
    'Branch_Code',
    'Details',
    'User_Email'
  ]
};

function doGet(e) {
  // API JSON/JSONP endpoint:
  // ตัวอย่าง:
  // ?action=ping
  // ?action=getConfig
  // ?action=fastLookup&ownerKey=PUN
  // ?action=submitOrder&ownerKey=PUN&orderDate=2026-05-21&branchCode=xxx&items=[...]
  // ถ้ามี callback=xxx จะตอบกลับแบบ JSONP เพื่อให้เว็บภายนอก Netlify/Vercel/VS Code เรียกได้ง่าย
  const action = getApiAction_(e);
  if (action) {
    return handlePublicApi_(action, getRequestPayload_(e, false));
  }

  ensureSystemSheets_();

  const template = HtmlService.createTemplateFromFile('Index');
  template.appName = 'Warehouse Ordering System';
  template.configJson = JSON.stringify({
    owners: APP_CONFIG.owners,
    today: Utilities.formatDate(new Date(), APP_CONFIG.timezone, 'yyyy-MM-dd'),
    access: getCurrentUserAccess_()
  });

  return template
    .evaluate()
    .setTitle('Warehouse Ordering System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Public API endpoint สำหรับให้เว็บภายนอก เช่น Vercel / Netlify เรียกใช้งาน
 * วิธีเรียกแบบง่ายสุดจากหน้าเว็บภายนอก:
 * fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'submitOrder', ... }) })
 */
function doPost(e) {
  const payload = getRequestPayload_(e, true);
  const action = getApiAction_(e) || payload.action;
  return handlePublicApi_(action, payload);
}

/**
 * เผื่อบางระบบยิง OPTIONS มาก่อน POST
 */
function doOptions(e) {
  return jsonOutput_({ ok: true, message: 'OK' });
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Warehouse Ordering')
    .addItem('เตรียมชีตระบบ / สร้างหัวตาราง', 'ensureSystemSheets_')
    .addItem('จัดหัวตาราง Order ให้ตรง v9', 'forceOrderSheetHeadersV9')
    .addItem('ซ่อมแถวเก่าที่มีวันที่ส่งเกิน', 'repairOldOrderRowsV8')
    .addItem('ล้าง Cache ระบบ', 'clearSystemCache')
    .addToUi();
}

/**
 * API: โหลด config หลัก
 */
function apiGetConfig(payload) {
  ensureSystemSheets_();
  return {
    ok: true,
    appName: 'Warehouse Ordering System',
    owners: APP_CONFIG.owners,
    today: Utilities.formatDate(new Date(), APP_CONFIG.timezone, 'yyyy-MM-dd'),
    access: getCurrentUserAccess_(payload),
    auth: {
      googleClientId: getPrimaryGoogleClientId_(),
      googleSignInEnabled: !!getPrimaryGoogleClientId_()
    }
  };
}

/**
 * API: ค้นหาสาขาจากรหัสสาขา
 */
function apiLookupBranch(branchCode) {
  try {
    const result = lookupBranch_(branchCode);
    return { ok: true, branch: result };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

/**
 * API: ค้นหา Item จากรหัส Item ตาม Owner
 */
function apiLookupItem(ownerKey, itemCode) {
  try {
    const owner = getOwner_(ownerKey);
    const item = lookupItem_(owner.key, itemCode);
    return { ok: true, item };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

/**
 * API: โหลด Master สำหรับค้นหาแบบเร็วในหน้าเว็บ
 * ใช้ครั้งเดียวต่อ Owner แล้วให้ Browser ค้นหาเองทันที ไม่ต้องยิง Apps Script ทุกครั้งที่พิมพ์
 */
function apiGetFastLookupData(ownerKey) {
  try {
    const owner = getOwner_(ownerKey);
    const branchMap = getBranchMap_();
    const itemRows = readItemRows_(owner.key);
    const itemMap = {};

    itemRows.forEach(function (item) {
      const key = String(item.itemCode || '').trim().toLowerCase();
      if (!key) return;
      itemMap[key] = {
        itemCode: item.itemCode || '',
        itemName: item.itemName || '',
        itemSize: item.itemSize || '',
        uom: item.uom || '',
        found: true
      };
    });

    return {
      ok: true,
      ownerKey: owner.key,
      generatedAt: Utilities.formatDate(new Date(), APP_CONFIG.timezone, 'yyyy-MM-dd HH:mm:ss'),
      branchMap: branchMap,
      itemMap: itemMap,
      itemCount: itemRows.length,
      branchCount: Object.keys(branchMap || {}).length
    };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

/**
 * API: ตรวจ Context ก่อน Submit เช่น ชื่อสาขา เลขเอกสาร รอบสั่ง
 */
function apiValidateOrderContext(payload) {
  try {
    const owner = getOwner_(payload.ownerKey);
    const branch = lookupBranch_(payload.branchCode);
    const orderDate = parseIsoDate_(payload.orderDate);
    const docNo = buildDocumentNo_(branch.branchCode, orderDate);
    const cycleStatus = checkOrderCycle_(orderDate, branch.cycleText);

    return {
      ok: true,
      context: {
        owner: owner.key,
        ownerLabel: owner.label,
        compCode: owner.compCode,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        branchEmail: branch.branchEmail || '',
        branchZone: branch.branchZone || '',
        cycleText: branch.cycleText,
        documentNo: docNo,
        orderCycleStatus: cycleStatus.status,
        orderDay: cycleStatus.dayShort,
        orderDayTh: cycleStatus.dayThai
      }
    };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

/**
 * API: บันทึกคำสั่งสินค้า
 * payload = {
 *   ownerKey: "PUN" | "GFA",
 *   orderDate: "yyyy-MM-dd",
 *   branchCode: "...",
 *   branchEmail: "...",
 *   branchZone: "...",
 *   items: [{ itemCode, qty, note }]
 * }
 */
function apiSubmitOrder(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    ensureSystemSheets_();

    const owner = getOwner_(payload.ownerKey);
    const orderDateOnly = parseIsoDate_(payload.orderDate);
    const now = new Date();
    
    const cutoffStr = owner.cutoffTime || '11:00';
    const [cutH, cutM] = cutoffStr.split(':').map(Number);
    const currentH = now.getHours();
    const currentM = now.getMinutes();
    if (currentH > cutH || (currentH === cutH && currentM > cutM)) {
      throw new Error('ไม่สามารถบันทึกคำสั่งซื้อได้ เนื่องจากเลยเวลา Cut-off (' + cutoffStr + ' น.) ของวันนี้ไปแล้ว');
    }

    const orderDateWithSubmitTime = mergeDateWithTime_(orderDateOnly, now);

    const branch = lookupBranch_(payload.branchCode);
    const cycle = checkOrderCycle_(orderDateOnly, branch.cycleText);
    const documentNo = buildDocumentNo_(branch.branchCode, orderDateOnly);
    const branchEmail = normalizeText_(payload.branchEmail) || branch.branchEmail || '';
    const branchZone = normalizeText_(payload.branchZone) || branch.branchZone || '';

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const cleanItems = rawItems
      .map(function (item) {
        return {
          itemCode: normalizeText_(item.itemCode),
          qty: Number(item.qty || 0),
          note: normalizeText_(item.note)
        };
      })
      .filter(function (item) {
        return item.itemCode && item.qty > 0;
      });

    if (!cleanItems.length) {
      throw new Error('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ และจำนวนต้องมากกว่า 0');
    }

    const ss = getSs_();
    const sh = getOrCreateSheet_(ss, owner.orderSheet);
    ensureHeaders_(sh, APP_CONFIG.orderHeaders, true);

    const email = getUserEmail_();
    const rows = [];

    cleanItems.forEach(function (item, index) {
      const itemInfo = lookupItem_(owner.key, item.itemCode);
      rows.push([
        orderDateWithSubmitTime,
        owner.key,
        owner.compCode,
        branch.branchCode,
        branch.branchName,
        documentNo,
        cycle.status,
        index + 1,
        itemInfo.itemCode,
        itemInfo.itemName,
        item.qty,
        itemInfo.itemSize || '',
        itemInfo.uom || '',
        item.note,
        branchEmail,
        branchZone,
        'รอดำเนินการ',
        now
      ]);
    });

    if (rows.length) {
      const startRow = sh.getLastRow() + 1;
      sh.getRange(startRow, 1, rows.length, APP_CONFIG.orderHeaders.length).setValues(rows);
      paintOrderCycleCells_(sh, startRow, rows.length, cycle.status);
      formatOrderSheet_(sh);
    }

    appendLog_({
      action: 'SUBMIT_ORDER',
      owner: owner.key,
      documentNo,
      branchCode: branch.branchCode,
      details: 'บันทึกคำสั่งสินค้า ' + rows.length + ' รายการ',
      email
    });

    clearDashboardCache_();

    notifyN8nOrderSubmitted_({
      owner: owner,
      branch: branch,
      branchEmail: branchEmail,
      branchZone: branchZone,
      documentNo: documentNo,
      orderDate: orderDateOnly,
      submittedAt: now,
      submittedBy: email,
      cycle: cycle,
      items: cleanItems.map(function (item, index) {
        const itemInfo = lookupItem_(owner.key, item.itemCode);
        return {
          itemNo: index + 1,
          itemCode: itemInfo.itemCode,
          itemName: itemInfo.itemName,
          itemSize: itemInfo.itemSize || '',
          uom: itemInfo.uom || '',
          qty: item.qty,
          note: item.note,
          found: itemInfo.found !== false
        };
      })
    });

    return {
      ok: true,
      message: 'บันทึกคำสั่งสินค้าเรียบร้อย',
      result: {
        documentNo,
        owner: owner.key,
        compCode: owner.compCode,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        branchEmail: branchEmail,
        branchZone: branchZone,
        totalItems: rows.length,
        orderCycleStatus: cycle.status,
        orderDay: cycle.dayShort
      }
    };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

/**
 * API: ดูประวัติคำสั่งสินค้าล่าสุด
 */
function apiGetRecentOrders(ownerKey, limit, branchCode, payload) {
  try {
    const owner = getOwner_(ownerKey);
    const access = getCurrentUserAccess_(payload);
    const requestedBranchCode = normalizeText_(branchCode);
    if (!access.isAdmin && !requestedBranchCode) {
      throw new Error('ผู้ใช้งานทั่วไปต้องระบุรหัสสาขาเพื่อดูประวัติ');
    }
    const max = Math.min(Number(limit || 80), 300);
    const ss = getSs_();
    const sh = ss.getSheetByName(owner.orderSheet);
    if (!sh || sh.getLastRow() < 2) {
      return { ok: true, rows: [] };
    }

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(sh.getLastColumn(), APP_CONFIG.orderHeaders.length);
    const startRow = Math.max(2, lastRow - max + 1);
    const values = sh.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getValues();
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];

    const rows = values
      .map(function (r) {
        return rowToObject_(headers, r);
      })
      .reverse()
      .filter(function (obj) {
        if (access.isAdmin || !requestedBranchCode) return true;
        return normalizeText_(obj['รหัสสาขา']).toLowerCase() === requestedBranchCode.toLowerCase();
      })
      .map(function (obj) {
        return {
          timestamp: formatDateTime_(obj['วันที่สั่ง']),
          orderDate: formatDateTime_(obj['วันที่สั่ง']),
          owner: obj.Owner || '',
          compCode: obj.COMP_CODE || '',
          branchCode: obj['รหัสสาขา'] || '',
          branchName: obj['ชื่อสาขา'] || '',
          branchEmail: obj['E-mail สาขา'] || '',
          branchZone: obj['จังหวัด'] || obj['เขต'] || '',
          documentNo: obj['เลขที่เอกสาร'] || '',
          cycleStatus: obj['ตรวจสอบรอบสั่ง'] || '',
          itemNo: obj.ITEM_NO || '',
          itemCode: obj['รหัส Item'] || '',
          itemName: obj['ชื่อ Item'] || '',
          itemSize: obj['ขนาดรรจุสินค้า'] || '',
          uom: obj.UOM || '',
          qty: obj.QTY || obj['จำนวนสั่ง'] || '',
          note: obj['หมายเหตุ'] || '',
          status: obj.Status || ''
        };
      });

    return { ok: true, rows };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

/**
 * API: คำสั่งซื้อของสาขา สำหรับผู้ใช้งานทั่วไป
 * สรุปตามเลขที่เอกสาร เพื่อให้ดูง่ายกว่าประวัติแบบรายแถวของ Admin
 */
function apiGetMyOrders(ownerKey, branchCode, limit) {
  try {
    const owner = getOwner_(ownerKey);
    const requestedBranchCode = normalizeText_(branchCode);
    if (!requestedBranchCode) {
      throw new Error('กรุณาระบุรหัสสาขาเพื่อดูคำสั่งซื้อของตัวเอง');
    }

    const maxDocs = Math.min(Math.max(Number(limit || 80), 1), 200);
    const ss = getSs_();
    const sh = ss.getSheetByName(owner.orderSheet);
    if (!sh || sh.getLastRow() < 2) {
      return {
        ok: true,
        owner: owner.key,
        branchCode: requestedBranchCode,
        orders: [],
        summary: { totalDocuments: 0, totalRows: 0, totalQty: 0 }
      };
    }

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(sh.getLastColumn(), APP_CONFIG.orderHeaders.length);
    const readRows = Math.min(lastRow - 1, 2000);
    const startRow = Math.max(2, lastRow - readRows + 1);
    const values = sh.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getValues();
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    const docs = {};
    const orders = [];

    for (let i = values.length - 1; i >= 0; i--) {
      const obj = rowToObject_(headers, values[i]);
      const rowBranchCode = normalizeText_(obj['รหัสสาขา']);
      if (rowBranchCode.toLowerCase() !== requestedBranchCode.toLowerCase()) continue;

      const docNo = normalizeText_(obj['เลขที่เอกสาร']) || 'ไม่ระบุเลขที่เอกสาร';
      if (!docs[docNo]) {
        if (orders.length >= maxDocs) continue;
        docs[docNo] = {
          documentNo: docNo,
          orderDate: formatDateTime_(obj['วันที่สั่ง']),
          submittedAt: formatDateTime_(obj['วันที่และเวลาบันทึกข้อมูล']),
          owner: obj.Owner || owner.key,
          compCode: obj.COMP_CODE || owner.compCode,
          branchCode: obj['รหัสสาขา'] || requestedBranchCode,
          branchName: obj['ชื่อสาขา'] || '',
          branchZone: obj['จังหวัด'] || obj['เขต'] || '',
          status: obj.Status || 'รอดำเนินการ',
          cycleStatus: obj['ตรวจสอบรอบสั่ง'] || '',
          totalRows: 0,
          totalQty: 0,
          items: []
        };
        orders.push(docs[docNo]);
      }

      const doc = docs[docNo];
      const qty = Number(obj.QTY || obj['จำนวนสั่ง'] || 0);
      doc.totalRows += 1;
      doc.totalQty += qty;
      doc.items.push({
        itemNo: obj.ITEM_NO || '',
        itemCode: obj['รหัส Item'] || '',
        itemName: obj['ชื่อ Item'] || '',
        itemSize: obj['ขนาดรรจุสินค้า'] || '',
        uom: obj.UOM || '',
        qty: qty,
        note: obj['หมายเหตุ'] || ''
      });
    }

    orders.forEach(function (doc) {
      doc.items.sort(function (a, b) {
        return Number(a.itemNo || 0) - Number(b.itemNo || 0);
      });
    });

    const summary = orders.reduce(function (acc, doc) {
      acc.totalDocuments += 1;
      acc.totalRows += Number(doc.totalRows || 0);
      acc.totalQty += Number(doc.totalQty || 0);
      return acc;
    }, { totalDocuments: 0, totalRows: 0, totalQty: 0 });

    return {
      ok: true,
      owner: owner.key,
      ownerLabel: owner.label,
      branchCode: requestedBranchCode,
      orders: orders,
      summary: summary
    };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

/**
 * API: Dashboard สรุปตาม Owner
 */
function apiGetDashboard(ownerKey, daysBack, targetDate, payload) {
  try {
    requireAdmin_(payload);
    const owner = getOwner_(ownerKey);
    const days = Math.min(Math.max(Number(daysBack || 30), 1), 365);
    const cacheKey = 'dashboard_' + owner.key + '_' + days + '_' + (targetDate || '');
    const cached = getCacheJson_(cacheKey);
    if (cached) return { ok: true, dashboard: cached, cached: true };

    const ss = getSs_();
    const sh = ss.getSheetByName(owner.orderSheet);
    if (!sh || sh.getLastRow() < 2) {
      const empty = buildEmptyDashboard_(owner.key);
      setCacheJson_(cacheKey, empty, 120);
      return { ok: true, dashboard: empty };
    }

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(sh.getLastColumn(), APP_CONFIG.orderHeaders.length);
    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values.shift();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const docSet = {};
    const branchSet = {};
    const topItemMap = {};
    const dailyMap = {};
    const statusMap = {};
    let totalRows = 0;
    let totalQty = 0;
    let inCycle = 0;
    let outCycle = 0;

    values.forEach(function (r) {
      const obj = rowToObject_(headers, r);
      const orderDate = asDate_(obj['วันที่สั่ง']) || asDate_(obj.Timestamp);
      if (!orderDate) return;

      if (targetDate) {
        const formattedDate = Utilities.formatDate(orderDate, APP_CONFIG.timezone, 'yyyy-MM-dd');
        if (formattedDate !== targetDate) return;
      } else {
        if (orderDate < cutoff) return;
      }

      totalRows++;
      const doc = String(obj['เลขที่เอกสาร'] || '');
      const branchCode = String(obj['รหัสสาขา'] || '');
      const branchName = String(obj['ชื่อสาขา'] || '');
      const itemCode = String(obj['รหัส Item'] || '');
      const itemName = String(obj['ชื่อ Item'] || '');
      const qty = Number(obj.QTY || obj['จำนวนสั่ง'] || 0);
      const cycleStatus = String(obj['ตรวจสอบรอบสั่ง'] || '');
      const status = String(obj.Status || 'ไม่ระบุ');

      if (doc) docSet[doc] = true;
      if (branchCode) branchSet[branchCode] = branchName || branchCode;
      totalQty += qty;

      if (cycleStatus === 'รอบสั่งสาขา') inCycle++;
      if (cycleStatus === 'ไม่ใช่รอบสาขา') outCycle++;

      const key = itemCode + '|' + itemName;
      if (!topItemMap[key]) {
        topItemMap[key] = { itemCode, itemName, qty: 0, count: 0 };
      }
      topItemMap[key].qty += qty;
      topItemMap[key].count += 1;

      const dayKey = orderDate ? Utilities.formatDate(orderDate, APP_CONFIG.timezone, 'yyyy-MM-dd') : 'ไม่ระบุ';
      if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, docs: {}, rows: 0, qty: 0 };
      dailyMap[dayKey].rows += 1;
      dailyMap[dayKey].qty += qty;
      if (doc) dailyMap[dayKey].docs[doc] = true;

      if (!statusMap[status]) statusMap[status] = 0;
      statusMap[status]++;
    });

    const topItems = Object.keys(topItemMap)
      .map(function (k) { return topItemMap[k]; })
      .sort(function (a, b) { return b.qty - a.qty; })
      .slice(0, 10);

    const daily = Object.keys(dailyMap)
      .sort()
      .map(function (k) {
        return {
          date: k,
          docs: Object.keys(dailyMap[k].docs).length,
          rows: dailyMap[k].rows,
          qty: dailyMap[k].qty
        };
      });

    const statuses = Object.keys(statusMap).map(function (k) {
      return { status: k, count: statusMap[k] };
    });

    const dashboard = {
      owner: owner.key,
      label: owner.label,
      daysBack: days,
      totalDocuments: Object.keys(docSet).length,
      totalRows: totalRows,
      totalQty: totalQty,
      totalBranches: Object.keys(branchSet).length,
      inCycle: inCycle,
      outCycle: outCycle,
      topItems: topItems,
      daily: daily,
      statuses: statuses,
      updatedAt: formatDateTime_(new Date())
    };

    setCacheJson_(cacheKey, dashboard, 120);
    return { ok: true, dashboard: dashboard };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

/**
 * API: Export รายการตามวันที่รอบสั่ง
 * เลือก Owner + วันที่รอบสั่ง แล้วระบบแยกแถวพร้อม Export ออกจากแถวที่ต้องตรวจ
 */
function apiGetCycleExport(ownerKey, cycleDate, payload) {
  try {
    requireAdmin_(payload);
    const owner = getOwner_(ownerKey);
    const selectedDate = parseIsoDate_(cycleDate);
    const selectedDateKey = getDateKey_(selectedDate);
    const cutoffDate = buildCutoffDate_(owner, selectedDate);
    const exportHeaders = APP_CONFIG.orderHeaders.filter(function (header) {
      return header !== 'Status';
    });

    const ss = getSs_();
    const sh = ss.getSheetByName(owner.orderSheet);
    if (!sh || sh.getLastRow() < 2) {
      return {
        ok: true,
        export: buildEmptyCycleExport_(owner, selectedDate, cutoffDate, exportHeaders)
      };
    }

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(sh.getLastColumn(), APP_CONFIG.orderHeaders.length);
    const data = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = data.shift();
    const branchMap = getBranchMap_();
    const itemMap = buildItemCodeMap_(owner.key);
    const duplicateCounter = {};
    const cycleRows = [];

    data.forEach(function (row, index) {
      const obj = rowToObject_(headers, row);
      const orderDate = asDate_(obj['วันที่สั่ง']);
      if (!orderDate || getDateKey_(orderDate) !== selectedDateKey) return;

      const documentNo = normalizeText_(obj['เลขที่เอกสาร']);
      const itemCode = normalizeText_(obj['รหัส Item']);
      const duplicateKey = documentNo + '|' + itemCode.toLowerCase();
      if (documentNo && itemCode) {
        duplicateCounter[duplicateKey] = (duplicateCounter[duplicateKey] || 0) + 1;
      }

      cycleRows.push({
        rowNumber: index + 2,
        source: obj,
        duplicateKey: duplicateKey
      });
    });

    const readyRows = [];
    const issueRows = [];
    let lateRows = 0;
    let outOfCycleRows = 0;
    let totalQty = 0;

    cycleRows.forEach(function (row) {
      const obj = row.source;
      const issues = [];
      const branchCode = normalizeText_(obj['รหัสสาขา']);
      const itemCode = normalizeText_(obj['รหัส Item']);
      const qty = Number(obj.QTY || obj['จำนวนสั่ง'] || 0);
      const submittedAt = asDate_(obj['วันที่และเวลาบันทึกข้อมูล']) || asDate_(obj['วันที่สั่ง']);
      const branch = branchMap[branchCode.toLowerCase()];

      totalQty += qty || 0;

      if (!branchCode) {
        issues.push('ไม่มีรหัสสาขา');
      } else if (!branch) {
        issues.push('ไม่พบสาขาใน Master');
      } else {
        const cycle = checkOrderCycle_(selectedDate, branch.cycleText);
        if (cycle.status !== 'รอบสั่งสาขา') {
          issues.push('สาขานี้ไม่ใช่รอบสั่งของวันที่เลือก');
          outOfCycleRows++;
        }
      }

      if (!submittedAt) {
        issues.push('ไม่พบเวลาบันทึกข้อมูล');
      } else if (submittedAt > cutoffDate) {
        issues.push('ส่งหลัง Cut-off ' + owner.cutoffTime);
        lateRows++;
      }

      if (!itemCode) {
        issues.push('ไม่มีรหัส Item');
      } else if (!itemMap[itemCode.toLowerCase()] || normalizeText_(obj['ชื่อ Item']) === 'ไม่พบใน Master Item') {
        issues.push('Item ไม่พบใน Master');
      }

      if (!qty || qty <= 0) {
        issues.push('QTY ต้องมากกว่า 0');
      }

      if (row.duplicateKey && duplicateCounter[row.duplicateKey] > 1) {
        issues.push('Item ซ้ำในเลขที่เอกสารเดียวกัน');
      }

      const exportValues = buildCycleExportValues_(exportHeaders, obj);
      const exportRow = {
        rowNumber: row.rowNumber,
        orderDate: formatDateTime_(obj['วันที่สั่ง']),
        submittedAt: formatDateTime_(submittedAt),
        owner: obj.Owner || owner.key,
        compCode: obj.COMP_CODE || owner.compCode,
        branchCode: branchCode,
        branchName: obj['ชื่อสาขา'] || '',
        documentNo: obj['เลขที่เอกสาร'] || '',
        cycleStatus: obj['ตรวจสอบรอบสั่ง'] || '',
        itemNo: obj.ITEM_NO || '',
        itemCode: itemCode,
        itemName: obj['ชื่อ Item'] || '',
        itemSize: obj['ขนาดรรจุสินค้า'] || '',
        uom: obj.UOM || '',
        qty: qty,
        note: obj['หมายเหตุ'] || '',
        branchEmail: obj['E-mail สาขา'] || '',
        branchZone: obj['จังหวัด'] || obj['เขต'] || '',
        issues: issues,
        exportValues: exportValues
      };

      if (issues.length) issueRows.push(exportRow);
      else readyRows.push(exportRow);
    });

    return {
      ok: true,
      export: {
        owner: owner.key,
        ownerLabel: owner.label,
        orderSheet: owner.orderSheet,
        cycleDate: selectedDateKey,
        cycleDay: checkOrderCycle_(selectedDate, '').dayThai,
        cutoffTime: owner.cutoffTime,
        cutoffAt: formatDateTime_(cutoffDate),
        exportHeaders: exportHeaders,
        totalRows: cycleRows.length,
        readyRows: readyRows,
        issueRows: issueRows,
        totalQty: totalQty,
        lateRows: lateRows,
        outOfCycleRows: outOfCycleRows,
        generatedAt: formatDateTime_(new Date())
      }
    };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

/**
 * API: ค้นหา Master Item
 */
function apiSearchMasterItems(ownerKey, keyword, limit, payload) {
  try {
    requireAdmin_(payload);
    const owner = getOwner_(ownerKey);
    const max = Math.min(Number(limit || 30), 100);
    const q = normalizeText_(keyword).toLowerCase();

    const rows = readItemRows_(owner.key);
    const result = rows
      .filter(function (item) {
        if (!q) return true;
        return (
          String(item.itemCode).toLowerCase().indexOf(q) > -1 ||
          String(item.itemName).toLowerCase().indexOf(q) > -1 ||
          String(item.itemSize || '').toLowerCase().indexOf(q) > -1 ||
          String(item.uom || '').toLowerCase().indexOf(q) > -1
        );
      })
      .slice(0, max);

    return { ok: true, rows: result };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

/**
 * API: เพิ่ม/แก้ไข Master Item แบบง่าย
 * หมายเหตุ: ใช้รหัส Item เป็น Key, ชื่อ Item จะอยู่ Column C ตาม requirement
 */
function apiUpsertMasterItem(ownerKey, item, payload) {
  requireAdmin_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const owner = getOwner_(ownerKey);
    const itemCode = normalizeText_(item.itemCode);
    const itemName = normalizeText_(item.itemName);
    const itemSize = normalizeText_(item.itemSize);
    const uom = normalizeText_(item.uom);

    if (!itemCode) throw new Error('กรุณาระบุรหัส Item');
    if (!itemName) throw new Error('กรุณาระบุชื่อ Item');

    const ss = getSs_();
    const sh = getOrCreateSheet_(ss, owner.masterItemSheet);
    const lastRow = Math.max(sh.getLastRow(), 1);
    const lastCol = Math.max(sh.getLastColumn(), 7);

    if (lastRow === 1 && !normalizeText_(sh.getRange(1, 1).getValue())) {
      sh.getRange(1, 1, 1, 7).setValues([['Owner', 'PRODUCTCODE', 'PRODUCTNAME', 'PRODUCTQTY', 'ขนาดรรจุสินค้า', 'บรรจุ', 'UOM']]);
    }

    const data = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), Math.max(sh.getLastColumn(), 7)).getValues();
    const cols = detectItemColumns_(data[0]);
    let foundRow = 0;

    for (let i = 1; i < data.length; i++) {
      if (normalizeText_(data[i][cols.codeIndex]).toLowerCase() === itemCode.toLowerCase()) {
        foundRow = i + 1;
        break;
      }
    }

    if (foundRow) {
      sh.getRange(foundRow, cols.codeIndex + 1).setValue(itemCode);
      sh.getRange(foundRow, cols.nameIndex + 1).setValue(itemName);
      sh.getRange(foundRow, cols.sizeIndex + 1).setValue(itemSize);
      sh.getRange(foundRow, cols.uomIndex + 1).setValue(uom);
    } else {
      const newRow = new Array(Math.max(sh.getLastColumn(), 7)).fill('');
      if (newRow.length > 0) newRow[0] = owner.key;
      newRow[cols.codeIndex] = itemCode;
      newRow[cols.nameIndex] = itemName;
      newRow[cols.sizeIndex] = itemSize;
      newRow[cols.uomIndex] = uom;
      sh.appendRow(newRow);
    }

    clearItemCache_(owner.key);

    appendLog_({
      action: foundRow ? 'UPDATE_MASTER_ITEM' : 'ADD_MASTER_ITEM',
      owner: owner.key,
      documentNo: '',
      branchCode: '',
      details: itemCode + ' - ' + itemName + (itemSize ? ' | ขนาด: ' + itemSize : '') + (uom ? ' | UOM: ' + uom : ''),
      email: getUserEmail_()
    });

    return {
      ok: true,
      message: foundRow ? 'แก้ไข Master Item เรียบร้อย' : 'เพิ่ม Master Item เรียบร้อย',
      item: { itemCode, itemName, itemSize, uom }
    };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

/**
 * API: อ่าน Logs ล่าสุด
 */
function apiGetLogs(limit, payload) {
  try {
    requireAdmin_(payload);
    const max = Math.min(Number(limit || 50), 200);
    const ss = getSs_();
    const sh = ss.getSheetByName(APP_CONFIG.sheets.logs);
    if (!sh || sh.getLastRow() < 2) return { ok: true, rows: [] };

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(sh.getLastColumn(), APP_CONFIG.logHeaders.length);
    const startRow = Math.max(2, lastRow - max + 1);
    const data = sh.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getValues();
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];

    const rows = data.reverse().map(function (r) {
      const obj = rowToObject_(headers, r);
      return {
        timestamp: formatDateTime_(obj.Timestamp),
        action: obj.Action || '',
        owner: obj.Owner || '',
        documentNo: obj.Document_No || '',
        branchCode: obj.Branch_Code || '',
        details: obj.Details || '',
        userEmail: obj.User_Email || ''
      };
    });

    return { ok: true, rows: rows };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}


/**
 * v8: บังคับหัวตารางคำสั่งซื้อให้ตรงกับโครงใหม่
 * ใช้เมนู Warehouse Ordering > จัดหัวตาราง Order ให้ตรง v9
 */
function forceOrderSheetHeadersV9() {
  const ss = getSs_();
  [APP_CONFIG.sheets.orderPun, APP_CONFIG.sheets.orderGfa].forEach(function (sheetName) {
    const sh = getOrCreateSheet_(ss, sheetName);
    ensureHeaders_(sh, APP_CONFIG.orderHeaders, true);
    formatOrderSheet_(sh);
  });
  SpreadsheetApp.getActive().toast('จัดหัวตาราง Order v9 เรียบร้อย', 'Warehouse Ordering', 5);
}

function forceOrderSheetHeadersV8() {
  return forceOrderSheetHeadersV9();
}

/**
 * v8: ซ่อมข้อมูลเก่าที่เคยบันทึกแบบมี Timestamp ปัจจุบันเกินมา 1 ช่อง
 * เงื่อนไขการซ่อม: A และ B เป็นวันที่, C เป็น Owner, D เป็น COMP_CODE
 * ระบบจะเลื่อนข้อมูลแถวนั้นไปทางซ้าย 1 ช่อง โดยไม่แตะแถวที่ถูกต้องแล้ว
 */
function repairOldOrderRowsV8() {
  const ss = getSs_();
  let repaired = 0;

  [APP_CONFIG.sheets.orderPun, APP_CONFIG.sheets.orderGfa].forEach(function (sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;

    ensureHeaders_(sh, APP_CONFIG.orderHeaders, true);

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(sh.getLastColumn(), APP_CONFIG.orderHeaders.length + 3);
    const range = sh.getRange(2, 1, lastRow - 1, lastCol);
    const values = range.getValues();
    let changed = false;

    values.forEach(function (row) {
      const colAIsDate = Object.prototype.toString.call(row[0]) === '[object Date]' && !isNaN(row[0]);
      const colBIsDate = Object.prototype.toString.call(row[1]) === '[object Date]' && !isNaN(row[1]);
      const colC = normalizeText_(row[2]).toUpperCase();
      const colD = normalizeText_(row[3]);
      const looksOldShifted = colAIsDate && colBIsDate && (colC === 'PUN' || colC === 'GFA') && (colD === '1021' || colD === '1025');

      if (looksOldShifted) {
        for (let i = 0; i < lastCol - 1; i++) {
          row[i] = row[i + 1];
        }
        row[lastCol - 1] = '';
        repaired++;
        changed = true;
      }
    });

    if (changed) {
      range.setValues(values);
      formatOrderSheet_(sh);
    }
  });

  SpreadsheetApp.getActive().toast('ซ่อมแถวเก่าแล้ว ' + repaired + ' แถว', 'Warehouse Ordering', 5);
}

// Backward compatible aliases เผื่อยังมีเมนู/Trigger เดิมค้างอยู่
function forceOrderSheetHeadersV7() {
  return forceOrderSheetHeadersV8();
}

function repairOldOrderRowsV7() {
  return repairOldOrderRowsV8();
}

function clearSystemCache() {
  CacheService.getScriptCache().removeAll([
    'branch_map',
    'branch_map_v3_multi_rows',
    'branch_map_v5_extra_fields',
    'branch_map_v6_sla_extra_fields',
    'item_rows_PUN',
    'item_rows_GFA',
    'item_rows_v5_PUN',
    'item_rows_v5_GFA',
    'dashboard_PUN_30',
    'dashboard_GFA_30',
    'dashboard_PUN_90',
    'dashboard_GFA_90'
  ]);
  SpreadsheetApp.getActive().toast('ล้าง Cache ระบบแล้ว', 'Warehouse Ordering', 5);
}

/* =========================
 * Internal Helpers
 * ========================= */

function getSs_() {
  return SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
}

function getOwner_(ownerKey) {
  const key = normalizeText_(ownerKey).toUpperCase();
  const owner = APP_CONFIG.owners[key];
  if (!owner) {
    throw new Error('Owner ไม่ถูกต้อง');
  }
  return owner;
}

function ensureSystemSheets_() {
  const ss = getSs_();

  const orderPun = getOrCreateSheet_(ss, APP_CONFIG.sheets.orderPun);
  ensureHeaders_(orderPun, APP_CONFIG.orderHeaders, true);
  formatOrderSheet_(orderPun);

  const orderGfa = getOrCreateSheet_(ss, APP_CONFIG.sheets.orderGfa);
  ensureHeaders_(orderGfa, APP_CONFIG.orderHeaders, true);
  formatOrderSheet_(orderGfa);

  const logs = getOrCreateSheet_(ss, APP_CONFIG.sheets.logs);
  ensureHeaders_(logs, APP_CONFIG.logHeaders);
  logs.setFrozenRows(1);

  getOrCreateSheet_(ss, APP_CONFIG.sheets.masterBranch);
  getOrCreateSheet_(ss, APP_CONFIG.sheets.masterItemPun);
  getOrCreateSheet_(ss, APP_CONFIG.sheets.masterItemGfa);

  return true;
}

function getOrCreateSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function ensureHeaders_(sh, headers, forceRewrite) {
  const lastCol = Math.max(sh.getLastColumn(), headers.length);

  if (forceRewrite) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (lastCol > headers.length) {
      sh.getRange(1, headers.length + 1, 1, lastCol - headers.length).clearContent();
    }
    sh.setFrozenRows(1);
    return;
  }

  const firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasAny = firstRow.some(function (v) { return normalizeText_(v); });

  if (!hasAny) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    headers.forEach(function (h, i) {
      if (current.indexOf(h) === -1 && !normalizeText_(current[i])) {
        sh.getRange(1, i + 1).setValue(h);
      }
    });
  }

  sh.setFrozenRows(1);
}



function paintOrderCycleCells_(sh, startRow, numRows, cycleStatus) {
  if (!sh || !startRow || !numRows) return;

  const range = sh.getRange(startRow, 7, numRows, 1); // Column G = ตรวจสอบรอบสั่ง

  if (cycleStatus === 'รอบสั่งสาขา') {
    range
      .setBackground('#dcfce7')
      .setFontColor('#166534')
      .setFontWeight('bold');
    return;
  }

  if (cycleStatus === 'ไม่ใช่รอบสาขา') {
    range
      .setBackground('#fee2e2')
      .setFontColor('#991b1b')
      .setFontWeight('bold');
    return;
  }

  range
    .setBackground(null)
    .setFontColor(null)
    .setFontWeight('normal');
}

function applyOrderCycleColors_(sh) {
  if (!sh || sh.getLastRow() < 2) return;

  const values = sh.getRange(2, 7, sh.getLastRow() - 1, 1).getValues(); // Column G
  const backgrounds = [];
  const fontColors = [];
  const fontWeights = [];

  values.forEach(function (row) {
    const text = normalizeText_(row[0]);
    if (text === 'รอบสั่งสาขา') {
      backgrounds.push(['#dcfce7']);
      fontColors.push(['#166534']);
      fontWeights.push(['bold']);
    } else if (text === 'ไม่ใช่รอบสาขา') {
      backgrounds.push(['#fee2e2']);
      fontColors.push(['#991b1b']);
      fontWeights.push(['bold']);
    } else {
      backgrounds.push([null]);
      fontColors.push([null]);
      fontWeights.push(['normal']);
    }
  });

  sh.getRange(2, 7, values.length, 1)
    .setBackgrounds(backgrounds)
    .setFontColors(fontColors)
    .setFontWeights(fontWeights);
}

function formatOrderSheet_(sh) {
  if (sh.getLastRow() < 1) return;
  sh.setFrozenRows(1);

  const lastCol = Math.max(sh.getLastColumn(), APP_CONFIG.orderHeaders.length);
  sh.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sh.autoResizeColumns(1, Math.min(lastCol, 18));

  if (sh.getLastRow() > 1) {
    // Column A: วันที่สั่งที่ผู้ใช้เลือก + เวลากดบันทึก
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    // Column R: วันที่และเวลาบันทึกข้อมูลจริง ณ เวลาที่กดบันทึก
    if (lastCol >= 18) {
      sh.getRange(2, 18, sh.getLastRow() - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    }
    applyOrderCycleColors_(sh);
  }
}


function lookupBranch_(branchCode) {
  const code = normalizeText_(branchCode);
  if (!code) throw new Error('กรุณาระบุรหัสสาขา');

  const map = getBranchMap_();
  const found = map[code.toLowerCase()];
  if (!found) {
    throw new Error('ไม่พบรหัสสาขา "' + code + '" ใน Sheet ' + APP_CONFIG.sheets.masterBranch);
  }

  return found;
}

function getBranchMap_() {
  // v3: รองรับกรณี 1 สาขามีหลายแถวใน Master_Pun&GFA
  // เช่น N059 แยกเป็น 3 แถว: Mon / Wed / Fri
  // โค้ดเดิมจะ overwrite เหลือแถวสุดท้าย ทำให้รอบสั่งขึ้นผิด
  const cacheKey = 'branch_map_v6_sla_extra_fields';
  const cached = getCacheJson_(cacheKey);
  if (cached) return cached;

  const ss = getSs_();
  const sh = ss.getSheetByName(APP_CONFIG.sheets.masterBranch);
  if (!sh || sh.getLastRow() < 2) {
    throw new Error('ยังไม่มีข้อมูลสาขาใน Sheet ' + APP_CONFIG.sheets.masterBranch);
  }

  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const cols = detectBranchColumns_(headers);
  const map = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const branchCode = normalizeText_(row[cols.codeIndex]);
    if (!branchCode) continue;

    const key = branchCode.toLowerCase();
    const branchName = normalizeText_(row[cols.nameIndex]) || branchCode;
    const cycleText = normalizeText_(row[cols.cycleIndex]);
    const branchSla = cols.slaIndex > -1 ? normalizeText_(row[cols.slaIndex]) : '';
    const branchEmail = cols.emailIndex > -1 ? normalizeText_(row[cols.emailIndex]) : '';
    const branchZone = cols.zoneIndex > -1 ? normalizeText_(row[cols.zoneIndex]) : '';

    // ถ้ายังไม่เคยเจอสาขานี้ ให้สร้างใหม่
    if (!map[key]) {
      map[key] = {
        branchCode: branchCode,
        branchName: branchName,
        branchSla: branchSla,
        branchEmail: branchEmail,
        branchZone: branchZone,
        cycleText: cycleText,
        rowNumber: i + 1,
        rowNumbers: [i + 1]
      };
      continue;
    }

    // ถ้าเจอสาขาเดิมซ้ำ ให้รวมรอบสั่ง ไม่ใช่ทับค่าเดิม
    if (cycleText) {
      const currentText = map[key].cycleText || '';
      const currentDays = extractCycleDays_(currentText);
      const newDays = extractCycleDays_(cycleText);
      const hasNewDay = newDays.some(function (day) {
        return currentDays.indexOf(day) === -1;
      });

      if (!currentText) {
        map[key].cycleText = cycleText;
      } else if (hasNewDay || currentText.indexOf(cycleText) === -1) {
        map[key].cycleText = currentText + ', ' + cycleText;
      }
    }

    // เก็บชื่อสาขาที่ดีที่สุดไว้ ถ้าแถวแรกไม่มีชื่อ
    if ((!map[key].branchName || map[key].branchName === map[key].branchCode) && branchName) {
      map[key].branchName = branchName;
    }

    if (!map[key].branchEmail && branchEmail) {
      map[key].branchEmail = branchEmail;
    }

    if (!map[key].branchSla && branchSla) {
      map[key].branchSla = branchSla;
    }

    if (!map[key].branchZone && branchZone) {
      map[key].branchZone = branchZone;
    }

    map[key].rowNumbers.push(i + 1);
  }

  setCacheJson_(cacheKey, map, 300);
  return map;
}

function detectBranchColumns_(headers) {
  const h = headers.map(function (x) { return normalizeText_(x).toLowerCase(); });

  // Master_Pun&GFA ปัจจุบัน: A=รหัสสาขา, B=ชื่อสาขา, C=SLA, D=จังหวัด, E=รอบสั่ง
  let codeIndex = 0;
  let cycleIndex = 4;
  let nameIndex = 1;
  let slaIndex = 2;
  let emailIndex = -1;
  let zoneIndex = 3;

  const codeKeywords = ['รหัสสาขา', 'branch code', 'branch_code', 'code', 'shipto'];
  const nameKeywords = ['ชื่อสาขา', 'branch name', 'branch_name', 'store name', 'name'];
  const slaKeywords = ['sla', 'lead time', 'leadtime'];
  const cycleKeywords = ['รอบสั่ง', 'order cycle', 'cycle', 'วันสั่ง', 'order day'];
  const emailKeywords = ['e-mail สาขา', 'email สาขา', 'emailสาขา', 'e-mail', 'email', 'mail', 'อีเมล', 'อีเมลสาขา'];
  const zoneKeywords = ['จังหวัด', 'province', 'เขต', 'zone', 'area', 'region'];

  const detectedCode = findHeaderIndex_(h, codeKeywords);
  const detectedName = findHeaderIndex_(h, nameKeywords);
  const detectedSla = findHeaderIndex_(h, slaKeywords);
  const detectedCycle = findHeaderIndex_(h, cycleKeywords);
  const detectedEmail = findHeaderIndex_(h, emailKeywords);
  const detectedZone = findHeaderIndex_(h, zoneKeywords);

  if (detectedCode > -1) codeIndex = detectedCode;
  if (detectedName > -1) nameIndex = detectedName;
  if (detectedSla > -1) slaIndex = detectedSla;
  if (detectedCycle > -1) cycleIndex = detectedCycle;
  if (detectedEmail > -1) emailIndex = detectedEmail;
  if (detectedZone > -1) zoneIndex = detectedZone;

  return { codeIndex, nameIndex, slaIndex, cycleIndex, emailIndex, zoneIndex };
}

function lookupItem_(ownerKey, itemCode) {
  const code = normalizeText_(itemCode);
  if (!code) throw new Error('กรุณาระบุรหัส Item');

  const rows = readItemRows_(ownerKey);
  const found = rows.find(function (item) {
    return String(item.itemCode).toLowerCase() === code.toLowerCase();
  });

  if (!found) {
    return {
      itemCode: code,
      itemName: 'ไม่พบใน Master Item',
      itemSize: '',
      uom: '',
      found: false
    };
  }

  return {
    itemCode: found.itemCode,
    itemName: found.itemName,
    itemSize: found.itemSize || '',
    uom: found.uom || '',
    found: true
  };
}

function readItemRows_(ownerKey) {
  const owner = getOwner_(ownerKey);
  const cacheKey = 'item_rows_v5_' + owner.key;
  const cached = getCacheJson_(cacheKey);
  if (cached) return cached;

  const ss = getSs_();
  const sh = ss.getSheetByName(owner.masterItemSheet);
  if (!sh || sh.getLastRow() < 2) {
    return [];
  }

  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const cols = detectItemColumns_(headers);
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const itemCode = normalizeText_(row[cols.codeIndex]);
    const itemName = normalizeText_(row[cols.nameIndex]);
    const itemSize = normalizeText_(row[cols.sizeIndex]);
    const uom = normalizeText_(row[cols.uomIndex]);
    if (!itemCode && !itemName) continue;
    rows.push({
      itemCode: itemCode,
      itemName: itemName || 'ไม่ระบุชื่อ Item',
      itemSize: itemSize,
      uom: uom,
      rowNumber: i + 1
    });
  }

  setCacheJson_(cacheKey, rows, 300);
  return rows;
}

function detectItemColumns_(headers) {
  const h = headers.map(function (x) { return normalizeText_(x).toLowerCase(); });
  const hCompact = h.map(function (x) { return x.replace(/[\s_\-.]/g, ''); });

  // Master_Item_Pun / Master_Item_GFA จากไฟล์จริงมีรูปแบบ:
  // Column A = Owner, Column B = PRODUCTCODE, Column C = PRODUCTNAME
  // เพิ่มตาม requirement รอบนี้:
  // Column E = ขนาดรรจุสินค้า, Column G = UOM / หน่วย WMS
  let codeIndex = 1;
  let nameIndex = 2;
  let sizeIndex = 4;
  let uomIndex = 6;

  const codeKeywords = [
    'productcode', 'product code', 'product_code',
    'รหัส item', 'item code', 'item_code', 'item no', 'item_no',
    'รหัสสินค้า', 'sku', 'barcode', 'บาร์โค้ด'
  ];
  const nameKeywords = [
    'productname', 'product name', 'product_name',
    'ชื่อ item', 'item name', 'item_name',
    'ชื่อสินค้า', 'description', 'desc', 'รายละเอียดสินค้า'
  ];
  const sizeKeywords = [
    'ขนาดรรจุสินค้า', 'ขนาดบรรจุสินค้า', 'pack size', 'packing size',
    'package size', 'packsize', 'size'
  ];
  const uomKeywords = [
    'uom', 'base_uom', 'base uom', 'หน่วย wms', 'หน่วยwms',
    'unit', 'หน่วย'
  ];

  const detectedCode = findHeaderIndexSmart_(h, hCompact, codeKeywords);
  const detectedName = findHeaderIndexSmart_(h, hCompact, nameKeywords);
  const detectedSize = findHeaderIndexSmart_(h, hCompact, sizeKeywords);
  const detectedUom = findHeaderIndexSmart_(h, hCompact, uomKeywords);

  if (detectedCode > -1) codeIndex = detectedCode;
  if (detectedName > -1) nameIndex = detectedName;
  if (detectedSize > -1) sizeIndex = detectedSize;
  if (detectedUom > -1) uomIndex = detectedUom;

  // กันกรณีหัวตารางเป็น Owner / PRODUCTCODE / PRODUCTNAME
  // และคง fallback ตามตำแหน่งจริงของไฟล์ผู้ใช้
  if (hCompact[0] === 'owner' && hCompact[1] === 'productcode') {
    codeIndex = 1;
  }
  if (hCompact[2] === 'productname') {
    nameIndex = 2;
  }

  return { codeIndex, nameIndex, sizeIndex, uomIndex };
}

function findHeaderIndexSmart_(headersLower, headersCompact, keywordsLower) {
  for (let i = 0; i < headersLower.length; i++) {
    const cell = headersLower[i];
    const compactCell = headersCompact[i];
    if (!cell && !compactCell) continue;

    for (let j = 0; j < keywordsLower.length; j++) {
      const keyword = String(keywordsLower[j]).toLowerCase();
      const compactKeyword = keyword.replace(/[\s_\-.]/g, '');
      if (cell.indexOf(keyword) > -1 || compactCell.indexOf(compactKeyword) > -1) {
        return i;
      }
    }
  }
  return -1;
}

function findHeaderIndex_(headersLower, keywordsLower) {
  for (let i = 0; i < headersLower.length; i++) {
    const cell = headersLower[i];
    if (!cell) continue;

    for (let j = 0; j < keywordsLower.length; j++) {
      if (cell.indexOf(keywordsLower[j].toLowerCase()) > -1) return i;
    }
  }
  return -1;
}

function buildDocumentNo_(branchCode, orderDate) {
  const yymmdd = Utilities.formatDate(orderDate, APP_CONFIG.timezone, 'yyMMdd');
  return 'GQ-' + normalizeText_(branchCode).toUpperCase() + '-T' + yymmdd;
}

function checkOrderCycle_(orderDate, cycleText) {
  // ใช้ getDay เพื่อให้ได้ค่า Mon/Tue คงที่ ไม่ขึ้นกับภาษา/locale ของไฟล์
  const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayShort = dayMap[orderDate.getDay()];
  const dayThai = getThaiDay_(dayShort);

  // รองรับรอบสั่งหลายวันในช่องเดียว เช่น:
  // Mon,Wed,Fri / Mon , Wed , Fri / Mon Wed Fri / Mon|Wed|Fri / หลายบรรทัด
  // รวมถึงชื่อเต็มภาษาอังกฤษและภาษาไทยบางรูปแบบ เช่น Monday, วันจันทร์
  const cycleDays = extractCycleDays_(cycleText);
  const matched = cycleDays.indexOf(dayShort) > -1;

  return {
    status: matched ? 'รอบสั่งสาขา' : 'ไม่ใช่รอบสาขา',
    dayShort,
    dayThai,
    cycleText: cycleText || '',
    cycleDays: cycleDays
  };
}

function extractCycleDays_(cycleText) {
  const raw = normalizeCycleText_(cycleText);
  if (!raw) return [];

  const dayDefs = [
    { key: 'Mon', patterns: [/\bmonday\b/g, /\bmon\.?\b/g, /วันจันทร์/g, /จันทร์/g] },
    { key: 'Tue', patterns: [/\btuesday\b/g, /\btue\.?\b/g, /วันอังคาร/g, /อังคาร/g] },
    { key: 'Wed', patterns: [/\bwednesday\b/g, /\bwed\.?\b/g, /วันพุธ/g, /พุธ/g] },
    { key: 'Thu', patterns: [/\bthursday\b/g, /\bthu\.?\b/g, /วันพฤหัสบดี/g, /พฤหัสบดี/g, /พฤหัส/g] },
    { key: 'Fri', patterns: [/\bfriday\b/g, /\bfri\.?\b/g, /วันศุกร์/g, /ศุกร์/g] },
    { key: 'Sat', patterns: [/\bsaturday\b/g, /\bsat\.?\b/g, /วันเสาร์/g, /เสาร์/g] },
    { key: 'Sun', patterns: [/\bsunday\b/g, /\bsun\.?\b/g, /วันอาทิตย์/g, /อาทิตย์/g] }
  ];

  const found = [];
  dayDefs.forEach(function (def) {
    const isFound = def.patterns.some(function (pattern) {
      pattern.lastIndex = 0;
      return pattern.test(raw);
    });

    if (isFound && found.indexOf(def.key) === -1) {
      found.push(def.key);
    }
  });

  return found;
}

function normalizeCycleText_(text) {
  return normalizeText_(text)
    .toLowerCase()
    .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
    .replace(/[，、;；/\\|]+/g, ',')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getThaiDay_(dayShort) {
  const map = {
    Mon: 'จันทร์',
    Tue: 'อังคาร',
    Wed: 'พุธ',
    Thu: 'พฤหัสบดี',
    Fri: 'ศุกร์',
    Sat: 'เสาร์',
    Sun: 'อาทิตย์'
  };
  return map[dayShort] || dayShort;
}

function parseIsoDate_(iso) {
  const text = normalizeText_(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  }

  const parts = text.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0);
}

function mergeDateWithTime_(dateOnly, timeSource) {
  return new Date(
    dateOnly.getFullYear(),
    dateOnly.getMonth(),
    dateOnly.getDate(),
    timeSource.getHours(),
    timeSource.getMinutes(),
    timeSource.getSeconds()
  );
}

function asDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) return value;
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach(function (h, i) {
    if (h) obj[String(h)] = row[i];
  });
  return obj;
}

function getDateKey_(value) {
  const d = asDate_(value);
  if (!d) return '';
  return Utilities.formatDate(d, APP_CONFIG.timezone, 'yyyy-MM-dd');
}

function formatDateTime_(value) {
  const d = asDate_(value);
  if (!d) return value ? String(value) : '';
  return Utilities.formatDate(d, APP_CONFIG.timezone, 'dd/MM/yyyy HH:mm:ss');
}

function normalizeText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function getN8nSetupUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

function setupN8nAuthorization() {
  const config = APP_CONFIG.n8n || {};
  if (!config.webhookUrl) {
    throw new Error('ยังไม่ได้ตั้งค่า APP_CONFIG.n8n.webhookUrl');
  }

  const payload = {
    event: 'warehouse.authorization_test',
    source: 'warehouse_ordering_apps_script',
    spreadsheetId: APP_CONFIG.spreadsheetId,
    testedAt: new Date().toISOString(),
    message: 'ทดสอบสิทธิ์ UrlFetchApp สำหรับส่งข้อมูลไป n8n'
  };

  const response = UrlFetchApp.fetch(config.webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: {
      'X-Warehouse-Secret': config.secret || '',
      'X-Warehouse-Event': 'warehouse.authorization_test'
    }
  });

  const statusCode = response.getResponseCode();
  appendLog_({
    action: statusCode >= 200 && statusCode < 300 ? 'N8N_AUTH_OK' : 'N8N_AUTH_FAILED',
    owner: 'SYSTEM',
    documentNo: 'AUTH-TEST',
    branchCode: 'SYSTEM',
    details: 'ทดสอบ UrlFetchApp ไป n8n HTTP ' + statusCode,
    email: getN8nSetupUserEmail_()
  });

  return {
    success: statusCode >= 200 && statusCode < 300,
    statusCode: statusCode,
    message: statusCode >= 200 && statusCode < 300
      ? 'อนุญาต UrlFetchApp แล้ว และส่ง test ไป n8n สำเร็จ'
      : 'อนุญาต UrlFetchApp แล้ว แต่ n8n ตอบ HTTP ' + statusCode,
    body: response.getContentText()
  };
}

function notifyN8nOrderSubmitted_(context) {
  const config = APP_CONFIG.n8n || {};
  if (!config.enabled) return;
  if (!config.webhookUrl || String(config.webhookUrl).indexOf('PASTE_N8N') > -1) return;

  const payload = buildN8nOrderPayload_(context);

  try {
    const response = UrlFetchApp.fetch(config.webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      headers: {
        'X-Warehouse-Secret': config.secret || '',
        'X-Warehouse-Event': 'order.submitted'
      }
    });

    const statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      appendLog_({
        action: 'N8N_NOTIFY_FAILED',
        owner: context.owner.key,
        documentNo: context.documentNo,
        branchCode: context.branch.branchCode,
        details: 'n8n ตอบกลับ HTTP ' + statusCode,
        email: context.submittedBy
      });
      return;
    }

    appendLog_({
      action: 'N8N_NOTIFY_OK',
      owner: context.owner.key,
      documentNo: context.documentNo,
      branchCode: context.branch.branchCode,
      details: 'ส่งข้อมูล order ไป n8n สำเร็จ',
      email: context.submittedBy
    });
  } catch (err) {
    appendLog_({
      action: 'N8N_NOTIFY_FAILED',
      owner: context.owner.key,
      documentNo: context.documentNo,
      branchCode: context.branch.branchCode,
      details: err && err.message ? err.message : String(err),
      email: context.submittedBy
    });
  }
}

function buildN8nOrderPayload_(context) {
  const access = getCurrentUserAccess_();
  const items = context.items || [];
  const totalQty = items.reduce(function (sum, item) {
    return sum + Number(item.qty || 0);
  }, 0);
  const missingMasterItems = items.filter(function (item) {
    return item.found === false;
  });

  return {
    event: 'order.submitted',
    source: 'warehouse_ordering_web',
    generatedAt: Utilities.formatDate(new Date(), APP_CONFIG.timezone, 'yyyy-MM-dd HH:mm:ss'),
    documentNo: context.documentNo,
    owner: context.owner.key,
    ownerLabel: context.owner.label,
    compCode: context.owner.compCode,
    orderDate: Utilities.formatDate(context.orderDate, APP_CONFIG.timezone, 'yyyy-MM-dd'),
    submittedAt: Utilities.formatDate(context.submittedAt, APP_CONFIG.timezone, 'yyyy-MM-dd HH:mm:ss'),
    submittedBy: context.submittedBy || access.email || '',
    access: {
      email: access.email || '',
      role: access.role || 'USER',
      isAdmin: access.isAdmin === true
    },
    branch: {
      code: context.branch.branchCode,
      name: context.branch.branchName,
      email: context.branchEmail || '',
      province: context.branchZone || '',
      cycleText: context.branch.cycleText || ''
    },
    cycle: {
      status: context.cycle.status,
      day: context.cycle.dayShort,
      dayThai: context.cycle.dayThai
    },
    totals: {
      itemCount: items.length,
      totalQty: totalQty,
      missingMasterCount: missingMasterItems.length,
      isOutOfCycle: context.cycle.status === 'ไม่ใช่รอบสาขา'
    },
    flags: {
      shouldAlertAdmin: context.cycle.status === 'ไม่ใช่รอบสาขา' || missingMasterItems.length > 0,
      hasMissingMasterItem: missingMasterItems.length > 0
    },
    items: items
  };
}
function apiGoogleAdminLogin(payload) {
  try {
    const idToken = normalizeText_(payload && (payload.idToken || payload.credential));
    if (!idToken) {
      return { ok: false, message: 'ไม่พบ Google ID token สำหรับตรวจสอบสิทธิ์' };
    }

    const tokenInfo = verifyGoogleIdToken_(idToken);
    const email = normalizeText_(tokenInfo.email).toLowerCase();
    if (!email) {
      return { ok: false, message: 'บัญชี Google นี้ไม่มีข้อมูลอีเมล' };
    }
    if (!isAdminEmail_(email)) {
      return { ok: false, message: 'อีเมล ' + email + ' ไม่ได้อยู่ในรายชื่อ Admin' };
    }

    const session = createAdminSession_(email, 'googleIdentity');
    appendLog_({
      action: 'GOOGLE_ADMIN_LOGIN',
      owner: 'SYSTEM',
      documentNo: 'ADMIN',
      branchCode: 'SYSTEM',
      details: 'เข้าสู่ระบบ Admin ด้วย Google Identity Services',
      email: email
    });

    return {
      ok: true,
      message: 'เข้าสู่ระบบ Admin ด้วย Google สำเร็จ',
      adminToken: session.token,
      expiresAt: session.expiresAt,
      access: {
        email: email,
        role: 'ADMIN',
        isAdmin: true,
        authMethod: 'googleIdentity'
      }
    };
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }
}

function apiAdminLogout(payload) {
  const token = getAdminTokenFromPayload_(payload);
  if (token) {
    CacheService.getScriptCache().remove(buildAdminSessionCacheKey_(token));
  }
  return { ok: true, message: 'ออกจากระบบ Admin แล้ว' };
}

function getCurrentUserAccess_(payload) {
  const email = normalizeText_(getUserEmail_()).toLowerCase();
  const isAdmin = isAdminEmail_(email);

  if (isAdmin) {
    return {
      email: email,
      role: 'ADMIN',
      isAdmin: true,
      authMethod: 'google'
    };
  }

  const tokenAccess = getAccessFromAdminToken_(getAdminTokenFromPayload_(payload));
  if (tokenAccess && tokenAccess.isAdmin) return tokenAccess;

  return {
    email: email,
    role: 'USER',
    isAdmin: false,
    authMethod: email ? 'google' : 'anonymous'
  };
}

function requireAdmin_(payload) {
  const access = getCurrentUserAccess_(payload);
  if (!access.isAdmin) {
    throw new Error('หน้านี้สำหรับ Admin เท่านั้น');
  }
  return access;
}

function isAdminEmail_(email) {
  const normalized = normalizeText_(email).toLowerCase();
  if (!normalized) return false;
  return APP_CONFIG.adminEmails
    .map(function (item) { return normalizeText_(item).toLowerCase(); })
    .indexOf(normalized) > -1;
}

function getGoogleClientIds_() {
  const key = (APP_CONFIG.adminLogin && APP_CONFIG.adminLogin.googleClientIdPropertyKey) || 'WAREHOUSE_GOOGLE_CLIENT_ID';
  try {
    const value = normalizeText_(PropertiesService.getScriptProperties().getProperty(key));
    return value
      .split(',')
      .map(function (item) { return normalizeText_(item); })
      .filter(function (item) { return !!item; });
  } catch (err) {
    return [];
  }
}

function getPrimaryGoogleClientId_() {
  const ids = getGoogleClientIds_();
  return ids.length ? ids[0] : '';
}

function verifyGoogleIdToken_(idToken) {
  const clientIds = getGoogleClientIds_();
  if (!clientIds.length) {
    throw new Error('ยังไม่ได้ตั้งค่า WAREHOUSE_GOOGLE_CLIENT_ID ใน Apps Script Script Properties');
  }

  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  const statusCode = response.getResponseCode();
  let tokenInfo = {};
  try {
    tokenInfo = JSON.parse(response.getContentText() || '{}');
  } catch (err) {
    tokenInfo = {};
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(tokenInfo.error_description || tokenInfo.error || 'ตรวจสอบ Google ID token ไม่สำเร็จ');
  }
  if (clientIds.indexOf(normalizeText_(tokenInfo.aud)) === -1) {
    throw new Error('Google Client ID ไม่ตรงกับระบบนี้');
  }
  if (!(tokenInfo.email_verified === true || tokenInfo.email_verified === 'true')) {
    throw new Error('Google ยังไม่ได้ยืนยันอีเมลของบัญชีนี้');
  }
  if (Number(tokenInfo.exp || 0) * 1000 < Date.now()) {
    throw new Error('Google ID token หมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่');
  }

  return tokenInfo;
}

function getAdminTokenFromPayload_(payload) {
  return normalizeText_(payload && (payload.adminToken || payload.token || payload.sessionToken));
}

function createAdminSession_(email, authMethod) {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  const maxTtl = 21600;
  const requestedTtl = Number(APP_CONFIG.adminLogin && APP_CONFIG.adminLogin.tokenTtlSeconds) || maxTtl;
  const ttlSeconds = Math.min(Math.max(requestedTtl, 60), maxTtl);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const session = {
    email: email,
    role: 'ADMIN',
    isAdmin: true,
    authMethod: authMethod || 'adminToken',
    expiresAt: expiresAt.toISOString()
  };

  CacheService.getScriptCache().put(
    buildAdminSessionCacheKey_(token),
    JSON.stringify(session),
    ttlSeconds
  );

  return {
    token: token,
    expiresAt: Utilities.formatDate(expiresAt, APP_CONFIG.timezone, 'yyyy-MM-dd HH:mm:ss')
  };
}

function getAccessFromAdminToken_(token) {
  if (!token) return null;
  try {
    const raw = CacheService.getScriptCache().get(buildAdminSessionCacheKey_(token));
    if (!raw) return null;
    const session = JSON.parse(raw);
    const email = normalizeText_(session.email).toLowerCase();
    if (!isAdminEmail_(email)) return null;
    return {
      email: email,
      role: 'ADMIN',
      isAdmin: true,
      authMethod: 'adminToken'
    };
  } catch (err) {
    return null;
  }
}

function buildAdminSessionCacheKey_(token) {
  return 'admin_session_' + token;
}

function getUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

function appendLog_(log) {
  try {
    const ss = getSs_();
    const sh = getOrCreateSheet_(ss, APP_CONFIG.sheets.logs);
    ensureHeaders_(sh, APP_CONFIG.logHeaders);

    sh.appendRow([
      new Date(),
      log.action || '',
      log.owner || '',
      log.documentNo || '',
      log.branchCode || '',
      log.details || '',
      log.email || getUserEmail_()
    ]);
  } catch (err) {
    // ไม่ให้ Log error ทำให้ Main flow ล้ม
    console.error('appendLog_ error', err);
  }
}

function buildEmptyDashboard_(ownerKey) {
  const owner = getOwner_(ownerKey);
  return {
    owner: owner.key,
    label: owner.label,
    daysBack: 30,
    totalDocuments: 0,
    totalRows: 0,
    totalQty: 0,
    totalBranches: 0,
    inCycle: 0,
    outCycle: 0,
    topItems: [],
    daily: [],
    statuses: [],
    updatedAt: formatDateTime_(new Date())
  };
}

function buildEmptyCycleExport_(owner, selectedDate, cutoffDate, exportHeaders) {
  return {
    owner: owner.key,
    ownerLabel: owner.label,
    orderSheet: owner.orderSheet,
    cycleDate: getDateKey_(selectedDate),
    cycleDay: checkOrderCycle_(selectedDate, '').dayThai,
    cutoffTime: owner.cutoffTime,
    cutoffAt: formatDateTime_(cutoffDate),
    exportHeaders: exportHeaders,
    totalRows: 0,
    readyRows: [],
    issueRows: [],
    totalQty: 0,
    lateRows: 0,
    outOfCycleRows: 0,
    generatedAt: formatDateTime_(new Date())
  };
}

function buildCutoffDate_(owner, selectedDate) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(owner.cutoffTime || '13:00'));
  const hour = match ? Number(match[1]) : 13;
  const minute = match ? Number(match[2]) : 0;
  return new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate(),
    hour,
    minute,
    0
  );
}

function buildItemCodeMap_(ownerKey) {
  const map = {};
  readItemRows_(ownerKey).forEach(function (item) {
    const code = normalizeText_(item.itemCode).toLowerCase();
    if (code) map[code] = true;
  });
  return map;
}

function buildCycleExportValues_(exportHeaders, obj) {
  return exportHeaders.map(function (header) {
    return formatExportCellValue_(obj[header], header);
  });
}

function formatExportCellValue_(value, header) {
  if (header === 'วันที่สั่ง' || header === 'วันที่และเวลาบันทึกข้อมูล') {
    return formatDateTime_(value);
  }
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return formatDateTime_(value);
  }
  return value === null || value === undefined ? '' : String(value);
}

function clearItemCache_(ownerKey) {
  CacheService.getScriptCache().remove('item_rows_v5_' + ownerKey);
}

function clearDashboardCache_() {
  const cache = CacheService.getScriptCache();
  cache.removeAll([
    'dashboard_PUN_30',
    'dashboard_GFA_30',
    'dashboard_PUN_90',
    'dashboard_GFA_90'
  ]);
}

function getCacheJson_(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function setCacheJson_(key, value, seconds) {
  try {
    const raw = JSON.stringify(value);
    // Apps Script Cache value limit ประมาณ 100KB ถ้าเกินให้ข้าม cache
    if (raw.length < 95000) {
      CacheService.getScriptCache().put(key, raw, seconds || 300);
    }
  } catch (err) {}
}

/* =========================
 * Public API Gateway for Vercel / Netlify / External Frontend
 * เพิ่มส่วนนี้เพื่อให้หน้าเว็บภายนอกเรียก Apps Script เป็น Backend API ได้
 * ========================= */

function getApiAction_(e) {
  if (!e || !e.parameter) return '';
  return normalizeText_(e.parameter.action || e.parameter.api || '').trim();
}

function getRequestPayload_(e, includePostBody) {
  const payload = {};

  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (key) {
      payload[key] = e.parameter[key];
    });
  }

  if (includePostBody && e && e.postData && e.postData.contents) {
    const raw = e.postData.contents;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.keys(parsed).forEach(function (key) {
          payload[key] = parsed[key];
        });
      }
    } catch (err) {
      // รองรับกรณีส่ง body เป็น form-urlencoded แบบง่าย
      raw.split('&').forEach(function (pair) {
        const parts = pair.split('=');
        if (!parts[0]) return;
        const key = decodeURIComponent(parts[0].replace(/\+/g, ' '));
        const value = decodeURIComponent((parts[1] || '').replace(/\+/g, ' '));
        payload[key] = value;
      });
    }
  }

  return payload;
}

function handlePublicApi_(action, payload) {
  const callback = payload && payload.callback ? String(payload.callback) : '';
  try {
    const apiAction = normalizeText_(action).trim();
    if (!apiAction) {
      return jsonOutput_({
        ok: false,
        message: 'ไม่พบ action ที่ต้องการเรียกใช้งาน',
        hint: 'ส่ง action เช่น getConfig, lookupBranch, submitOrder, dashboard'
      }, callback);
    }

    let result;
    switch (apiAction) {
      case 'ping':
        result = {
          ok: true,
          message: 'Warehouse Ordering API พร้อมใช้งาน',
          timestamp: Utilities.formatDate(new Date(), APP_CONFIG.timezone, 'yyyy-MM-dd HH:mm:ss')
        };
        break;

      case 'getConfig':
      case 'config':
        result = apiGetConfig(payload);
        break;

      case 'googleAdminLogin':
      case 'adminGoogleLogin':
        result = apiGoogleAdminLogin(payload);
        break;

      case 'adminLogout':
      case 'logoutAdmin':
        result = apiAdminLogout(payload);
        break;

      case 'lookupBranch':
        result = apiLookupBranch(payload.branchCode || payload.code || '');
        break;

      case 'lookupItem':
        result = apiLookupItem(payload.ownerKey || payload.owner || '', payload.itemCode || payload.code || '');
        break;

      case 'fastLookup':
      case 'getFastLookupData':
        result = apiGetFastLookupData(payload.ownerKey || payload.owner || '');
        break;

      case 'validateOrder':
      case 'validateOrderContext':
        result = apiValidateOrderContext(payload);
        break;

      case 'submitOrder':
        result = apiSubmitOrder(normalizeOrderPayloadForApi_(payload));
        break;

      case 'history':
      case 'recentOrders':
        result = apiGetRecentOrders(payload.ownerKey || payload.owner || 'PUN', payload.limit || 80, payload.branchCode || payload.branch || '', payload);
        break;

      case 'myOrders':
      case 'branchOrders':
        result = apiGetMyOrders(payload.ownerKey || payload.owner || 'PUN', payload.branchCode || payload.branch || '', payload.limit || 80);
        break;

      case 'dashboard':
        result = apiGetDashboard(
          payload.ownerKey || payload.owner || 'PUN',
          payload.daysBack || payload.days || 30,
          payload.targetDate || payload.date || '',
          payload
        );
        break;

      case 'cycleExport':
      case 'exportCycle':
        result = apiGetCycleExport(payload.ownerKey || payload.owner || 'PUN', payload.cycleDate || payload.orderDate || payload.date || '', payload);
        break;

      case 'searchMasterItems':
      case 'masterSearch':
        result = apiSearchMasterItems(payload.ownerKey || payload.owner || 'PUN', payload.keyword || payload.q || '', payload.limit || 30, payload);
        break;

      case 'upsertMasterItem':
      case 'masterUpsert':
        result = apiUpsertMasterItem(payload.ownerKey || payload.owner || 'PUN', normalizeMasterItemPayloadForApi_(payload), payload);
        break;

      case 'logs':
      case 'getLogs':
        result = apiGetLogs(payload.limit || 50, payload);
        break;

      default:
        result = {
          ok: false,
          message: 'ไม่รู้จัก action: ' + apiAction,
          availableActions: [
            'ping',
            'getConfig',
            'googleAdminLogin',
            'adminLogout',
            'lookupBranch',
            'lookupItem',
            'fastLookup',
            'validateOrder',
            'submitOrder',
            'history',
            'myOrders',
            'dashboard',
            'cycleExport',
            'searchMasterItems',
            'upsertMasterItem',
            'logs'
          ]
        };
    }

    return jsonOutput_(result, callback);
  } catch (err) {
    return jsonOutput_({
      ok: false,
      message: err && err.message ? err.message : String(err)
    }, callback);
  }
}

function normalizeOrderPayloadForApi_(payload) {
  let items = payload.items;

  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (err) {
      items = [];
    }
  }

  if (!Array.isArray(items)) {
    items = [];
  }

  return {
    ownerKey: payload.ownerKey || payload.owner || '',
    orderDate: payload.orderDate || payload.date || '',
    branchCode: payload.branchCode || payload.branch || '',
    branchEmail: payload.branchEmail || payload.email || '',
    branchZone: payload.branchZone || payload.province || payload.zone || '',
    items: items
  };
}

function normalizeMasterItemPayloadForApi_(payload) {
  let item = payload.item;

  if (typeof item === 'string') {
    try {
      item = JSON.parse(item);
    } catch (err) {
      item = null;
    }
  }

  if (!item || typeof item !== 'object') {
    item = {
      itemCode: payload.itemCode || payload.code || '',
      itemName: payload.itemName || payload.name || '',
      itemSize: payload.itemSize || payload.size || '',
      uom: payload.uom || payload.UOM || ''
    };
  }

  return item;
}

function jsonOutput_(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    const safeCallback = String(callback).replace(/[^a-zA-Z0-9_$\.]/g, '');
    return ContentService
      .createTextOutput(safeCallback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
