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
let qualitySelected = null;
let qualityTab = 'PENDING';
let qualityMode = 'PENDING';
let dashboardSnapshot = null;
let transferSelected = null;
let orderImportPreview = [];
let orderRows = [];
let picklistRows = [];
let currentPicklistDetail = [];
let currentPicklistId = null;
let shipmentRows = [];
let currentShipmentPicklistId = null;
let currentAuthUser = null;
let currentProfile = null;


const ROLE_PERMISSIONS = {
  ADMINISTRADOR: ['dashboard','recepcion','productos','ubicaciones','pedidos','picklists','embarques','calidad','inventario','transferencias','usuarios'],
  SUPERVISOR: ['dashboard','recepcion','productos','ubicaciones','pedidos','picklists','embarques','calidad','inventario','transferencias'],
  SUPERVISOR_DE_ALMACEN: ['dashboard','recepcion','productos','ubicaciones','pedidos','picklists','embarques','calidad','inventario','transferencias'],
  ALMACENISTA: ['dashboard','recepcion','picklists','inventario','transferencias'],
  CALIDAD: ['dashboard','calidad','inventario'],
  EMBARQUES: ['dashboard','picklists','embarques','inventario'],
  CONSULTA: ['dashboard','productos','ubicaciones','inventario']
};

function normalizeUsername(value='') {
  return String(value).trim().toLowerCase().replace(/\s+/g,'.').replace(/[^a-z0-9._-]/g,'');
}
function loginEmailForUsername(username) {
  return `${normalizeUsername(username)}@wms-acatlan.app`;
}
function currentOperatorName() {
  return currentProfile?.full_name || currentProfile?.username || normalizeUsername($('#user')?.value) || 'usuario';
}
function normalizedRole() {
  return String(currentProfile?.role || 'CONSULTA').trim().toUpperCase().replace(/\s+/g,'_');
}
function applyRolePermissions() {
  const role = normalizedRole();
  const allowed = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.CONSULTA;
  $$('nav button[data-view]').forEach(btn => btn.classList.toggle('nav-hidden', !allowed.includes(btn.dataset.view)));
  $('#currentUserName').textContent = currentProfile?.full_name || currentProfile?.username || 'Usuario';
  $('#currentUserRole').textContent = role.replaceAll('_',' ');
  $$('.session-user').forEach(input => input.value = currentOperatorName());
  if ($('#shipmentOperator')) $('#shipmentOperator').value = currentOperatorName();
}
async function loadCurrentProfile(user) {
  const { data, error } = await db.from('profiles').select('id,username,full_name,role,active').eq('id', user.id).single();
  if (error) throw new Error(`Perfil: ${error.message}`);
  if (!data?.active) throw new Error('La cuenta está inactiva. Contacta al Jefe de Almacén.');
  currentProfile = data;
  applyRolePermissions();
}
async function enterApplication(user) {
  currentAuthUser = user;
  await loadCurrentProfile(user);
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await init();
}
async function restoreSession() {
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    try { await enterApplication(session.user); }
    catch (err) { await db.auth.signOut(); console.error(err); }
  }
}
async function renderUsers() {
  if (!$('#usersBody') || normalizedRole() !== 'ADMINISTRADOR') return;
  const { data, error } = await db.from('profiles').select('username,full_name,role,active,created_at').order('full_name');
  if (error) { $('#usersBody').innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`; return; }
  $('#usersBody').innerHTML = (data || []).map(u => `<tr><td>${escapeHtml(u.username||'—')}</td><td>${escapeHtml(u.full_name)}</td><td>${escapeHtml(u.role)}</td><td>${u.active?'Sí':'No'}</td><td>${u.created_at?new Date(u.created_at).toLocaleString():'—'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin usuarios.</td></tr>';
}

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
      vida_util_dias: Number(p.shelf_life_days || 360),
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

    setDashText('kpiProducts', products.length);
    setDashText('kpiLocations', locations.length);
    setDashText('kpiCapacity', locations.reduce((a,b) => a + b.capacidad, 0));
    renderProducts();
    renderLocations();
    $('#recDate').value = localDateISO();
    $('#prodDate').value = localDateISO();
    await refreshOperationalData();
    setConnectionState(`Supabase conectado · ${products.length} productos · ${locations.length} ubicaciones · Dashboard v2`, 'ok');
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
    renderTransfers();
    renderExpiry(expiryRows || []);
    await refreshOrdersPicklists();
    await refreshShipments();
    await refreshDashboardSnapshot();
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

$('#loginBtn').onclick = async () => {
  const username = normalizeUsername($('#user').value);
  const password = $('#pass').value;
  const help = $('#loginHelp');
  if (!username || !password) { help.textContent = 'Captura usuario y contraseña.'; help.dataset.state = 'error'; return; }
  $('#loginBtn').disabled = true;
  help.textContent = 'Validando acceso…'; delete help.dataset.state;
  try {
    const { data, error } = await db.auth.signInWithPassword({ email: loginEmailForUsername(username), password });
    if (error) throw error;
    await enterApplication(data.user);
  } catch (err) {
    help.textContent = err.message === 'Invalid login credentials' ? 'Usuario o contraseña incorrectos.' : err.message;
    help.dataset.state = 'error';
  } finally { $('#loginBtn').disabled = false; }
};
$('#pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });
$('#logout').onclick = async () => { await db.auth.signOut(); location.reload(); };
if ($('#refreshUsers')) $('#refreshUsers').onclick = renderUsers;
restoreSession();

$$('nav button').forEach(b => b.onclick = () => {
  $$('nav button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#' + b.dataset.view).classList.remove('hidden');
  $('#title').textContent = b.textContent;
  if (b.dataset.view === 'usuarios') renderUsers();
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


function compareLocationModule(a,b,levelDirection='DESC') {
  const rackCompare=String(a.rack||'').localeCompare(String(b.rack||''),undefined,{numeric:true,sensitivity:'base'});
  if(rackCompare!==0) return rackCompare;

  const positionCompare=String(a.position||'').localeCompare(String(b.position||''),undefined,{numeric:true,sensitivity:'base'});
  if(positionCompare!==0) return positionCompare;

  const levelA=Number(a.level||0);
  const levelB=Number(b.level||0);
  if(levelA!==levelB) return levelDirection==='ASC' ? levelA-levelB : levelB-levelA;

  return String(a.code||'').localeCompare(String(b.code||''),undefined,{numeric:true,sensitivity:'base'});
}

function suggestAllocations(product, lot, totalPieces) {
  const ppt = Number(product.piezas_por_tarima);
  let left = Number(totalPieces);
  const out = [];
  const candidates = buildLocationCandidates(product, lot);

  // 1) Llenar primero ubicaciones que ya tengan el mismo producto+lote,
  // incluso si están en nivel bajo. Se aprovecha primero un resto abierto.
  const same = candidates.filter(x => x.hasSameAssignment)
    .sort((a,b) =>
      (b.partialSpace > 0) - (a.partialSpace > 0) ||
      compareLocationModule(a,b,'DESC') ||
      a.availablePositions - b.availablePositions
    );

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
    .sort((a,b) => compareLocationModule(a,b,'DESC'));

  if (exact.length) {
    out.push({ location_id:exact[0].id, code:exact[0].code, pieces:left });
    return finalizeAllocations(out, ppt);
  }

  const pool = empty.sort((a,b) =>
    compareLocationModule(a,b,'DESC') ||
    Number(a.capacity_pallets)-Number(b.capacity_pallets)
  );
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
  const preview = $('#assignmentPreview'); if (preview) preview.textContent = '';
}

function setAssignmentPreview(allocs) {
  $('#autoAssign').dataset.allocations = JSON.stringify(allocs);
  const preview = $('#assignmentPreview'); if (preview) preview.innerHTML = allocs.map(a => `<span class="assign-chip">${escapeHtml(a.code)} · ${a.pieces} pzas (${a.positions_used} pos.)</span>`).join('');
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
      p_operator_name: currentOperatorName(),
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
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.folio)}</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#111}h1{margin:0}p{margin:5px 0 18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:7px;vertical-align:top}th{background:#eee}.meta{display:flex;gap:35px;margin:20px 0}.sign{display:flex;justify-content:space-between;margin-top:70px}.sign div{width:42%;border-top:1px solid #333;text-align:center;padding-top:7px}@media print{button{display:none}}</style></head><body><h1>WMS Acatlán</h1><p><b>Recepción de Producción</b></p><div class="meta"><div><b>Folio:</b> ${escapeHtml(r.folio)}</div><div><b>Fecha:</b> ${escapeHtml(r.date)}</div><div><b>Usuario:</b> ${escapeHtml(currentOperatorName())}</div></div><table><thead><tr><th>SKU</th><th>Producto</th><th>Lote</th><th>Producción</th><th>Caducidad</th><th>Piezas</th><th>Ubicaciones</th></tr></thead><tbody>${rows}</tbody></table><p><b>Observaciones:</b> ${escapeHtml(r.notes || '—')}</p><p><b>Estatus:</b> PENDIENTE DE LIBERACIÓN POR CALIDAD</p><div class="sign"><div>Entregó Producción</div><div>Recibió Almacén</div></div><br><button onclick="window.print()">Imprimir / Guardar PDF</button></body></html>`);
  w.document.close();
}

function inventorySearchText(x) {
  return normalizeText(`${x.sku} ${x.description} ${x.lot} ${x.location}`);
}

function renderInventory() {
  const body = $('#inventoryBody');
  if (!body) return;
  const query = normalizeText($('#inventoryFilter')?.value || '');
  const status = $('#inventoryStatusFilter')?.value || 'ALL';
  let active = inventoryRows.filter(x => Number(x.physical_pieces) > 0);
  if (query) active = active.filter(x => inventorySearchText(x).includes(query));
  if (status === 'PENDING') active = active.filter(x => Number(x.pending_quality_pieces) > 0);
  if (status === 'AVAILABLE') active = active.filter(x => Number(x.available_pieces) > 0);
  if (status === 'BLOCKED') active = active.filter(x => Number(x.blocked_pieces) > 0);
  if (status === 'RESERVED') active = active.filter(x => Number(x.reserved_pieces) > 0);

  body.innerHTML = active.map(x => {
    const physical = Number(x.physical_pieces || 0);
    const ppt = Number(x.pieces_per_pallet || 0);
    const pallets = Number(x.full_pallets ?? (ppt ? Math.floor(physical / ppt) : 0));
    const rest = Number(x.remainder_pieces ?? (ppt ? physical % ppt : 0));
    const tr = `${pallets} T${rest ? ` + ${rest} pzas` : ''}`;
    return `<tr>
      <td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.lot)}</td><td>${escapeHtml(x.location)}</td>
      <td>${physical.toLocaleString()}</td><td>${escapeHtml(tr)}</td>
      <td>${Number(x.pending_quality_pieces || 0).toLocaleString()}</td>
      <td>${Number(x.released_pieces || 0).toLocaleString()}</td>
      <td>${Number(x.blocked_pieces || 0).toLocaleString()}</td>
      <td>${Number(x.reserved_pieces || 0).toLocaleString()}</td>
      <td><b>${Number(x.available_pieces || 0).toLocaleString()}</b></td>
      <td>${escapeHtml(x.expiration_date)}</td><td>${Number(x.days_remaining).toLocaleString()}</td>
      <td><span class="status-pill ${String(x.expiration_color).toLowerCase()}">${escapeHtml(x.expiration_color)}</span></td>
      <td>${Number(x.available_pieces || 0) <= 0 ? '<span class="eligibility neutral">—</span>' : (Number(x.days_remaining) >= 245 ? '<span class="eligibility yes">ELEGIBLE</span>' : '<span class="eligibility no">NO SURTIR</span>')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="15" class="empty">Sin inventario para el filtro seleccionado</td></tr>';
  $('#inventoryCount').textContent = `${active.length} registros`;

  const totals = inventoryRows.filter(x => Number(x.physical_pieces) > 0).reduce((a,x) => {
    a.physical += Number(x.physical_pieces || 0);
    a.pending += Number(x.pending_quality_pieces || 0);
    a.released += Number(x.released_pieces || 0);
    a.blocked += Number(x.blocked_pieces || 0);
    a.reserved += Number(x.reserved_pieces || 0);
    a.available += Number(x.available_pieces || 0);
    return a;
  }, {physical:0,pending:0,released:0,blocked:0,reserved:0,available:0});

  [['#invPhysical','physical'],['#invPending','pending'],['#invReleased','released'],['#invBlocked','blocked'],['#invReserved','reserved'],['#invAvailable','available'],['#kpiPendingQuality','pending'],['#kpiReleased','released'],['#kpiBlocked','blocked'],['#kpiReserved','reserved'],['#kpiAvailable','available']].forEach(([sel,key]) => {
    const el = $(sel); if (el) el.textContent = totals[key].toLocaleString();
  });
}

function getQualityTabRows() {
  if (qualityTab === 'RELEASED') return inventoryRows.filter(x => Number(x.released_pieces) > 0);
  if (qualityTab === 'BLOCKED') return inventoryRows.filter(x => Number(x.blocked_pieces) > 0);
  return inventoryRows.filter(x => Number(x.pending_quality_pieces) > 0);
}

function setQualityTab(tab) {
  qualityTab = tab;
  $$('.quality-tab').forEach(b => b.classList.toggle('active', b.dataset.qualityTab === tab));
  const help = $('#qualityTabHelp');
  const qtyHeader = $('#qualityQtyHeader');
  if (tab === 'RELEASED') {
    help.textContent = 'Bloquea inventario que ya estaba liberado. No se pueden bloquear piezas reservadas.';
    qtyHeader.textContent = 'Liberado';
  } else if (tab === 'BLOCKED') {
    help.textContent = 'Re-libera inventario bloqueado cuando Calidad lo autorice. Lotes ROJOS o VENCIDOS no pueden re-liberarse.';
    qtyHeader.textContent = 'Bloqueado';
  } else {
    help.textContent = 'Libera o bloquea cantidades específicas que todavía están pendientes de Calidad.';
    qtyHeader.textContent = 'Pendiente';
  }
  renderQuality();
}

function renderQuality() {
  const body = $('#qualityBody');
  if (!body) return;
  const q = normalizeText($('#qualityFilter')?.value || '');
  let rows = getQualityTabRows();
  if (q) rows = rows.filter(x => inventorySearchText(x).includes(q));
  rows.sort((a,b) => Number(a.days_remaining) - Number(b.days_remaining) || String(a.sku).localeCompare(String(b.sku)));
  body.innerHTML = rows.map(x => {
    const qty = qualityTab === 'RELEASED' ? Number(x.released_pieces) : qualityTab === 'BLOCKED' ? Number(x.blocked_pieces) : Number(x.pending_quality_pieces);
    const reserved = Number(x.reserved_pieces || 0);
    const actionLabel = qualityTab === 'RELEASED' ? 'Bloquear' : qualityTab === 'BLOCKED' ? 'Re-liberar' : 'Procesar';
    const actionClass = qualityTab === 'RELEASED' ? 'quality-action-block' : qualityTab === 'BLOCKED' ? 'quality-action-release' : '';
    return `<tr>
      <td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.lot)}</td><td>${escapeHtml(x.location)}</td>
      <td><b>${qty.toLocaleString()}</b></td><td>${Number(x.physical_pieces).toLocaleString()}</td><td>${reserved.toLocaleString()}</td>
      <td>${escapeHtml(x.expiration_date)}</td><td>${Number(x.days_remaining).toLocaleString()}</td>
      <td><span class="status-pill ${String(x.expiration_color).toLowerCase()}">${escapeHtml(x.expiration_color)}</span></td>
      <td><button type="button" class="mini quality-process ${actionClass}" data-id="${escapeHtml(x.inventory_id)}">${actionLabel}</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="11" class="empty">No hay inventario en la pestaña ${qualityTab === 'PENDING' ? 'Pendiente' : qualityTab === 'RELEASED' ? 'Liberado' : 'Bloqueado'}</td></tr>`;
  $('#qualityCount').textContent = `${rows.length} registros`;
  body.querySelectorAll('.quality-process').forEach(b => b.onclick = () => openQualityModal(b.dataset.id));
}

function openQualityModal(inventoryId) {
  const x = inventoryRows.find(r => String(r.inventory_id) === String(inventoryId));
  if (!x) return alert('No se encontró el registro de inventario. Actualiza la pantalla.');
  qualitySelected = x;
  qualityMode = qualityTab;
  $('#qualityItemInfo').innerHTML = `<b>${escapeHtml(x.sku)} — ${escapeHtml(x.description)}</b><br>Lote: <b>${escapeHtml(x.lot)}</b> · Ubicación: <b>${escapeHtml(x.location)}</b> · Caducidad: <b>${escapeHtml(x.expiration_date)}</b> · ${Number(x.days_remaining)} días`;
  $('#qualityNotes').value = '';
  $('#qualityWarning').classList.add('hidden');
  $('#qualityWarning').textContent = '';
  $('#qualityPendingFields').classList.toggle('hidden', qualityMode !== 'PENDING');
  $('#qualityReclassFields').classList.toggle('hidden', qualityMode === 'PENDING');
  $('#qualityRelease').value = 0;
  $('#qualityBlock').value = 0;
  $('#qualityReclassQty').value = 0;

  if (qualityMode === 'RELEASED') {
    const released = Number(x.released_pieces || 0);
    const reserved = Number(x.reserved_pieces || 0);
    const maxBlock = Math.max(0, released - reserved);
    $('#qualityModalTitle').textContent = 'Bloquear inventario liberado';
    $('#qualityReclassLabel').childNodes[0].nodeValue = 'Bloquear (piezas)';
    $('#qualityReclassLimitLabel').textContent = 'Máximo bloqueable';
    $('#qualityReclassLimit').textContent = maxBlock.toLocaleString();
    $('#qualityPendingTotal').textContent = released.toLocaleString();
    $('#qualityBaseTotalLabel').childNodes[0].nodeValue = 'Liberado actual: ';
    $('#qualityRemainLabel').childNodes[0].nodeValue = 'Quedará liberado: ';
    $('#qualityReason').value = 'RETENCION CALIDAD';
    if (reserved > 0) {
      $('#qualityWarning').classList.remove('hidden');
      $('#qualityWarning').textContent = `${reserved.toLocaleString()} piezas están reservadas y no pueden bloquearse. Máximo bloqueable: ${maxBlock.toLocaleString()} piezas.`;
    }
  } else if (qualityMode === 'BLOCKED') {
    const blocked = Number(x.blocked_pieces || 0);
    $('#qualityModalTitle').textContent = 'Re-liberar inventario bloqueado';
    $('#qualityReclassLabel').childNodes[0].nodeValue = 'Re-liberar (piezas)';
    $('#qualityReclassLimitLabel').textContent = 'Máximo re-liberable';
    $('#qualityReclassLimit').textContent = blocked.toLocaleString();
    $('#qualityPendingTotal').textContent = blocked.toLocaleString();
    $('#qualityBaseTotalLabel').childNodes[0].nodeValue = 'Bloqueado actual: ';
    $('#qualityRemainLabel').childNodes[0].nodeValue = 'Quedará bloqueado: ';
    $('#qualityReason').value = 'RELIBERACION CALIDAD';
    if (Number(x.days_remaining) < 210) {
      $('#qualityWarning').classList.remove('hidden');
      $('#qualityWarning').textContent = `Este lote está ${x.expiration_color}. Con ${x.days_remaining} días restantes no puede re-liberarse.`;
    }
  } else {
    $('#qualityModalTitle').textContent = 'Procesar Calidad pendiente';
    const pending = Number(x.pending_quality_pieces || 0);
    $('#qualityPendingTotal').textContent = pending.toLocaleString();
    $('#qualityBaseTotalLabel').childNodes[0].nodeValue = 'Pendiente actual: ';
    $('#qualityRemainLabel').childNodes[0].nodeValue = 'Quedará pendiente: ';
    $('#qualityReason').value = 'LIBERACION CALIDAD';
    const cannotRelease = Number(x.days_remaining) < 210;
    $('#qualityRelease').disabled = cannotRelease;
    if (cannotRelease) {
      $('#qualityWarning').classList.remove('hidden');
      $('#qualityWarning').textContent = `Este lote está ${x.expiration_color}. Con ${x.days_remaining} días restantes no puede liberarse; solo puede bloquearse o quedar pendiente.`;
      $('#qualityReason').value = 'CADUCIDAD';
    } else {
      $('#qualityRelease').disabled = false;
    }
  }
  updateQualityTotals();
  $('#qualityModal').classList.remove('hidden');
}

function closeQualityModal() {
  $('#qualityModal')?.classList.add('hidden');
  qualitySelected = null;
}

function updateQualityTotals() {
  if (!qualitySelected) return;
  let process = 0, base = 0;
  if (qualityMode === 'PENDING') {
    process = Math.max(0, Number($('#qualityRelease').value || 0)) + Math.max(0, Number($('#qualityBlock').value || 0));
    base = Number(qualitySelected.pending_quality_pieces || 0);
  } else if (qualityMode === 'RELEASED') {
    process = Math.max(0, Number($('#qualityReclassQty').value || 0));
    base = Number(qualitySelected.released_pieces || 0);
  } else {
    process = Math.max(0, Number($('#qualityReclassQty').value || 0));
    base = Number(qualitySelected.blocked_pieces || 0);
  }
  $('#qualityProcessTotal').textContent = process.toLocaleString();
  $('#qualityRemainTotal').textContent = Math.max(0, base - process).toLocaleString();
  $('#qualityProcessTotal').classList.toggle('bad-number', process > base);
}

async function confirmQualityAction() {
  if (!qualitySelected) return;
  const btn = $('#confirmQuality');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    if (qualityMode === 'PENDING') {
      const release = Math.max(0, Math.trunc(Number($('#qualityRelease').value || 0)));
      const block = Math.max(0, Math.trunc(Number($('#qualityBlock').value || 0)));
      const pending = Number(qualitySelected.pending_quality_pieces || 0);
      if (release + block <= 0) throw new Error('Captura una cantidad a liberar o bloquear.');
      if (release + block > pending) throw new Error(`No puedes procesar más de ${pending.toLocaleString()} piezas pendientes.`);
      if (Number(qualitySelected.days_remaining) < 210 && release > 0) throw new Error('El inventario ROJO o VENCIDO no puede liberarse.');
      const { data, error } = await db.rpc('process_quality', {
        p_inventory_id: qualitySelected.inventory_id,
        p_release_pieces: release,
        p_block_pieces: block,
        p_reason: $('#qualityReason').value,
        p_observations: $('#qualityNotes').value.trim(),
        p_operator_name: currentOperatorName()
      });
      if (error) throw error;
      closeQualityModal(); await refreshOperationalData();
      alert(`Calidad registrada correctamente.\nLiberado: ${Number(data.released_now || 0).toLocaleString()} piezas\nBloqueado: ${Number(data.blocked_now || 0).toLocaleString()} piezas\nPendiente: ${Number(data.pending_remaining || 0).toLocaleString()} piezas`);
    } else {
      const qty = Math.max(0, Math.trunc(Number($('#qualityReclassQty').value || 0)));
      if (qty <= 0) throw new Error('Captura una cantidad mayor a cero.');
      const action = qualityMode === 'RELEASED' ? 'BLOCK_RELEASED' : 'RELEASE_BLOCKED';
      const { data, error } = await db.rpc('reclassify_quality_inventory', {
        p_inventory_id: qualitySelected.inventory_id,
        p_action: action,
        p_quantity_pieces: qty,
        p_reason: $('#qualityReason').value,
        p_observations: $('#qualityNotes').value.trim(),
        p_operator_name: currentOperatorName()
      });
      if (error) throw error;
      closeQualityModal(); await refreshOperationalData();
      const verb = qualityMode === 'RELEASED' ? 'bloqueadas' : 're-liberadas';
      alert(`${Number(data.quantity || qty).toLocaleString()} piezas ${verb} correctamente.\nDisponible actual: ${Number(data.available_after || 0).toLocaleString()} piezas.`);
    }
  } catch (err) {
    console.error(err);
    alert('No se pudo registrar Calidad. No se realizó ningún cambio.\n\n' + (err.message || err));
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar Calidad';
  }
}

$('#inventoryFilter')?.addEventListener('input', renderInventory);
$('#inventoryStatusFilter')?.addEventListener('change', renderInventory);
$('#qualityFilter')?.addEventListener('input', renderQuality);
$('#refreshInventory')?.addEventListener('click', refreshOperationalData);
$('#refreshQuality')?.addEventListener('click', refreshOperationalData);
$('#qualityRelease')?.addEventListener('input', updateQualityTotals);
$('#qualityBlock')?.addEventListener('input', updateQualityTotals);
$('#qualityReclassQty')?.addEventListener('input', updateQualityTotals);
$$('.quality-tab').forEach(b => b.addEventListener('click', () => setQualityTab(b.dataset.qualityTab)));
$('#closeQualityModal')?.addEventListener('click', closeQualityModal);
$('#cancelQuality')?.addEventListener('click', closeQualityModal);
$('#confirmQuality')?.addEventListener('click', confirmQualityAction);
$('#qualityModal')?.addEventListener('click', e => { if (e.target.id === 'qualityModal') closeQualityModal(); });

async function refreshDashboardSnapshot() {
  try {
    const { data, error } = await db.rpc('get_dashboard_snapshot');
    if (error) throw error;
    dashboardSnapshot = data || {};
    renderDashboardSnapshot(dashboardSnapshot);
  } catch (err) {
    console.warn('RPC dashboard no disponible; usando cálculo local:', err.message);
    dashboardSnapshot = buildLocalDashboardSnapshot();
    renderDashboardSnapshot(dashboardSnapshot);
  }
}

function buildLocalDashboardSnapshot() {
  const activeInv = inventoryRows.filter(x => Number(x.physical_pieces || 0) > 0);
  const inventory = activeInv.reduce((a,x) => {
    a.physical += Number(x.physical_pieces || 0);
    a.pending += Number(x.pending_quality_pieces || 0);
    a.released += Number(x.released_pieces || 0);
    a.blocked += Number(x.blocked_pieces || 0);
    a.reserved += Number(x.reserved_pieces || 0);
    a.available += Number(x.available_pieces || 0);
    if (Number(x.days_remaining) < 245) a.ineligible_245 += Number(x.available_pieces || 0);
    return a;
  }, {physical:0,pending:0,released:0,blocked:0,reserved:0,available:0,ineligible_245:0});

  const locRows = storageStatus.length ? storageStatus : locations.map(l => ({...l, code:l.ubicacion, capacity_pallets:l.capacidad, occupied_positions:0, available_positions:l.capacidad, status:l.estatus, location_type:l.location_type}));
  const loc = locRows.reduce((a,x) => {
    const cap = Number(x.capacity_pallets ?? x.capacidad ?? 0);
    const occ = Number(x.occupied_positions || 0);
    const blocked = String(x.status || '').toUpperCase() === 'BLOQUEADA';
    a.total += 1; a.capacity += cap; a.occupied_positions += occ;
    if (blocked) a.blocked += 1;
    else if (occ > 0) a.occupied += 1;
    else a.free += 1;
    const t = normalizeStorageType(x.location_type, x.code || x.ubicacion);
    a.types[t].capacity += cap; a.types[t].occupied_positions += occ;
    return a;
  }, {total:0,occupied:0,free:0,blocked:0,capacity:0,occupied_positions:0,types:{RACK:{capacity:0,occupied_positions:0},PISO:{capacity:0,occupied_positions:0}}});
  loc.available_positions = Math.max(0, loc.capacity - loc.occupied_positions);
  loc.types.RACK.available_positions = Math.max(0, loc.types.RACK.capacity - loc.types.RACK.occupied_positions);
  loc.types.PISO.available_positions = Math.max(0, loc.types.PISO.capacity - loc.types.PISO.occupied_positions);

  const storage = {RACK:{physical:0,occupied_positions:loc.types.RACK.occupied_positions,capacity:loc.types.RACK.capacity},PISO:{physical:0,occupied_positions:loc.types.PISO.occupied_positions,capacity:loc.types.PISO.capacity}};
  activeInv.forEach(x => {
    const t = normalizeStorageType(x.location_type, x.location);
    storage[t].physical += Number(x.physical_pieces || 0);
  });
  return {inventory, locations:loc, storage, operations:{picklists:0,counts:0,adjustments:0,incidents:0}};
}

function setDashText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = Number(value || 0).toLocaleString();
}

function renderDashboardSnapshot(s) {
  const inv = s?.inventory || {};
  const loc = s?.locations || {};
  const storage = s?.storage || {};
  const ops = s?.operations || {};
  setDashText('kpiPhysical', inv.physical);
  setDashText('kpiAvailable', inv.available);
  setDashText('kpiPendingQuality', inv.pending);
  setDashText('kpiBlocked', inv.blocked);
  setDashText('kpiReserved', inv.reserved);
  setDashText('kpiIneligible245', inv.ineligible_245);
  setDashText('kpiOccupiedLocations', loc.occupied);
  setDashText('kpiFreeLocations', loc.free);
  setDashText('kpiBlockedLocations', loc.blocked);
  setDashText('kpiOccupiedPositions', loc.occupied_positions);
  setDashText('kpiAvailablePositions', loc.available_positions);
  setDashText('kpiCapacity', loc.capacity || locations.reduce((a,b)=>a+Number(b.capacidad||0),0));

  const capacity = Number(loc.capacity || 0), occupied = Number(loc.occupied_positions || 0);
  const pct = capacity > 0 ? Math.min(100, occupied / capacity * 100) : 0;
  const pctEl = $('#warehouseOccupancyPct'); if (pctEl) pctEl.textContent = `${pct.toFixed(1)}% ocupado`;
  const fill = $('#capacityBarFill'); if (fill) fill.style.width = `${pct}%`;
  const barText = $('#capacityBarText'); if (barText) barText.textContent = `${occupied.toLocaleString()} / ${capacity.toLocaleString()} posiciones`;

  const rack = storage.RACK || {}, floor = storage.PISO || {};
  setDashText('rackPhysical', rack.physical); setDashText('rackPositions', rack.occupied_positions);
  setDashText('floorPhysical', floor.physical); setDashText('floorPositions', floor.occupied_positions);
  const rackCap=Number(rack.capacity||0), rackOcc=Number(rack.occupied_positions||0), floorCap=Number(floor.capacity||0), floorOcc=Number(floor.occupied_positions||0);
  const rb=$('#rackBar'); if(rb) rb.style.width=`${rackCap?Math.min(100,rackOcc/rackCap*100):0}%`;
  const fb=$('#floorBar'); if(fb) fb.style.width=`${floorCap?Math.min(100,floorOcc/floorCap*100):0}%`;
  const rct=$('#rackCapacityText'); if(rct) rct.textContent=`${rackOcc.toLocaleString()} / ${rackCap.toLocaleString()} pos.`;
  const fct=$('#floorCapacityText'); if(fct) fct.textContent=`${floorOcc.toLocaleString()} / ${floorCap.toLocaleString()} pos.`;

  setDashText('dashPicklists', ops.picklists);
  setDashText('dashCounts', ops.counts);
  setDashText('dashAdjustments', ops.adjustments);
  setDashText('dashIncidents', ops.incidents);
}

$('#refreshDashboard')?.addEventListener('click', refreshOperationalData);

function renderExpiry(rows) {
  const map = Object.fromEntries(rows.map(x => [x.color, Number(x.total_pieces || 0)]));
  setDashText('expiryGreen', map.VERDE || 0);
  setDashText('expiryYellow', map.AMARILLO || 0);
  setDashText('expiryRed', map.ROJO || 0);
  setDashText('expiryExpired', map.VENCIDO || 0);
}


// ============================================================
// TRANSFERENCIAS INTERNAS v1
// ============================================================
function transferBucketAvailable(x, bucket) {
  if (bucket === 'PENDING') return Number(x.pending_quality_pieces || 0);
  if (bucket === 'BLOCKED') return Number(x.blocked_pieces || 0);
  return Math.max(0, Number(x.released_pieces || 0) - Number(x.reserved_pieces || 0));
}

function transferBucketLabel(bucket) {
  return bucket === 'PENDING' ? 'Pendiente Calidad' : bucket === 'BLOCKED' ? 'Bloqueado' : 'Liberado disponible';
}

function renderTransfers() {
  const body = $('#transferBody');
  if (!body) return;
  const bucket = $('#transferBucketFilter')?.value || 'RELEASED';
  const q = normalizeText($('#transferFilter')?.value || '');
  let rows = inventoryRows.filter(x => Number(x.physical_pieces || 0) > 0 && transferBucketAvailable(x, bucket) > 0);
  if (q) rows = rows.filter(x => inventorySearchText(x).includes(q));
  body.innerHTML = rows.map(x => {
    const max = transferBucketAvailable(x, bucket);
    const ppt = Number(x.pieces_per_pallet || 0);
    const full = ppt ? Math.floor(max / ppt) : 0;
    const rest = ppt ? max % ppt : max;
    const locType = normalizeStorageType(x.location_type, x.location);
    return `<tr>
      <td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.lot)}</td>
      <td>${escapeHtml(x.location)}</td><td><span class="transfer-origin-type">${escapeHtml(locType)}</span></td>
      <td>${Number(x.physical_pieces||0).toLocaleString()}</td><td><b>${max.toLocaleString()}</b><br><span class="transfer-bucket ${bucket}">${transferBucketLabel(bucket)}</span></td>
      <td>${full} T${rest ? ` + ${rest} pzas` : ''}</td>
      <td><button type="button" class="mini transfer-open" data-id="${escapeHtml(x.inventory_id)}">Mover</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">No hay inventario transferible con este filtro.</td></tr>';
  $('#transferCount').textContent = `${rows.length} opciones`;
  body.querySelectorAll('.transfer-open').forEach(b => b.onclick = () => openTransferModal(b.dataset.id));
}

function getStorageRowByLocationId(id) {
  return storageStatus.find(x => String(x.id) === String(id)) || null;
}

function getTransferDestinationCandidates(x, qty) {
  const sourceLoc = locations.find(l => l.ubicacion === x.location);
  const product = products.find(p => String(p.sku) === String(x.sku));
  if (!sourceLoc || !product) return [];
  const productType = normalizeStorageType(product.storage_type);
  const ppt = Number(x.pieces_per_pallet || product.piezas_por_tarima || 0);
  if (!ppt || !qty) return [];

  return locations.filter(l => {
    if (String(l.id) === String(sourceLoc.id)) return false;
    if (String(l.estatus || '').toUpperCase() !== 'DISPONIBLE') return false;
    if (normalizeStorageType(l.location_type, l.ubicacion) !== productType) return false;
    const st = getStorageRowByLocationId(l.id);
    const assignedProductId = st?.product_id || null;
    const assignedLot = st?.lot || null;
    if (assignedProductId && (String(assignedProductId) !== String(product.id) || normalizeLot(assignedLot) !== normalizeLot(x.lot))) return false;
    const existingPieces = Number(st?.physical_pieces || st?.total_physical_pieces || 0);
    const positionsAfter = ceilDiv(existingPieces + Number(qty), ppt);
    return positionsAfter <= Number(l.capacidad || 0);
  }).map(l => {
    const st = getStorageRowByLocationId(l.id);
    const existingPieces = Number(st?.physical_pieces || st?.total_physical_pieces || 0);
    const occupied = Number(st?.occupied_positions || 0);
    const available = Math.max(0, Number(l.capacidad || 0) - occupied);
    const positionsAfter = ceilDiv(existingPieces + Number(qty), ppt);
    const addedPositions = Math.max(0, positionsAfter - occupied);
    const exact = addedPositions === available;
    const hasSame = existingPieces > 0;
    return {...l, existingPieces, occupied, available, positionsAfter, addedPositions, exact, hasSame};
  });
}

function sortTransferCandidates(candidates, x, qty) {
  const ppt = Number(x.pieces_per_pallet || 0);
  const isRemainder = Number(qty) % ppt !== 0 || Number(qty) < ppt;
  const type = normalizeStorageType(x.location_type, x.location);
  return [...candidates].sort((a,b) => {
    if (a.hasSame !== b.hasSame) return a.hasSame ? -1 : 1;
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (type === 'RACK') {
      const rackCompare=String(a.rack||'').localeCompare(String(b.rack||''),undefined,{numeric:true,sensitivity:'base'});
      if(rackCompare!==0) return rackCompare;
      const positionCompare=String(a.posicion||a.position||'').localeCompare(String(b.posicion||b.position||''),undefined,{numeric:true,sensitivity:'base'});
      if(positionCompare!==0) return positionCompare;
      if (a.nivel !== b.nivel) {
        return isRemainder
          ? Number(a.nivel) - Number(b.nivel)
          : Number(b.nivel) - Number(a.nivel);
      }
    }
    if (a.available !== b.available) return Number(a.available) - Number(b.available);
    return String(a.ubicacion).localeCompare(String(b.ubicacion),undefined,{numeric:true,sensitivity:'base'});
  });
}

function openTransferModal(inventoryId) {
  const x = inventoryRows.find(r => String(r.inventory_id) === String(inventoryId));
  if (!x) return;
  transferSelected = x;
  const bucket = $('#transferBucketFilter')?.value || 'RELEASED';
  const max = transferBucketAvailable(x, bucket);
  $('#transferItemInfo').innerHTML = `<b>${escapeHtml(x.sku)} — ${escapeHtml(x.description)}</b><br>Lote: <b>${escapeHtml(x.lot)}</b> · Origen: <b>${escapeHtml(x.location)}</b> · Tipo: <b>${escapeHtml(normalizeStorageType(x.location_type, x.location))}</b>`;
  $('#transferBucketLabel').value = transferBucketLabel(bucket);
  $('#transferMax').value = max.toLocaleString();
  $('#transferQty').value = '';
  $('#transferQty').max = max;
  $('#transferDestination').innerHTML = '<option value="">Captura cantidad primero</option>';
  $('#transferDestinationInfo').textContent = 'Captura la cantidad a mover para calcular destinos válidos.';
  $('#transferNotes').value = '';
  $('#transferModal').classList.remove('hidden');
}

function refreshTransferDestinations(autoPick=false) {
  if (!transferSelected) return;
  const qty = Number($('#transferQty').value || 0);
  const bucket = $('#transferBucketFilter')?.value || 'RELEASED';
  const max = transferBucketAvailable(transferSelected, bucket);
  const select = $('#transferDestination');
  if (!qty || qty <= 0 || qty > max) {
    select.innerHTML = '<option value="">Cantidad inválida</option>';
    $('#transferDestinationInfo').textContent = `Máximo transferible: ${max.toLocaleString()} piezas.`;
    return;
  }
  const previousDestination = select.value;
  const candidates = sortTransferCandidates(getTransferDestinationCandidates(transferSelected, qty), transferSelected, qty);
  select.innerHTML = '<option value="">Selecciona destino</option>' + candidates.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.ubicacion)} · ${escapeHtml(c.location_type)} · ${c.available} pos. disp.${c.hasSame ? ' · mismo SKU+lote' : ''}</option>`).join('');
  if (!candidates.length) {
    $('#transferDestinationInfo').textContent = 'No existe una ubicación compatible con capacidad suficiente.';
    return;
  }
  if (autoPick) select.value = candidates[0].id;
  else if (candidates.some(c => String(c.id) === String(previousDestination))) select.value = previousDestination;
  const chosen = candidates.find(c => String(c.id) === String(select.value)) || candidates[0];
  const ppt = Number(transferSelected.pieces_per_pallet || 0);
  const isRemainder = qty % ppt !== 0 || qty < ppt;
  $('#transferDestinationInfo').innerHTML = `Sugerencia: <b>${escapeHtml(chosen.ubicacion)}</b> · ${isRemainder && normalizeStorageType(transferSelected.location_type, transferSelected.location)==='RACK' ? 'resto → nivel bajo' : 'almacenamiento → nivel alto/capacidad exacta'} · posiciones después: <b>${chosen.positionsAfter}</b> / ${chosen.capacidad}.`;
}

function closeTransferModal() {
  $('#transferModal')?.classList.add('hidden');
  transferSelected = null;
}

async function confirmTransfer() {
  if (!transferSelected) return;
  const qty = Number($('#transferQty').value || 0);
  const destinationId = $('#transferDestination').value;
  const bucket = $('#transferBucketFilter')?.value || 'RELEASED';
  const max = transferBucketAvailable(transferSelected, bucket);
  if (!qty || qty <= 0 || qty > max) return alert(`Cantidad inválida. Máximo: ${max.toLocaleString()} piezas.`);
  if (!destinationId) return alert('Selecciona una ubicación destino.');
  const btn = $('#confirmTransfer');
  btn.disabled = true; btn.textContent = 'Transfiriendo…';
  try {
    const { data, error } = await db.rpc('confirm_internal_transfer', {
      p_inventory_id: transferSelected.inventory_id,
      p_destination_location_id: destinationId,
      p_quantity_pieces: qty,
      p_bucket: bucket,
      p_reason: $('#transferReason').value,
      p_observations: $('#transferNotes').value || null
    });
    if (error) throw error;
    closeTransferModal();
    await refreshOperationalData();
    alert(`Transferencia confirmada.\nFolio: ${data?.folio || data || 'generado'}\nCantidad: ${qty.toLocaleString()} piezas.`);
  } catch (err) {
    console.error(err);
    alert('No se realizó la transferencia. No se guardó ningún movimiento.\n\n' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar transferencia';
  }
}

$('#transferFilter')?.addEventListener('input', renderTransfers);
$('#transferBucketFilter')?.addEventListener('change', renderTransfers);
$('#refreshTransfers')?.addEventListener('click', refreshOperationalData);
$('#transferQty')?.addEventListener('input', () => refreshTransferDestinations(false));
$('#suggestTransferDestination')?.addEventListener('click', () => refreshTransferDestinations(true));
$('#transferDestination')?.addEventListener('change', () => refreshTransferDestinations(false));
$('#closeTransferModal')?.addEventListener('click', closeTransferModal);
$('#cancelTransfer')?.addEventListener('click', closeTransferModal);
$('#confirmTransfer')?.addEventListener('click', confirmTransfer);
$('#transferModal')?.addEventListener('click', e => { if (e.target.id === 'transferModal') closeTransferModal(); });



// ============================================================
// PEDIDOS + PICKLIST v1
// ============================================================
function normalizeOrderHeader(v) {
  return normalizeText(v)
    .replace(/[\/\\_+]+/g,' ')
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function orderCell(row, idx) {
  if (idx < 0 || idx >= row.length) return '';
  return row[idx] ?? '';
}

function parseOrderDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  if (typeof v === 'number' && window.XLSX?.SSF?.parse_date_code) {
    const x = window.XLSX.SSF.parse_date_code(v);
    if (x) return `${String(x.y).padStart(4,'0')}-${String(x.m).padStart(2,'0')}-${String(x.d).padStart(2,'0')}`;
  }
  const s = String(v || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0,10);
}

function parseOrderNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/,/g,'');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function productSkuFromOrderCell(v) {
  const s = String(v || '').trim();
  const m = s.match(/\[([^\]]+)\]/);
  if (m) return m[1].trim();
  const first = s.split(/\s+/)[0];
  return products.some(p => String(p.sku) === first) ? first : '';
}

function orderConversionFactor(unit, product) {
  const raw = String(unit || '').trim();
  const u = normalizeText(raw);
  if (!u) return {error:'Unidad vacía'};
  if (u.includes('pieza') || u === 'pza' || u === 'pzas') return {factor:1, label:'PIEZA'};
  if (u.includes('tarima') || u.includes('pallet')) {
    if (!product.piezas_por_tarima) return {error:'Producto sin piezas/tarima'};
    return {factor:Number(product.piezas_por_tarima), label:'TARIMA'};
  }
  if (u.includes('caja')) {
    const m = raw.match(/(\d+)\s*(?:pza|pzas|pieza|piezas)/i) || raw.match(/c\s*\/\s*(\d+)/i) || raw.match(/(\d+)/);
    if (!m) return {error:`No se pudo convertir unidad "${raw}"`};
    return {factor:Number(m[1]), label:'CAJA'};
  }
  return {error:`Unidad no reconocida: ${raw}`};
}

function findOrderColumn(headers, aliases) {
  const norm = headers.map(normalizeOrderHeader);
  for (const alias of aliases) {
    const a = normalizeOrderHeader(alias);
    const exact = norm.findIndex(x => x === a);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const a = normalizeOrderHeader(alias);
    const partial = norm.findIndex(x => x.includes(a));
    if (partial >= 0) return partial;
  }
  return -1;
}

function parseOrdersWorkbook(file) {
  return new Promise((resolve,reject) => {
    if (!window.XLSX) return reject(new Error('No se pudo cargar el lector de Excel.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = e => {
      try {
        const wb = window.XLSX.read(e.target.result, {type:'array', cellDates:true});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:true});
        const headerIndex = rows.findIndex(r => {
          const h = r.map(normalizeOrderHeader);
          return h.some(x => x.includes('referencia')) &&
                 h.some(x => x.includes('producto')) &&
                 h.some(x => x.includes('demanda')) &&
                 h.some(x => x.includes('udm') || x.includes('unidad'));
        });
        if (headerIndex < 0) throw new Error('No encontré encabezados de Referencia de entrega / Producto / Demanda.');

        const headers = rows[headerIndex];
        const cDate = findOrderColumn(headers,[
          'Movimientos de stock/Fecha programada',
          'Fecha programada','Fecha'
        ]);
        const cRef = findOrderColumn(headers,[
          'Movimientos de stock/Referencia',
          'Referencia de entrega','Referencia'
        ]);
        const cSO = findOrderColumn(headers,[
          'Orden de venta/Referencia de la orden',
          'Orden de venta','Referencia de la orden'
        ]);
        const cCustomer = findOrderColumn(headers,[
          'Orden de venta/+ Dirección de Entrega',
          'Orden de venta/+ Direccion de Entrega',
          'Dirección de Entrega','Direccion de Entrega','Cliente'
        ]);
        const cProduct = findOrderColumn(headers,[
          'Movimientos de stock/Producto','Producto'
        ]);
        const cDemand = findOrderColumn(headers,[
          'Movimientos de stock/Demanda','Demanda'
        ]);
        const cUnit = findOrderColumn(headers,[
          'Movimientos de stock/UdM',
          'Movimientos de stock/Unidad de medida',
          'UdM','Unidad de medida','Unidad'
        ]);

        const required = {Referencia:cRef,Orden:cSO,Cliente:cCustomer,Producto:cProduct,Demanda:cDemand,Unidad:cUnit};
        const missing = Object.entries(required).filter(([,idx]) => idx < 0).map(([k])=>k);
        if (missing.length) throw new Error(`Faltan columnas requeridas: ${missing.join(', ')}.`);

        let current = {ref:'', sales:'', customer:'', date:''};
        const grouped = new Map();
        const globalErrors = [];

        for (let ri=headerIndex+1; ri<rows.length; ri++) {
          const r = rows[ri];
          const refVal = String(orderCell(r,cRef)||'').trim();
          const salesVal = String(orderCell(r,cSO)||'').trim();
          const custVal = String(orderCell(r,cCustomer)||'').trim();
          const dateVal = cDate >= 0 ? parseOrderDate(orderCell(r,cDate)) : '';

          if (refVal) current.ref = refVal;
          if (salesVal) current.sales = salesVal;
          if (custVal) current.customer = custVal;
          if (dateVal) current.date = dateVal;

          const prodCell = orderCell(r,cProduct);
          const demandRaw = orderCell(r,cDemand);
          if (!String(prodCell||'').trim() || String(demandRaw||'').trim()==='') continue;

          const demand = parseOrderNumber(demandRaw);
          if (!Number.isFinite(demand) || demand <= 0) continue;
          if (!current.ref) { globalErrors.push(`Fila ${ri+1}: producto sin Referencia de entrega.`); continue; }

          const sku = productSkuFromOrderCell(prodCell);
          const product = products.find(p => String(p.sku) === String(sku));
          const rowErrors = [];
          if (!sku || !product) rowErrors.push(`SKU no encontrado: ${sku || String(prodCell)}`);
          const conv = product ? orderConversionFactor(orderCell(r,cUnit), product) : {error:'Producto inválido'};
          if (conv.error) rowErrors.push(conv.error);

          const pieces = product && !conv.error ? demand * conv.factor : 0;
          if (pieces && !Number.isInteger(pieces)) rowErrors.push(`La conversión resulta en piezas fraccionadas: ${pieces}.`);

          if (!grouped.has(current.ref)) {
            grouped.set(current.ref, {
              delivery_reference: current.ref,
              sales_order: current.sales,
              customer_name: current.customer,
              scheduled_date: current.date,
              linesMap: new Map(),
              errors: []
            });
          }
          const g = grouped.get(current.ref);
          if (current.sales && g.sales_order && current.sales !== g.sales_order) g.errors.push(`La referencia contiene más de una orden de venta: ${g.sales_order} / ${current.sales}.`);
          if (!g.sales_order && current.sales) g.sales_order = current.sales;
          if (!g.customer_name && current.customer) g.customer_name = current.customer;
          if (!g.scheduled_date && current.date) g.scheduled_date = current.date;
          g.errors.push(...rowErrors.map(x => `Fila ${ri+1}: ${x}`));

          if (!rowErrors.length) {
            const prev = g.linesMap.get(sku) || 0;
            g.linesMap.set(sku, prev + Math.trunc(pieces));
          }
        }

        const orders = [...grouped.values()].map(g => {
          if (!g.sales_order) g.errors.push('Orden de venta vacía.');
          if (!g.customer_name) g.errors.push('Cliente vacío.');
          const lines = [...g.linesMap.entries()].map(([sku,requested_pieces]) => ({sku,requested_pieces}));
          if (!lines.length) g.errors.push('Pedido sin líneas válidas.');
          return {
            delivery_reference:g.delivery_reference,
            sales_order:g.sales_order,
            customer_name:g.customer_name,
            scheduled_date:g.scheduled_date,
            lines,
            total_pieces:lines.reduce((a,x)=>a+x.requested_pieces,0),
            errors:[...new Set(g.errors)]
          };
        });
        resolve({orders, errors:globalErrors});
      } catch(err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

function renderOrderImportPreview(globalErrors=[]) {
  const body = $('#orderPreviewBody');
  if (!body) return;
  body.innerHTML = orderImportPreview.map(o => `<tr>
    <td>${escapeHtml(o.delivery_reference)}</td>
    <td>${escapeHtml(o.sales_order)}</td>
    <td>${escapeHtml(o.customer_name)}</td>
    <td>${escapeHtml(o.scheduled_date || '')}</td>
    <td>${o.lines.length}</td>
    <td>${Number(o.total_pieces||0).toLocaleString()}</td>
    <td>${o.errors.length ? `<span class="import-bad">${escapeHtml(o.errors[0])}${o.errors.length>1?` (+${o.errors.length-1})`:''}</span>` : '<span class="import-ok">VÁLIDO</span>'}</td>
  </tr>`).join('') || '<tr><td colspan="7" class="empty">No se encontraron pedidos.</td></tr>';

  const allErrors = [...globalErrors, ...orderImportPreview.flatMap(o => o.errors.map(e => `${o.delivery_reference}: ${e}`))];
  const box = $('#orderImportErrors');
  if (allErrors.length) {
    box.classList.remove('hidden');
    box.innerHTML = `<b>Validaciones:</b><br>${allErrors.slice(0,20).map(escapeHtml).join('<br>')}${allErrors.length>20?`<br>… y ${allErrors.length-20} más`:''}`;
  } else box.classList.add('hidden');

  const valid = orderImportPreview.filter(o=>!o.errors.length);
  $('#orderImportStatus').textContent = `${valid.length} válidos / ${orderImportPreview.length} pedidos`;
  $('#importOrdersExcel').disabled = valid.length === 0;
}

async function previewOrdersExcel() {
  const file = $('#ordersExcelFile')?.files?.[0];
  if (!file) return alert('Selecciona un archivo Excel.');
  $('#orderImportStatus').textContent = 'Leyendo…';
  try {
    const parsed = await parseOrdersWorkbook(file);
    orderImportPreview = parsed.orders;
    renderOrderImportPreview(parsed.errors);
  } catch(err) {
    console.error(err);
    orderImportPreview = [];
    $('#importOrdersExcel').disabled = true;
    $('#orderImportStatus').textContent = 'Error';
    alert('No se pudo leer el archivo de pedidos.\n\n' + err.message);
  }
}

async function importOrdersExcel() {
  const file = $('#ordersExcelFile')?.files?.[0];
  const valid = orderImportPreview.filter(o=>!o.errors.length);
  if (!file || !valid.length) return;
  const btn = $('#importOrdersExcel');
  btn.disabled = true; btn.textContent = 'Importando…';
  let ok=0, failed=[];
  try {
    for (const o of valid) {
      const {error} = await db.rpc('import_wms_order', {
        p_delivery_reference:o.delivery_reference,
        p_sales_order:o.sales_order,
        p_customer_name:o.customer_name,
        p_scheduled_date:o.scheduled_date ? `${o.scheduled_date}T12:00:00` : null,
        p_source_file:file.name,
        p_lines:o.lines,
        p_operator_name:currentOperatorName()
      });
      if (error) failed.push(`${o.delivery_reference}: ${error.message}`);
      else ok++;
    }
    await refreshOrdersPicklists();
    await refreshShipments();
    await refreshDashboardSnapshot();
    alert(`Importación terminada.\nPedidos importados: ${ok}${failed.length?`\nCon error: ${failed.length}\n\n${failed.slice(0,8).join('\n')}`:''}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Importar pedidos válidos';
  }
}

async function refreshOrdersPicklists() {
  try {
    const [ordersRes,pickRes] = await Promise.all([
      db.from('orders_wms_view').select('*').order('imported_at',{ascending:false}),
      db.from('picklists_wms_view').select('*').order('generated_at',{ascending:false})
    ]);
    if (ordersRes.error) throw ordersRes.error;
    if (pickRes.error) throw pickRes.error;
    orderRows = ordersRes.data || [];
    picklistRows = pickRes.data || [];
    renderOrders();
    renderPicklists();
  } catch(err) {
    console.warn('Pedidos/Picklists aún no disponibles:', err.message);
  }
}

function renderOrders() {
  const body=$('#ordersBody');
  if(!body) return;
  body.innerHTML = orderRows.map(o => {
    const canGenerate = !o.picklist_id && !['CANCELADO','CERRADO','SURTIDO_COMPLETO','SURTIDO_PARCIAL'].includes(o.status);
    return `<tr>
      <td><b>${escapeHtml(o.delivery_reference)}</b></td><td>${escapeHtml(o.sales_order)}</td><td>${escapeHtml(o.customer_name)}</td>
      <td>${Number(o.minimum_shelf_life_days||245)} días</td>
      <td>${Number(o.requested_pieces||0).toLocaleString()}</td><td>${Number(o.reserved_pieces||0).toLocaleString()}</td><td>${Number(o.pending_pieces||0).toLocaleString()}</td>
      <td><span class="order-status">${escapeHtml(o.status)}</span></td>
      <td>${canGenerate?`<button class="mini primary generate-picklist" data-id="${escapeHtml(o.order_id)}">Generar picklist</button>`:o.picklist_folio?`<button class="mini view-order-picklist" data-pick="${escapeHtml(o.picklist_id)}">${escapeHtml(o.picklist_folio)}</button>`:'—'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">No hay pedidos importados.</td></tr>';
  body.querySelectorAll('.generate-picklist').forEach(b=>b.onclick=()=>generatePicklist(b.dataset.id,b));
  body.querySelectorAll('.view-order-picklist').forEach(b=>b.onclick=()=>openPicklistFromOrders(b.dataset.pick));
}

async function generatePicklist(orderId, btn) {
  if (!confirm('Se reservará inventario inmediatamente usando FEFO. ¿Generar picklist?')) return;
  const old=btn.textContent; btn.disabled=true; btn.textContent='Reservando…';
  try {
    const {data,error}=await db.rpc('generate_wms_picklist',{p_order_id:orderId,p_operator_name:currentOperatorName()});
    if(error) throw error;
    await refreshOperationalData();
    alert(`Picklist generada.\nFolio: ${data.folio}\nSolicitado: ${Number(data.requested_pieces).toLocaleString()} piezas\nReservado: ${Number(data.reserved_pieces).toLocaleString()} piezas\nFaltante: ${Number(data.shortage_pieces).toLocaleString()} piezas\nVida mínima: ${data.minimum_shelf_life_days} días.`);
    openPicklistDetail(data.picklist_id);
  } catch(err) {
    console.error(err);
    alert('No se pudo generar la picklist.\n\n'+err.message);
  } finally { btn.disabled=false; btn.textContent=old; }
}


function renderPicklists() {
  const body=$('#picklistsBody');
  if(!body) return;
  body.innerHTML=picklistRows.map(p=>`<tr>
    <td><b>${escapeHtml(p.folio)}</b></td><td>${escapeHtml(p.delivery_reference)}</td><td>${escapeHtml(p.customer_name)}</td>
    <td>${Number(p.line_count||0)}</td><td>${Number(p.reserved_pieces||0).toLocaleString()}</td>
    <td><b>${Number(p.reserved_full_pallets||0)}</b> completas${Number(p.reserved_remainders||0)>0?` + <b>${Number(p.reserved_remainders||0)}</b> resto(s)`:''}<small class="pick-user">${Number(p.reserved_pallet_positions||0)} posiciones</small></td>
    <td>${Number(p.confirmed_pieces||0).toLocaleString()}</td>
    <td><span class="order-status">${escapeHtml(p.status)}</span>${p.taken_by_name?`<small class="pick-user">Por ${escapeHtml(p.taken_by_name)}</small>`:''}</td>
    <td><button class="mini pick-detail" data-id="${escapeHtml(p.picklist_id)}">${['SURTIDA_COMPLETA','SURTIDA_PARCIAL'].includes(p.status)?'Ver':'Abrir surtido'}</button></td>
  </tr>`).join('') || '<tr><td colspan="9" class="empty">No hay picklists generadas.</td></tr>';

}

async function openPicklistFromOrders(id) {
  $$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.view==='picklists'));
  $$('.view').forEach(v=>v.classList.add('hidden'));
  $('#picklists').classList.remove('hidden');
  $('#title').textContent='Picklists';
  await openPicklistDetail(id);
}

function updatePickingTotals() {
  let reserved=0, confirmed=0;
  document.querySelectorAll('#picklistDetailBody tr[data-line-id]').forEach(tr=>{
    reserved += Number(tr.dataset.reserved||0);
    confirmed += Number(tr.querySelector('.pick-confirmed')?.value||0);
  });
  const reservedEl = document.getElementById('pickingReservedTotal');
  const confirmedEl = document.getElementById('pickingConfirmedTotal');
  const differenceEl = document.getElementById('pickingDifferenceTotal');
  if (reservedEl) reservedEl.textContent = reserved.toLocaleString();
  if (confirmedEl) confirmedEl.textContent = confirmed.toLocaleString();
  if (differenceEl) differenceEl.textContent = (reserved-confirmed).toLocaleString();
}

function syncPickingRow(tr) {
  const reserved=Number(tr.dataset.reserved||0);
  const input=tr.querySelector('.pick-confirmed');
  let value=Math.trunc(Number(input.value||0));
  if(value<0)value=0;
  if(value>reserved)value=reserved;
  input.value=value;
  const hasDiff=value<reserved;
  tr.querySelector('.pick-incident').disabled=!hasDiff;
  tr.querySelector('.pick-treatment').disabled=!hasDiff;
  tr.querySelector('.pick-notes').disabled=!hasDiff;
  tr.classList.toggle('has-pick-difference',hasDiff);
  updatePickingTotals();
}

async function openPicklistDetail(id) {
  const {data,error}=await db.from('picklist_detail_wms_view').select('*').eq('picklist_id',id)
    .order('picking_route',{ascending:true}).order('location',{ascending:true});
  if(error) return alert('No se pudo cargar la picklist.\n\n'+error.message);
  currentPicklistDetail=data||[]; currentPicklistId=id;
  const header=picklistRows.find(p=>String(p.picklist_id)===String(id));
  $('#picklistDetailTitle').textContent=`Picklist ${header?.folio || ''}`;
  $('#picklistDetailSub').textContent=header?`${header.delivery_reference} · ${header.customer_name} · ${header.status}`:'';

  const editable=header?.status==='EN_SURTIDO' && header?.taken_by_name===currentOperatorName();
  const finished=['SURTIDA_COMPLETA','SURTIDA_PARCIAL'].includes(header?.status);

  $('#picklistDetailBody').innerHTML=currentPicklistDetail.map((x,i)=>`<tr data-line-id="${escapeHtml(x.picklist_line_id)}" data-reserved="${Number(x.reserved_pieces||0)}">
    <td>${i+1}</td><td><b>${escapeHtml(x.location)}</b></td><td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.description)}</td>
    <td>${escapeHtml(x.lot)}</td><td>${escapeHtml(x.expiration_date)}</td><td>${Number(x.days_remaining)}</td>
    <td><b>${Number(x.reserved_pieces||0).toLocaleString()}</b></td>
    <td><input class="pick-confirmed" type="number" min="0" max="${Number(x.reserved_pieces||0)}" step="1" value="${finished?Number(x.confirmed_pieces||0):Number(x.reserved_pieces||0)}" ${editable?'':'disabled'}></td>
    <td><select class="pick-incident" ${editable?'':'disabled'}><option value="">Selecciona</option><option>DIFERENCIA FISICA</option><option>PRODUCTO DAÑADO</option><option>PRODUCTO NO ENCONTRADO</option><option>ERROR DE UBICACION</option><option>PEDIDO YA NO REQUIERE TODO</option><option>OTRO</option></select></td>
    <td><select class="pick-treatment" ${editable?'':'disabled'}><option value="AVAILABLE">Producto existe: liberar reserva</option><option value="PHYSICAL">Diferencia física: bloquear saldo</option></select></td>
    <td><input class="pick-notes" placeholder="Opcional" value="${escapeHtml(x.observations||'')}" ${editable?'':'disabled'}></td>
  </tr>`).join('') || '<tr><td colspan="12" class="empty">Sin líneas.</td></tr>';

  $('#picklistDetailBody').querySelectorAll('tr[data-line-id]').forEach(tr=>{
    const input=tr.querySelector('.pick-confirmed');
    input?.addEventListener('input',()=>syncPickingRow(tr));
    syncPickingRow(tr);
  });

  $('#takePicklist').classList.toggle('hidden',!['GENERADA','DISPONIBLE','CON_INCIDENCIA'].includes(header?.status));
  $('#fillCompletePicking').classList.toggle('hidden',!editable);
  $('#confirmPicking').classList.toggle('hidden',!editable);
  const lock=$('#pickingLockInfo');
  if(header?.status==='EN_SURTIDO'){
    lock.classList.remove('hidden');
    lock.textContent=`En surtido por ${header.taken_by_name||'usuario'} desde ${header.taken_at?new Date(header.taken_at).toLocaleString():'hora no disponible'}.`;
  } else if(finished){
    lock.classList.remove('hidden');
    lock.textContent=`Surtido cerrado: ${header.status}. Confirmado por ${header.completed_by_name||'usuario'}.`;
  } else lock.classList.add('hidden');

  $('#picklistDetailPanel').classList.remove('hidden');
  $('#picklistDetailPanel').scrollIntoView({behavior:'smooth',block:'start'});
}

async function takeCurrentPicklist() {
  if(!currentPicklistId)return;
  const {data,error}=await db.rpc('take_wms_picklist',{p_picklist_id:currentPicklistId,p_operator_name:currentOperatorName()});
  if(error)return alert('No se pudo tomar la picklist.\n\n'+error.message);
  await refreshOrdersPicklists();
  await openPicklistDetail(currentPicklistId);
}

function fillCompletePicking() {
  document.querySelectorAll('#picklistDetailBody tr[data-line-id]').forEach(tr=>{
    const input=tr.querySelector('.pick-confirmed');
    if(input&&!input.disabled){input.value=tr.dataset.reserved;syncPickingRow(tr);}
  });
}

async function confirmCurrentPicking() {
  if(!currentPicklistId)return;
  const lines=[];
  let invalid='';
  document.querySelectorAll('#picklistDetailBody tr[data-line-id]').forEach(tr=>{
    const reserved=Number(tr.dataset.reserved||0);
    const confirmed=Math.trunc(Number(tr.querySelector('.pick-confirmed')?.value||0));
    const diff=reserved-confirmed;
    const incident=tr.querySelector('.pick-incident')?.value||'';
    const treatment=tr.querySelector('.pick-treatment')?.value||'AVAILABLE';
    if((confirmed<0||confirmed>reserved)&&!invalid)invalid='Hay una cantidad surtida inválida.';
    if(diff>0&&!incident&&!invalid)invalid='Toda diferencia requiere un motivo.';
    lines.push({
      picklist_line_id:tr.dataset.lineId,
      confirmed_pieces:confirmed,
      incident_type:diff>0?incident:null,
      physical_difference:diff>0&&treatment==='PHYSICAL',
      observations:diff>0?(tr.querySelector('.pick-notes')?.value||''):null
    });
  });
  if(invalid)return alert(invalid);
  const total=lines.reduce((a,x)=>a+x.confirmed_pieces,0);
  if(!confirm(`Se descontarán ${total.toLocaleString()} piezas del inventario. Esta acción no se puede editar. ¿Confirmar surtido?`))return;
  const btn=$('#confirmPicking');btn.disabled=true;const old=btn.textContent;btn.textContent='Confirmando…';
  try{
    const {data,error}=await db.rpc('confirm_wms_picking',{p_picklist_id:currentPicklistId,p_operator_name:currentOperatorName(),p_lines:lines});
    if(error)throw error;
    await refreshOperationalData();
    alert(`Surtido confirmado.\nFolio: ${data.folio}\nConfirmado: ${Number(data.confirmed_pieces).toLocaleString()} piezas\nDiferencia: ${Number(data.difference_pieces).toLocaleString()} piezas\nEstatus: ${data.status}`);
    await openPicklistDetail(currentPicklistId);
  }catch(err){console.error(err);alert('No se pudo confirmar el surtido.\n\n'+err.message);}
  finally{btn.disabled=false;btn.textContent=old;}
}

function printCurrentPicklist() {
  if(!currentPicklistDetail.length) return;
  const header=picklistRows.find(p=>String(p.picklist_id)===String(currentPicklistId));
  const rows=currentPicklistDetail.map((x,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(x.location)}</td><td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.lot)}</td><td>${escapeHtml(x.expiration_date)}</td><td>${Number(x.reserved_pieces||0).toLocaleString()}</td></tr>`).join('');
  const w=window.open('','_blank','width=1100,height=800');
  if(!w) return alert('Permite ventanas emergentes para imprimir.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(header?.folio||'Picklist')}</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#111}h1{margin:0 0 5px}p{margin:4px 0 18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#eee}.sign{display:grid;grid-template-columns:1fr 1fr;gap:80px;margin-top:60px}.sign div{border-top:1px solid #333;text-align:center;padding-top:6px}</style></head><body><h1>WMS Acatlán · Picklist ${escapeHtml(header?.folio||'')}</h1><p>Pedido: <b>${escapeHtml(header?.delivery_reference||'')}</b> · OV: ${escapeHtml(header?.sales_order||'')} · Cliente: ${escapeHtml(header?.customer_name||'')}</p><table><thead><tr><th>#</th><th>Ubicación</th><th>SKU</th><th>Producto</th><th>Lote</th><th>Caducidad</th><th>Piezas</th></tr></thead><tbody>${rows}</tbody></table><div class="sign"><div>Surtidor</div><div>Supervisor</div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}


// Evento delegado permanente para botones de picklist.
// Funciona aunque la tabla se vuelva a dibujar después de actualizar datos.
document.addEventListener('click', async (event) => {
  const button = event.target.closest('.pick-detail');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const picklistId = button.dataset.id;
  if (!picklistId) {
    alert('No se encontró el identificador de la picklist.');
    return;
  }
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Abriendo…';
  try {
    await openPicklistDetail(picklistId);
  } catch (error) {
    console.error('Error al abrir picklist:', error);
    alert('No se pudo abrir la picklist.\n\n' + (error?.message || error));
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});


async function refreshShipments() {
  const pendingBody=$('#shipmentsPendingBody');
  const historyBody=$('#shipmentsHistoryBody');
  if(!pendingBody || !historyBody) return;
  try {
    const {data,error}=await db.from('shipments_wms_view').select('*')
      .order('picked_at',{ascending:false,nullsFirst:false});
    if(error) throw error;
    shipmentRows=data||[];
    renderShipments();
  } catch(err) {
    console.warn('Embarques aún no disponibles:',err.message);
    pendingBody.innerHTML=`<tr><td colspan="7" class="empty">Ejecuta el parche SQL de Embarques. ${escapeHtml(err.message)}</td></tr>`;
  }
}

function shipmentPalletText(row) {
  const full=Number(row.full_pallets||0);
  const rests=Number(row.remainders||0);
  const positions=Number(row.pallet_positions||0);
  return `<b>${full}</b> completas${rests>0?` + <b>${rests}</b> resto(s)`:''}<small class="pick-user">${positions} posiciones</small>`;
}

function formatDurationMinutes(value) {
  if(value===null || value===undefined || Number.isNaN(Number(value))) return '—';
  const total=Math.max(0,Math.round(Number(value)));
  const hours=Math.floor(total/60);
  const minutes=total%60;
  return hours>0?`${hours} h ${minutes} min`:`${minutes} min`;
}

function renderShipments() {
  const pending=shipmentRows.filter(x=>x.shipping_state==='PENDIENTE');
  const history=shipmentRows.filter(x=>x.shipping_state==='EMBARCADA');
  const today=localDateISO();

  const pendingBody=$('#shipmentsPendingBody');
  pendingBody.innerHTML=pending.map(x=>`<tr>
    <td><b>${escapeHtml(x.picklist_folio)}</b><small class="pick-user">${escapeHtml(x.picking_status)}</small></td>
    <td>${escapeHtml(x.delivery_reference)}<small class="pick-user">${escapeHtml(x.sales_order||'')}</small></td>
    <td>${escapeHtml(x.customer_name)}</td>
    <td>${x.picked_at?new Date(x.picked_at).toLocaleString():'—'}<small class="pick-user">${escapeHtml(x.picked_by_name||'')}</small></td>
    <td>${shipmentPalletText(x)}</td>
    <td>${Number(x.confirmed_pieces||0).toLocaleString()}</td>
    <td><button class="mini primary open-shipment" data-id="${escapeHtml(x.picklist_id)}">Confirmar salida</button></td>
  </tr>`).join('') || '<tr><td colspan="7" class="empty">No hay picklists pendientes de embarcar.</td></tr>';

  const historyBody=$('#shipmentsHistoryBody');
  historyBody.innerHTML=history.map(x=>`<tr>
    <td>${x.shipment_confirmed_at?new Date(x.shipment_confirmed_at).toLocaleString():'—'}<small class="pick-user">${escapeHtml(x.operator_name||'')}</small></td>
    <td><b>${escapeHtml(x.picklist_folio)}</b></td>
    <td>${escapeHtml(x.delivery_reference)}</td>
    <td>${escapeHtml(x.customer_name)}</td>
    <td>${Number(x.confirmed_pieces||0).toLocaleString()}</td>
    <td>${shipmentPalletText(x)}</td>
    <td>${escapeHtml(x.driver_name||'—')}<small class="pick-user">${escapeHtml(x.vehicle_plates||'Sin placas')}</small></td>
    <td>${formatDurationMinutes(x.minutes_pick_to_ship)}</td>
  </tr>`).join('') || '<tr><td colspan="8" class="empty">Sin embarques confirmados.</td></tr>';

  const pendingPieces=pending.reduce((a,x)=>a+Number(x.confirmed_pieces||0),0);
  const pendingPositions=pending.reduce((a,x)=>a+Number(x.pallet_positions||0),0);
  const todayCount=history.filter(x=>String(x.shipment_confirmed_at||'').slice(0,10)===today).length;
  const elPending=$('#shipmentPendingCount');
  const elToday=$('#shipmentTodayCount');
  const elPieces=$('#shipmentPiecesPending');
  const elPositions=$('#shipmentPositionsPending');
  if(elPending) elPending.textContent=pending.length.toLocaleString();
  if(elToday) elToday.textContent=todayCount.toLocaleString();
  if(elPieces) elPieces.textContent=pendingPieces.toLocaleString();
  if(elPositions) elPositions.textContent=pendingPositions.toLocaleString();
}

function openShipmentForm(picklistId) {
  const row=shipmentRows.find(x=>String(x.picklist_id)===String(picklistId));
  if(!row) return alert('No se encontró la picklist para embarcar.');
  if(row.shipping_state!=='PENDIENTE') return alert('Esta picklist ya fue embarcada.');
  currentShipmentPicklistId=picklistId;
  $('#shipmentFormTitle').textContent=`Confirmar embarque · ${row.picklist_folio}`;
  $('#shipmentFormSubtitle').textContent=`Pedido ${row.delivery_reference} · ${row.customer_name} · ${Number(row.confirmed_pieces||0).toLocaleString()} piezas · ${Number(row.pallet_positions||0)} posiciones`;
  $('#shipmentOperator').value=currentOperatorName();
  $('#shipmentDriver').value='';
  $('#shipmentPlates').value='';
  $('#shipmentNotes').value='';
  $('#shipmentDatePreview').value=new Date().toLocaleString();
  $('#shipmentFormPanel').classList.remove('hidden');
  $('#shipmentFormPanel').scrollIntoView({behavior:'smooth',block:'start'});
}

async function confirmCurrentShipment() {
  if(!currentShipmentPicklistId) return;
  const operator=$('#shipmentOperator').value.trim();
  if(!operator) return alert('Captura el responsable de embarque.');
  const row=shipmentRows.find(x=>String(x.picklist_id)===String(currentShipmentPicklistId));
  const message=`Se confirmará la salida física de ${row?.picklist_folio||'la picklist'}.\n\nPiezas: ${Number(row?.confirmed_pieces||0).toLocaleString()}\nPosiciones: ${Number(row?.pallet_positions||0)}\n\nEsta acción no vuelve a descontar inventario. ¿Continuar?`;
  if(!confirm(message)) return;

  const btn=$('#confirmShipment');
  const old=btn.textContent;
  btn.disabled=true;
  btn.textContent='Confirmando…';
  try {
    const {data,error}=await db.rpc('confirm_wms_shipment',{
      p_picklist_id:currentShipmentPicklistId,
      p_operator_name:operator,
      p_driver_name:$('#shipmentDriver').value.trim()||null,
      p_vehicle_plates:$('#shipmentPlates').value.trim()||null,
      p_observations:$('#shipmentNotes').value.trim()||null
    });
    if(error) throw error;
    $('#shipmentFormPanel').classList.add('hidden');
    currentShipmentPicklistId=null;
    await refreshShipments();
    alert(`Embarque confirmado.\nPicklist: ${data.folio}\nEstatus: ${data.shipment_status}\nResponsable: ${data.operator_name}`);
  } catch(err) {
    console.error(err);
    alert('No se pudo confirmar el embarque.\n\n'+err.message);
  } finally {
    btn.disabled=false;
    btn.textContent=old;
  }
}

document.addEventListener('click',(event)=>{
  const button=event.target.closest('.open-shipment');
  if(!button) return;
  openShipmentForm(button.dataset.id);
});

$('#refreshShipments')?.addEventListener('click',refreshShipments);
$('#closeShipmentForm')?.addEventListener('click',()=>{
  $('#shipmentFormPanel')?.classList.add('hidden');
  currentShipmentPicklistId=null;
});
$('#confirmShipment')?.addEventListener('click',confirmCurrentShipment);


$('#previewOrdersExcel')?.addEventListener('click',previewOrdersExcel);
$('#importOrdersExcel')?.addEventListener('click',importOrdersExcel);
$('#refreshOrders')?.addEventListener('click',refreshOrdersPicklists);
$('#refreshPicklists')?.addEventListener('click',refreshOrdersPicklists);
$('#closePicklistDetail')?.addEventListener('click',()=>$('#picklistDetailPanel')?.classList.add('hidden'));
$('#printPicklist')?.addEventListener('click',printCurrentPicklist);
$('#takePicklist')?.addEventListener('click',takeCurrentPicklist);
$('#fillCompletePicking')?.addEventListener('click',fillCompletePicking);
$('#confirmPicking')?.addEventListener('click',confirmCurrentPicking);

