import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let products = [];
let locations = [];
let storageStatus = [];
let inventoryRows = [];
let lines = [];
let selected = null;
let lastConfirmedReceipt = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

async function fetchAllRows(table, columns='*', orderColumn=null) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    let q = db.from(table).select(columns).range(from, from + pageSize - 1);
    if (orderColumn) q = q.order(orderColumn, { ascending: true });
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function init() {
  setConnectionState('Conectando a Supabase…', 'loading');
  try {
    const [productRows, locationRows] = await Promise.all([
      fetchAllRows('products', 'id,sku,description,base_unit,pieces_per_pallet,shelf_life_days,category,storage_type,active', 'sku'),
      fetchAllRows('locations', 'id,warehouse,code,rack,position,level,capacity_pallets,location_type,status,active', 'code')
    ]);

    products = productRows.filter(p => p.active !== false).map(p => ({
      id: p.id,
      sku: p.sku,
      descripcion: p.description,
      unidad: p.base_unit,
      piezas_por_tarima: Number(p.pieces_per_pallet || 0),
      vida_util_dias: Number(p.shelf_life_days || 245),
      categoria: p.category || '',
      storage_type: normalizeStorageType(p.storage_type)
    }));

    locations = locationRows.filter(l => l.active !== false).map(l => ({
      id: l.id,
      almacen: l.warehouse,
      ubicacion: l.code,
      rack: l.rack || '',
      posicion: l.position || '',
      nivel: Number(l.level || 0),
      capacidad: Number(l.capacity_pallets || 0),
      estatus: l.status || 'DISPONIBLE',
      location_type: normalizeStorageType(l.location_type, l.code)
    }));

    $('#kpiProducts').textContent = products.length.toLocaleString();
    $('#kpiLocations').textContent = locations.length.toLocaleString();
    $('#kpiCapacity').textContent = locations.reduce((a,b) => a + b.capacidad, 0).toLocaleString();
    renderProducts();
    renderLocations();
    $('#recDate').value = localDateISO();
    $('#prodDate').value = localDateISO();
    await refreshOperationalData();
    setConnectionState(`Supabase conectado · ${products.length} productos · ${locations.length} ubicaciones · RACK/PISO v2`, 'ok');
  } catch (err) {
    console.error(err);
    setConnectionState('Error de conexión', 'error');
    alert('No se pudieron cargar datos desde Supabase.\n\n' + err.message);
  }
}

async function refreshOperationalData() {
  try {
    const [storageRows, invRows, expiryRows] = await Promise.all([
      fetchAllRows('location_storage_status', '*', 'code'),
      fetchAllRows('inventory_detail', '*', 'expiration_date'),
      fetchAllRows('expiration_dashboard', '*')
    ]);
    storageStatus = storageRows || [];
    inventoryRows = invRows || [];
    renderInventory();
    renderQuality();
    renderExpiry(expiryRows || []);
  } catch (err) {
    console.warn('Datos operativos todavía no disponibles:', err.message);
  }
}

function setConnectionState(text, state) {
  const el = $('#dbStatus');
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state;
}

$('#loginBtn').onclick = () => {
  if ($('#user').value === 'supervisor' && $('#pass').value === 'demo') {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    init();
  } else {
    alert('Usa supervisor / demo');
  }
};

$('#logout').onclick = () => location.reload();

$$('nav button').forEach(b => b.onclick = () => {
  $$('nav button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#' + b.dataset.view).classList.remove('hidden');
  $('#title').textContent = b.textContent;
});

function renderProducts(q='') {
  const nq = normalizeText(q);
  const a = products.filter(p => normalizeText(`${p.sku} ${p.descripcion}`).includes(nq)).slice(0,250);
  $('#productsBody').innerHTML = a.map(p => `<tr><td>${escapeHtml(p.sku)}</td><td>${escapeHtml(p.descripcion)}</td><td>${escapeHtml(p.unidad || '')}</td><td>${p.piezas_por_tarima || 'FALTA'}</td><td>${p.vida_util_dias} días</td></tr>`).join('');
  $('#productCount').textContent = `${a.length} mostrados de ${products.length}`;
}

function renderLocations(q='') {
  const nq = normalizeText(q);
  const a = locations.filter(l => normalizeText(`${l.ubicacion} ${l.rack}`).includes(nq)).slice(0,300);
  $('#locationsBody').innerHTML = a.map(l => `<tr><td>${escapeHtml(l.ubicacion)}</td><td>${escapeHtml(l.rack)}</td><td>${l.nivel}</td><td>${l.capacidad} tarimas</td><td>${escapeHtml(l.estatus)}</td></tr>`).join('');
  $('#locationCount').textContent = `${a.length} mostradas de ${locations.length}`;
}

$('#productFilter').oninput = e => renderProducts(e.target.value);
$('#locationFilter').oninput = e => renderLocations(e.target.value);

function productLabel(p) { return `${p.sku} — ${p.descripcion}`; }
function normalizeText(v) { return (v || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function escapeHtml(v) { return String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function normalizeLot(v) { return String(v || '').trim().replace(/\s+/g,' ').toUpperCase(); }

function normalizeStorageType(value, locationCode='') {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'PISO' || raw === 'FILA') return 'PISO';
  if (raw === 'RACK') return 'RACK';
  return String(locationCode || '').trim().toUpperCase().startsWith('FILA-') ? 'PISO' : 'RACK';
}

function getLocationType(row) {
  const master = locations.find(l => l.id === row.id);
  return normalizeStorageType(row.location_type || master?.location_type, row.code || master?.ubicacion);
}

function localDateISO() { const d = new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function addDaysISO(iso, days) { const [y,m,d] = iso.split('-').map(Number); const x = new Date(Date.UTC(y,m-1,d)); x.setUTCDate(x.getUTCDate()+Number(days)); return x.toISOString().slice(0,10); }
function ceilDiv(n,d) { return Math.ceil(Number(n)/Number(d)); }

function getProductMatches(query='') {
  const q = normalizeText(query);
  if (!q) return products.slice(0,40);
  const terms = q.split(/\s+/).filter(Boolean);
  return products.filter(p => {
    const hay = normalizeText(`${p.sku} ${p.descripcion}`);
    return terms.every(t => hay.includes(t));
  }).slice(0,40);
}

function resolveProductFromInput(autoSelectUnique=false) {
  const text = $('#productSearch').value.trim();
  if (!text) { selected = null; return null; }
  const norm = normalizeText(text);
  const exact = products.find(p => normalizeText(p.sku) === norm || normalizeText(p.descripcion) === norm || normalizeText(productLabel(p)) === norm);
  if (exact) { selected = exact; return exact; }
  if (autoSelectUnique) {
    const matches = getProductMatches(text);
    if (matches.length === 1) { selectProduct(matches[0].sku); return matches[0]; }
  }
  return selected;
}

function renderProductSuggestions(query='') {
  const box = $('#productSuggestions');
  const matches = getProductMatches(query);
  if (!matches.length) {
    box.innerHTML = '<div class="product-no-results">Sin coincidencias</div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = matches.map((p,i) => `<button type="button" class="product-option" data-sku="${escapeHtml(p.sku)}" role="option" data-index="${i}"><b>${escapeHtml(p.sku)}</b><span>${escapeHtml(p.descripcion)}</span></button>`).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.product-option').forEach(btn => btn.onclick = () => selectProduct(btn.dataset.sku));
}

function selectProduct(sku) {
  const p = products.find(x => String(x.sku) === String(sku));
  if (!p) return;
  selected = p;
  $('#productSearch').value = productLabel(p);
  $('#productSuggestions').classList.add('hidden');
  $('#productSearch').dataset.selectedSku = p.sku;
  clearAssignmentPreview();
  updateCalc();
}

function updateCalc() {
  const pcs = Number($('#pieces').value || 0);
  if (!selected || !pcs) { $('#calc').textContent = 'Selecciona un producto y captura piezas.'; return; }
  const ppt = Number(selected.piezas_por_tarima || 0);
  if (!ppt) { $('#calc').textContent = 'Este producto no tiene piezas por tarima configuradas.'; return; }
  const pallets = Math.floor(pcs / ppt), rest = pcs % ppt, pos = pallets + (rest > 0 ? 1 : 0);
  $('#calc').innerHTML = `<b>${pallets}</b> tarimas completas + <b>${rest}</b> piezas de resto = <b>${pos}</b> posiciones requeridas. <span class="storage-badge">Almacenamiento: ${escapeHtml(selected.storage_type || 'SIN CONFIGURAR')}</span>`;
}

$('#productSearch').addEventListener('focus', e => renderProductSuggestions(e.target.value));
$('#productSearch').addEventListener('input', e => {
  selected = null;
  delete e.target.dataset.selectedSku;
  clearAssignmentPreview();
  renderProductSuggestions(e.target.value);
  $('#calc').textContent = 'Selecciona un producto y captura piezas.';
});
$('#productSearch').addEventListener('keydown', e => {
  const box = $('#productSuggestions');
  const opts = [...box.querySelectorAll('.product-option')];
  let idx = opts.findIndex(x => x.classList.contains('active'));
  if (e.key === 'ArrowDown' && opts.length) { e.preventDefault(); idx = (idx + 1) % opts.length; }
  else if (e.key === 'ArrowUp' && opts.length) { e.preventDefault(); idx = idx <= 0 ? opts.length - 1 : idx - 1; }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (idx >= 0 && opts.length) return opts[idx].click();
    const matches = getProductMatches(e.target.value);
    if (matches.length === 1) return selectProduct(matches[0].sku);
    renderProductSuggestions(e.target.value); return;
  } else if (e.key === 'Escape') { box.classList.add('hidden'); return; }
  else return;
  opts.forEach(x => x.classList.remove('active'));
  opts[idx].classList.add('active');
  opts[idx].scrollIntoView({block:'nearest'});
});
document.addEventListener('click', e => { if (!e.target.closest('.product-combobox')) $('#productSuggestions')?.classList.add('hidden'); });
$('#pieces').oninput = () => { clearAssignmentPreview(); updateCalc(); };
$('#lot').oninput = clearAssignmentPreview;

function stagedForLocation(locationId) {
  const staged = { pieces: 0, assignmentProductId: null, lot: null, ppt: null };
  for (const line of lines) {
    for (const a of line.allocations || []) {
      if (a.location_id !== locationId) continue;
      staged.pieces += a.pieces;
      staged.assignmentProductId = line.product_id;
      staged.lot = line.lot;
      staged.ppt = line.pieces_per_pallet;
    }
  }
  return staged;
}

function buildLocationCandidates(product, lot) {
  const normLot = normalizeLot(lot);
  return storageStatus.map(s => {
    const staged = stagedForLocation(s.id);
    const dbProductId = s.product_id || null;
    const dbLot = normalizeLot(s.lot || '');
    const effectiveProduct = staged.assignmentProductId || dbProductId;
    const effectiveLot = staged.lot || dbLot;
    const compatible = !effectiveProduct || (effectiveProduct === product.id && normalizeLot(effectiveLot) === normLot);
    const existingPieces = Number(s.physical_pieces || 0) + Number(staged.pieces || 0);
    const occupiedAfterStaged = existingPieces > 0 ? ceilDiv(existingPieces, product.piezas_por_tarima) : 0;
    const availablePositions = Math.max(0, Number(s.capacity_pallets || 0) - occupiedAfterStaged);
    const partialSpace = compatible && existingPieces > 0 ? (product.piezas_por_tarima - (existingPieces % product.piezas_por_tarima)) % product.piezas_por_tarima : 0;
    return {
      ...s,
      compatible,
      existingPieces,
      occupiedAfterStaged,
      availablePositions,
      partialSpace,
      hasSameAssignment: Boolean(effectiveProduct && compatible)
    };
  }).filter(x => {
    const productType = normalizeStorageType(product.storage_type);
    const locationType = getLocationType(x);
    return x.status === 'DISPONIBLE' && x.compatible && locationType === productType;
  });
}

function suggestAllocations(product, lot, totalPieces) {
  const ppt = Number(product.piezas_por_tarima);
  let left = Number(totalPieces);
  const out = [];
  const candidates = buildLocationCandidates(product, lot);

  // 1) Llenar primero ubicaciones que ya tengan el mismo producto+lote,
  // incluso si están en nivel bajo. Se aprovecha primero un resto abierto.
  const same = candidates.filter(x => x.hasSameAssignment)
    .sort((a,b) => (b.partialSpace > 0) - (a.partialSpace > 0) || a.availablePositions - b.availablePositions || b.level - a.level || a.code.localeCompare(b.code));

  for (const c of same) {
    if (left <= 0) break;
    const maxPieces = c.partialSpace + c.availablePositions * ppt;
    if (maxPieces <= 0) continue;
    const take = Math.min(left, maxPieces);
    out.push({ location_id:c.id, code:c.code, pieces:take });
    left -= take;
  }

  if (left <= 0) return finalizeAllocations(out, ppt);

  // 2) Para ubicaciones vacías: capacidad exacta primero y luego niveles altos.
  const empty = candidates.filter(x => !x.hasSameAssignment && x.existingPieces === 0);
  const positionsNeeded = ceilDiv(left, ppt);
  const exact = empty.filter(x => Number(x.capacity_pallets) === positionsNeeded)
    .sort((a,b) => Number(b.level||0)-Number(a.level||0) || a.code.localeCompare(b.code));

  if (exact.length) {
    out.push({ location_id:exact[0].id, code:exact[0].code, pieces:left });
    return finalizeAllocations(out, ppt);
  }

  const pool = empty.sort((a,b) => Number(b.level||0)-Number(a.level||0) || Number(a.capacity_pallets)-Number(b.capacity_pallets) || a.code.localeCompare(b.code));
  for (const c of pool) {
    if (left <= 0) break;
    const maxPieces = Number(c.capacity_pallets) * ppt;
    const take = Math.min(left, maxPieces);
    if (take <= 0) continue;
    out.push({ location_id:c.id, code:c.code, pieces:take });
    left -= take;
  }
  return left > 0 ? [] : finalizeAllocations(out, ppt);
}

function finalizeAllocations(items, ppt) {
  return items.map(a => ({
    ...a,
    pallets: Math.floor(a.pieces / ppt),
    remainder_pieces: a.pieces % ppt,
    positions_used: ceilDiv(a.pieces, ppt)
  }));
}

function clearAssignmentPreview() {
  $('#autoAssign').dataset.allocations = '';
  $('#assignmentPreview').textContent = '';
}

function setAssignmentPreview(allocs) {
  $('#autoAssign').dataset.allocations = JSON.stringify(allocs);
  $('#assignmentPreview').innerHTML = allocs.map(a => `<span class="assign-chip">${escapeHtml(a.code)} · ${a.pieces} pzas (${a.positions_used} pos.)</span>`).join('');
}

$('#autoAssign').onclick = () => {
  if (!selected) resolveProductFromInput(true);
  if (!selected) { renderProductSuggestions($('#productSearch').value); return alert('Selecciona un producto de la lista'); }
  const pcs = Number($('#pieces').value || 0);
  const lot = normalizeLot($('#lot').value);
  if (!pcs || !selected.piezas_por_tarima || !lot) return alert('Captura lote y una cantidad válida');
  const allocs = suggestAllocations(selected, lot, pcs);
  if (!allocs.length) return alert(`No hay capacidad compatible suficiente. El producto ${selected.sku} solo puede almacenarse en ${selected.storage_type || 'un tipo no configurado'}.`);
  const wrong = allocs.find(a => {
    const row = storageStatus.find(x => x.id === a.location_id) || locations.find(x => x.id === a.location_id);
    return getLocationType(row || {id:a.location_id, code:a.code}) !== normalizeStorageType(selected.storage_type);
  });
  if (wrong) {
    clearAssignmentPreview();
    return alert(`Asignación bloqueada: ${wrong.code} no corresponde a ${selected.storage_type}. Actualiza la página con Ctrl+F5.`);
  }
  setAssignmentPreview(allocs);
};

$('#addLine').onclick = () => {
  if (!selected) resolveProductFromInput(true);
  const pcs = Number($('#pieces').value || 0);
  const ppt = Number(selected?.piezas_por_tarima || 0);
  const lot = normalizeLot($('#lot').value);
  const pd = $('#prodDate').value;
  if (!selected) { renderProductSuggestions($('#productSearch').value); return alert('Selecciona un producto de la lista'); }
  if (!pcs || !ppt || !lot || !pd) return alert('Completa producto, lote, fecha y piezas');

  let allocs = [];
  try { allocs = JSON.parse($('#autoAssign').dataset.allocations || '[]'); } catch {}
  if (!allocs.length) allocs = suggestAllocations(selected, lot, pcs);
  if (!allocs.length) return alert(`No hay capacidad compatible suficiente. El producto ${selected.sku} solo puede almacenarse en ${selected.storage_type || 'un tipo no configurado'}.`);
  const wrong = allocs.find(a => {
    const row = storageStatus.find(x => x.id === a.location_id) || locations.find(x => x.id === a.location_id);
    return getLocationType(row || {id:a.location_id, code:a.code}) !== normalizeStorageType(selected.storage_type);
  });
  if (wrong) return alert(`Ubicación ${wrong.code} incompatible. ${selected.sku} requiere ${selected.storage_type}.`);

  const pallets = Math.floor(pcs / ppt), rest = pcs % ppt, pos = pallets + (rest ? 1 : 0);
  const exp = addDaysISO(pd, selected.vida_util_dias);
  lines.push({
    id: crypto.randomUUID(),
    product_id:selected.id, sku:selected.sku, desc:selected.descripcion, lot,
    production_date:pd, expiration_date:exp, shelf_life_days:selected.vida_util_dias,
    pieces_per_pallet:ppt, received_pieces:pcs,
    pallets, rest, pos, allocations:allocs
  });
  renderLines();
  $('#lot').value = '';
  $('#pieces').value = '';
  clearAssignmentPreview();
  updateCalc();
};

function renderLines() {
  $('#receiptLines').innerHTML = lines.map(x => {
    const loc = x.allocations.map(a => `${a.code}: ${a.pieces} pzas`).join(', ');
    return `<tr><td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.desc)}</td><td>${escapeHtml(x.lot)}</td><td>${x.received_pieces}</td><td>${x.pallets}</td><td>${x.rest}</td><td>${x.pos}</td><td>${x.expiration_date}</td><td>${escapeHtml(loc)}</td><td><button class="mini danger" data-remove-line="${x.id}">Quitar</button></td></tr>`;
  }).join('') || '<tr><td colspan="10" class="empty">Sin líneas capturadas</td></tr>';
  $$('[data-remove-line]').forEach(b => b.onclick = () => {
    lines = lines.filter(x => x.id !== b.dataset.removeLine);
    renderLines();
  });
}

$('#confirmReceipt').onclick = async () => {
  if (!lines.length) return alert('Agrega al menos una línea');
  const btn = $('#confirmReceipt');
  if (btn.disabled) return;
  const payload = lines.map(x => ({
    product_id:x.product_id,
    lot:x.lot,
    production_date:x.production_date,
    expiration_date:x.expiration_date,
    received_pieces:x.received_pieces,
    allocations:x.allocations.map(a => ({ location_id:a.location_id, pieces:a.pieces }))
  }));

  btn.disabled = true;
  btn.textContent = 'Confirmando…';
  try {
    const { data, error } = await db.rpc('confirm_receipt', {
      p_receipt_date: $('#recDate').value || localDateISO(),
      p_observations: $('#notes').value.trim(),
      p_operator_name: 'supervisor',
      p_lines: payload
    });
    if (error) throw error;
    lastConfirmedReceipt = { ...data, detail: structuredClone(lines), date: $('#recDate').value, notes: $('#notes').value.trim() };
    $('#receiptFolio').value = data.folio;
    alert(`Recepción ${data.folio} confirmada correctamente.\n${data.lines} línea(s) · ${Number(data.total_pieces).toLocaleString()} piezas.\n\nEl inventario quedó PENDIENTE DE CALIDAD.`);
    await refreshOperationalData();
    printReceipt(lastConfirmedReceipt);
    resetReceiptForm();
  } catch (err) {
    console.error(err);
    alert('No se confirmó la recepción. No se guardó ningún movimiento.\n\n' + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar recepción';
  }
};

function resetReceiptForm() {
  lines = [];
  renderLines();
  selected = null;
  $('#productSearch').value = '';
  $('#lot').value = '';
  $('#pieces').value = '';
  $('#notes').value = '';
  $('#prodDate').value = localDateISO();
  clearAssignmentPreview();
  updateCalc();
  setTimeout(() => { $('#receiptFolio').value = 'REC-BORRADOR'; }, 2500);
}

function printReceipt(r) {
  if (!r) return;
  const rows = r.detail.map(x => `<tr><td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.desc)}</td><td>${escapeHtml(x.lot)}</td><td>${x.production_date}</td><td>${x.expiration_date}</td><td style="text-align:right">${x.received_pieces.toLocaleString()}</td><td>${escapeHtml(x.allocations.map(a=>`${a.code}: ${a.pieces}`).join(', '))}</td></tr>`).join('');
  const w = window.open('', '_blank', 'width=1000,height=720');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.folio)}</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#111}h1{margin:0}p{margin:5px 0 18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:7px;vertical-align:top}th{background:#eee}.meta{display:flex;gap:35px;margin:20px 0}.sign{display:flex;justify-content:space-between;margin-top:70px}.sign div{width:42%;border-top:1px solid #333;text-align:center;padding-top:7px}@media print{button{display:none}}</style></head><body><h1>WMS Acatlán</h1><p><b>Recepción de Producción</b></p><div class="meta"><div><b>Folio:</b> ${escapeHtml(r.folio)}</div><div><b>Fecha:</b> ${escapeHtml(r.date)}</div><div><b>Usuario:</b> supervisor</div></div><table><thead><tr><th>SKU</th><th>Producto</th><th>Lote</th><th>Producción</th><th>Caducidad</th><th>Piezas</th><th>Ubicaciones</th></tr></thead><tbody>${rows}</tbody></table><p><b>Observaciones:</b> ${escapeHtml(r.notes || '—')}</p><p><b>Estatus:</b> PENDIENTE DE LIBERACIÓN POR CALIDAD</p><div class="sign"><div>Entregó Producción</div><div>Recibió Almacén</div></div><br><button onclick="window.print()">Imprimir / Guardar PDF</button></body></html>`);
  w.document.close();
}

function renderInventory() {
  const body = $('#inventoryBody');
  if (!body) return;
  const active = inventoryRows.filter(x => Number(x.physical_pieces) > 0);
  body.innerHTML = active.map(x => `<tr><td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.lot)}</td><td>${escapeHtml(x.location)}</td><td>${Number(x.physical_pieces).toLocaleString()}</td><td>${Number(x.pending_quality_pieces).toLocaleString()}</td><td>${Number(x.available_pieces).toLocaleString()}</td><td>${Number(x.reserved_pieces).toLocaleString()}</td><td>${x.expiration_date}</td><td><span class="status-pill ${String(x.expiration_color).toLowerCase()}">${escapeHtml(x.expiration_color)}</span></td></tr>`).join('') || '<tr><td colspan="10" class="empty">Sin inventario</td></tr>';
  $('#inventoryCount').textContent = `${active.length} registros`;
}

function renderQuality() {
  const body = $('#qualityBody');
  if (!body) return;
  const pending = inventoryRows.filter(x => Number(x.pending_quality_pieces) > 0);
  body.innerHTML = pending.map(x => `<tr><td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.lot)}</td><td>${escapeHtml(x.location)}</td><td>${Number(x.pending_quality_pieces).toLocaleString()}</td><td>${x.production_date}</td><td>${x.expiration_date}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No hay inventario pendiente de Calidad</td></tr>';
  $('#qualityCount').textContent = `${pending.length} pendientes`;
}

function renderExpiry(rows) {
  const map = Object.fromEntries(rows.map(x => [x.color, Number(x.total_pieces || 0)]));
  $('#expiryGreen').textContent = (map.VERDE || 0).toLocaleString();
  $('#expiryYellow').textContent = (map.AMARILLO || 0).toLocaleString();
  $('#expiryRed').textContent = (map.ROJO || 0).toLocaleString();
  $('#expiryExpired').textContent = (map.VENCIDO || 0).toLocaleString();
}
