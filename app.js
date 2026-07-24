import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let products = [];
let locations = [];
let lines = [];
let selected = null;

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
      fetchAllRows('products', 'id,sku,description,base_unit,pieces_per_pallet,shelf_life_days,category,active', 'sku'),
      fetchAllRows('locations', 'id,warehouse,code,rack,position,level,capacity_pallets,status,active', 'code')
    ]);

    products = productRows.filter(p => p.active !== false).map(p => ({
      id: p.id,
      sku: p.sku,
      descripcion: p.description,
      unidad: p.base_unit,
      piezas_por_tarima: Number(p.pieces_per_pallet || 0),
      vida_util_dias: Number(p.shelf_life_days || 245),
      categoria: p.category || ''
    }));

    locations = locationRows.filter(l => l.active !== false).map(l => ({
      id: l.id,
      almacen: l.warehouse,
      ubicacion: l.code,
      rack: l.rack || '',
      posicion: l.position || '',
      nivel: Number(l.level || 0),
      capacidad: Number(l.capacity_pallets || 0),
      estatus: l.status || 'DISPONIBLE'
    }));

    $('#kpiProducts').textContent = products.length.toLocaleString();
    $('#kpiLocations').textContent = locations.length.toLocaleString();
    $('#kpiCapacity').textContent = locations.reduce((a,b) => a + b.capacidad, 0).toLocaleString();
    renderProducts();
    renderLocations();
    $('#recDate').value = new Date().toISOString().slice(0,10);
    setConnectionState(`Supabase conectado · ${products.length} productos · ${locations.length} ubicaciones`, 'ok');
  } catch (err) {
    console.error(err);
    setConnectionState('Sin acceso a Supabase', 'error');
    alert('No se pudieron cargar los catálogos desde Supabase. Revisa que hayas ejecutado las políticas de lectura.\n\n' + err.message);
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
  if (!products.length) {
    box.innerHTML = '<div class="product-no-results">Catálogo aún no disponible</div>';
    box.classList.remove('hidden');
    return;
  }
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
  $('#autoAssign').dataset.locations = '';
  updateCalc();
}

function updateCalc() {
  const pcs = Number($('#pieces').value || 0);
  if (!selected || !pcs) { $('#calc').textContent = 'Selecciona un producto y captura piezas.'; return; }
  const ppt = Number(selected.piezas_por_tarima || 0);
  if (!ppt) { $('#calc').textContent = 'Este producto no tiene piezas por tarima configuradas.'; return; }
  const pallets = Math.floor(pcs / ppt), rest = pcs % ppt, pos = pallets + (rest > 0 ? 1 : 0);
  $('#calc').innerHTML = `<b>${pallets}</b> tarimas completas + <b>${rest}</b> piezas de resto = <b>${pos}</b> posiciones requeridas.`;
}

$('#productSearch').addEventListener('focus', e => renderProductSuggestions(e.target.value));
$('#productSearch').addEventListener('input', e => {
  selected = null;
  delete e.target.dataset.selectedSku;
  $('#autoAssign').dataset.locations = '';
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
    if (idx >= 0 && opts.length) { opts[idx].click(); return; }
    const matches = getProductMatches(e.target.value);
    if (matches.length === 1) { selectProduct(matches[0].sku); return; }
    if (matches.length > 1) { renderProductSuggestions(e.target.value); return; }
  } else if (e.key === 'Escape') { box.classList.add('hidden'); return; }
  else return;
  opts.forEach(x => x.classList.remove('active'));
  opts[idx].classList.add('active');
  opts[idx].scrollIntoView({block:'nearest'});
});

document.addEventListener('click', e => {
  if (!e.target.closest('.product-combobox')) $('#productSuggestions')?.classList.add('hidden');
});

$('#pieces').oninput = updateCalc;

function suggestLocations(pos) {
  // Todavía no hay inventario real. Para recepción nueva usamos ubicaciones DISPONIBLES
  // y priorizamos capacidad exacta, luego niveles altos.
  const exact = locations.filter(l => l.estatus === 'DISPONIBLE' && l.capacidad === pos)
    .sort((a,b) => b.nivel - a.nivel || a.ubicacion.localeCompare(b.ubicacion));
  if (exact.length) return [{...exact[0], assigned: pos}];

  const pool = locations.filter(l => l.estatus === 'DISPONIBLE')
    .sort((a,b) => b.nivel - a.nivel || a.capacidad - b.capacidad || a.ubicacion.localeCompare(b.ubicacion));
  const out = [];
  let left = pos;
  for (const l of pool) {
    if (left <= 0) break;
    const take = Math.min(left, l.capacidad);
    out.push({...l, assigned: take});
    left -= take;
  }
  return left ? [] : out;
}

$('#autoAssign').onclick = () => {
  if (!selected) resolveProductFromInput(true);
  if (!selected) { renderProductSuggestions($('#productSearch').value); return alert('Selecciona un producto de la lista'); }
  updateCalc();
  const pcs = Number($('#pieces').value || 0), ppt = Number(selected.piezas_por_tarima || 0);
  if (!pcs || !ppt) return alert('Captura una cantidad válida');
  const pos = Math.floor(pcs / ppt) + (pcs % ppt ? 1 : 0);
  const s = suggestLocations(pos);
  if (!s.length) return alert('No hay capacidad suficiente');
  $('#autoAssign').dataset.locations = s.map(x => `${x.ubicacion} (${x.assigned})`).join(', ');
  alert('Sugerencia: ' + $('#autoAssign').dataset.locations);
};

$('#addLine').onclick = () => {
  if (!selected) resolveProductFromInput(true);
  const pcs = Number($('#pieces').value || 0);
  const ppt = Number(selected?.piezas_por_tarima || 0);
  const lot = $('#lot').value.trim().toUpperCase();
  const pd = $('#prodDate').value;
  if (!selected) { renderProductSuggestions($('#productSearch').value); return alert('Selecciona un producto de la lista'); }
  updateCalc();
  if (!pcs || !ppt || !lot || !pd) return alert('Completa lote, fecha y piezas');

  const pallets = Math.floor(pcs / ppt), rest = pcs % ppt, pos = pallets + (rest ? 1 : 0);
  const loc = $('#autoAssign').dataset.locations || suggestLocations(pos).map(x => `${x.ubicacion} (${x.assigned})`).join(', ');
  if (!loc) return alert('No hay asignación de ubicación');

  const exp = new Date(pd + 'T12:00:00');
  exp.setDate(exp.getDate() + selected.vida_util_dias);
  lines.push({sku:selected.sku, desc:selected.descripcion, lot, pcs, pallets, rest, pos, exp:exp.toISOString().slice(0,10), loc});
  renderLines();
  $('#lot').value = '';
  $('#pieces').value = '';
  $('#autoAssign').dataset.locations = '';
  updateCalc();
};

function renderLines() {
  $('#receiptLines').innerHTML = lines.map(x => `<tr><td>${escapeHtml(x.sku)}</td><td>${escapeHtml(x.desc)}</td><td>${escapeHtml(x.lot)}</td><td>${x.pcs}</td><td>${x.pallets}</td><td>${x.rest}</td><td>${x.pos}</td><td>${x.exp}</td><td>${escapeHtml(x.loc)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Sin líneas capturadas</td></tr>';
}

$('#confirmReceipt').onclick = () => {
  if (!lines.length) return alert('Agrega al menos una línea');
  alert('Catálogos ya están conectados a Supabase. El guardado real de la recepción será el siguiente paso.');
};
