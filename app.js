let products=[],locations=[],lines=[],selected=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
async function init(){products=await fetch('data/products.json?v=4',{cache:'no-store'}).then(r=>r.json());locations=await fetch('data/locations.json?v=4',{cache:'no-store'}).then(r=>r.json());$('#kpiProducts').textContent=products.length.toLocaleString();$('#kpiLocations').textContent=locations.length.toLocaleString();$('#kpiCapacity').textContent=locations.reduce((a,b)=>a+b.capacidad,0).toLocaleString();renderProducts();renderLocations();$('#recDate').value=new Date().toISOString().slice(0,10)}
$('#loginBtn').onclick=()=>{if($('#user').value==='supervisor'&&$('#pass').value==='demo'){$('#login').classList.add('hidden');$('#app').classList.remove('hidden');init()}else alert('Usa supervisor / demo')};$('#logout').onclick=()=>location.reload();
$$('nav button').forEach(b=>b.onclick=()=>{$$('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');$$('.view').forEach(v=>v.classList.add('hidden'));$('#'+b.dataset.view).classList.remove('hidden');$('#title').textContent=b.textContent});
function renderProducts(q=''){let a=products.filter(p=>(p.sku+' '+p.descripcion).toLowerCase().includes(q.toLowerCase())).slice(0,250);$('#productsBody').innerHTML=a.map(p=>`<tr><td>${p.sku}</td><td>${p.descripcion}</td><td>${p.unidad||''}</td><td>${p.piezas_por_tarima||'FALTA'}</td><td>${p.vida_util_dias} días</td></tr>`).join('');$('#productCount').textContent=`${a.length} mostrados de ${products.length}`}
function renderLocations(q=''){let a=locations.filter(l=>(l.ubicacion+' '+l.rack).toLowerCase().includes(q.toLowerCase())).slice(0,300);$('#locationsBody').innerHTML=a.map(l=>`<tr><td>${l.ubicacion}</td><td>${l.rack}</td><td>${l.nivel}</td><td>${l.capacidad} tarimas</td><td>${l.estatus}</td></tr>`).join('');$('#locationCount').textContent=`${a.length} mostradas de ${locations.length}`}
$('#productFilter').oninput=e=>renderProducts(e.target.value);$('#locationFilter').oninput=e=>renderLocations(e.target.value);
function productLabel(p){return `${p.sku} — ${p.descripcion}`}
function normalizeText(v){return (v||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function getProductMatches(query=''){
  const q=normalizeText(query);
  if(!q)return products.slice(0,40);
  const terms=q.split(/\s+/).filter(Boolean);
  return products.filter(p=>{
    const hay=normalizeText(`${p.sku} ${p.descripcion}`);
    return terms.every(t=>hay.includes(t));
  }).slice(0,40);
}
function resolveProductFromInput(autoSelectUnique=false){
  const text=$('#productSearch').value.trim();
  if(!text){selected=null;return null}
  const norm=normalizeText(text);
  const exact=products.find(p=>normalizeText(p.sku)===norm||normalizeText(p.descripcion)===norm||normalizeText(productLabel(p))===norm);
  if(exact){selected=exact;return exact}
  if(autoSelectUnique){
    const matches=getProductMatches(text);
    if(matches.length===1){selectProduct(matches[0].sku);return matches[0]}
  }
  return selected;
}
function renderProductSuggestions(query=''){
  const box=$('#productSuggestions');
  if(!products.length){box.innerHTML='<div class="product-no-results">Cargando productos...</div>';box.classList.remove('hidden');return}
  const matches=getProductMatches(query);
  if(!matches.length){box.innerHTML='<div class="product-no-results">Sin coincidencias</div>';box.classList.remove('hidden');return}
  box.innerHTML=matches.map((p,i)=>`<button type="button" class="product-option" data-sku="${p.sku}" role="option" data-index="${i}"><b>${p.sku}</b><span>${p.descripcion}</span></button>`).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.product-option').forEach(btn=>btn.onclick=()=>selectProduct(btn.dataset.sku));
}
function selectProduct(sku){
  const p=products.find(x=>String(x.sku)===String(sku));
  if(!p)return;
  selected=p;
  $('#productSearch').value=productLabel(p);
  $('#productSuggestions').classList.add('hidden');
  $('#productSearch').dataset.selectedSku=p.sku;
  $('#autoAssign').dataset.locations='';
  updateCalc();
}
function updateCalc(){
  let pcs=Number($('#pieces').value||0);
  if(!selected||!pcs){$('#calc').textContent='Selecciona un producto y captura piezas.';return}
  let ppt=Number(selected.piezas_por_tarima||0);
  if(!ppt){$('#calc').textContent='Este producto no tiene piezas por tarima configuradas.';return}
  let pallets=Math.floor(pcs/ppt),rest=pcs%ppt,pos=pallets+(rest>0?1:0);
  $('#calc').innerHTML=`<b>${pallets}</b> tarimas completas + <b>${rest}</b> piezas de resto = <b>${pos}</b> posiciones requeridas.`
}
$('#productSearch').addEventListener('focus',e=>renderProductSuggestions(e.target.value));
$('#productSearch').addEventListener('input',e=>{
  selected=null;
  delete e.target.dataset.selectedSku;
  $('#autoAssign').dataset.locations='';
  renderProductSuggestions(e.target.value);
  $('#calc').textContent='Selecciona un producto y captura piezas.';
});
$('#productSearch').addEventListener('keydown',e=>{
  const box=$('#productSuggestions');
  const opts=[...box.querySelectorAll('.product-option')];
  let idx=opts.findIndex(x=>x.classList.contains('active'));
  if(e.key==='ArrowDown'&&opts.length){
    e.preventDefault(); idx=(idx+1)%opts.length;
  }else if(e.key==='ArrowUp'&&opts.length){
    e.preventDefault(); idx=idx<=0?opts.length-1:idx-1;
  }else if(e.key==='Enter'){
    e.preventDefault();
    if(idx>=0&&opts.length){opts[idx].click();return}
    const matches=getProductMatches(e.target.value);
    if(matches.length===1){selectProduct(matches[0].sku);return}
    if(matches.length>1){renderProductSuggestions(e.target.value);return}
  }else if(e.key==='Escape'){
    box.classList.add('hidden'); return;
  }else return;
  opts.forEach(x=>x.classList.remove('active')); opts[idx].classList.add('active'); opts[idx].scrollIntoView({block:'nearest'});
});
document.addEventListener('click',e=>{if(!e.target.closest('.product-combobox'))$('#productSuggestions')?.classList.add('hidden')});
$('#pieces').oninput=updateCalc;
function suggestLocations(pos){let exact=locations.filter(l=>l.estatus==='DISPONIBLE'&&l.capacidad===pos).sort((a,b)=>b.nivel-a.nivel);if(exact.length)return [{...exact[0],assigned:pos}];let pool=locations.filter(l=>l.estatus==='DISPONIBLE').sort((a,b)=>b.nivel-a.nivel||a.capacidad-b.capacidad),out=[],left=pos;for(let l of pool){if(left<=0)break;let take=Math.min(left,l.capacidad);out.push({...l,assigned:take});left-=take}return left?[]:out}
$('#autoAssign').onclick=()=>{if(!selected)resolveProductFromInput(true);if(!selected){renderProductSuggestions($('#productSearch').value);return alert('Selecciona un producto de la lista');}updateCalc();let pcs=Number($('#pieces').value||0),ppt=Number(selected.piezas_por_tarima||0);if(!pcs||!ppt)return alert('Captura una cantidad válida');let pos=Math.floor(pcs/ppt)+(pcs%ppt?1:0),s=suggestLocations(pos);if(!s.length)return alert('No hay capacidad suficiente');$('#autoAssign').dataset.locations=s.map(x=>`${x.ubicacion} (${x.assigned})`).join(', ');alert('Sugerencia: '+$('#autoAssign').dataset.locations)};
$('#addLine').onclick=()=>{if(!selected)resolveProductFromInput(true);let pcs=Number($('#pieces').value||0),ppt=Number(selected?.piezas_por_tarima||0),lot=$('#lot').value.trim().toUpperCase(),pd=$('#prodDate').value;if(!selected){renderProductSuggestions($('#productSearch').value);return alert('Selecciona un producto de la lista');}updateCalc();if(!pcs||!ppt||!lot||!pd)return alert('Completa lote, fecha y piezas');let pallets=Math.floor(pcs/ppt),rest=pcs%ppt,pos=pallets+(rest?1:0),loc=$('#autoAssign').dataset.locations||suggestLocations(pos).map(x=>`${x.ubicacion} (${x.assigned})`).join(', ');if(!loc)return alert('No hay asignación de ubicación');let exp=new Date(pd+'T12:00:00');exp.setDate(exp.getDate()+selected.vida_util_dias);lines.push({sku:selected.sku,desc:selected.descripcion,lot,pcs,pallets,rest,pos,exp:exp.toISOString().slice(0,10),loc});renderLines();$('#lot').value='';$('#pieces').value='';$('#autoAssign').dataset.locations='';updateCalc()};
function renderLines(){$('#receiptLines').innerHTML=lines.map(x=>`<tr><td>${x.sku}</td><td>${x.desc}</td><td>${x.lot}</td><td>${x.pcs}</td><td>${x.pallets}</td><td>${x.rest}</td><td>${x.pos}</td><td>${x.exp}</td><td>${x.loc}</td></tr>`).join('')||'<tr><td colspan="9" class="empty">Sin líneas capturadas</td></tr>'}
$('#confirmReceipt').onclick=()=>{if(!lines.length)return alert('Agrega al menos una línea');alert('Recepción validada. En la versión con backend se guardará como PENDIENTE DE CALIDAD.');lines=[];renderLines()};
