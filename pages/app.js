// Registro de clientes y cotizaciones de concreto · página de captura
// Habla con Supabase solo a través de funciones SQL (RPC); nunca toca tablas.
'use strict';

// ===== Etiquetas =====
const PROFESIONES = {
  ingeniero: 'Ingeniero', arquitecto: 'Arquitecto', contratista: 'Contratista',
  particular: 'Particular', otro: 'Otro',
};
const ETAPAS = {
  planeacion: 'Planeación', cimentacion: 'Cimentación', estructura: 'Estructura',
  acabados: 'Acabados', terminada: 'Terminada',
};
const TIPOS_SEGUIMIENTO = { llamada: 'Llamada', visita: 'Visita', whatsapp: 'WhatsApp', correo: 'Correo' };
const ESTATUS = {
  compra_total: 'Compró todo', compra_parcial: 'Compra parcial',
  no_compro: 'No compró', pendiente: 'Pendiente',
};
const TIPOS_CONCRETO = [
  "f'c 100", "f'c 150", "f'c 200", "f'c 250", "f'c 300", "f'c 350",
  "f'c 200 bombeable", "f'c 250 bombeable", "f'c 300 bombeable", 'Mortero', 'Relleno fluido',
];

// ===== Estado =====
const sesion = { codigo: leerLocal('codigo'), quien: leerLocal('quien') };
let catalogos = { motivos: [], empresas: [], capturistas: [] };
let ultimaBusqueda = '';

const $ = (sel) => document.querySelector(sel);
const vista = $('#vista');

// ===== Utilidades =====
function leerLocal(clave) {
  try { return localStorage.getItem('rc_' + clave) || ''; } catch { return ''; }
}
function guardarLocal(clave, valor) {
  try {
    if (valor) localStorage.setItem('rc_' + clave, valor);
    else localStorage.removeItem('rc_' + clave);
  } catch { /* navegador sin almacenamiento: se pedirá el código otra vez */ }
}
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const fmtNum = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const fmtDinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const num = (v) => fmtNum.format(Number(v || 0));
const dinero = (v) => fmtDinero.format(Number(v || 0));
function fecha(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function telefono(t) {
  if (!t) return '';
  return t.length === 10 ? `${t.slice(0, 2)} ${t.slice(2, 6)} ${t.slice(6)}` : t;
}
function avisar(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => { el.hidden = true; }, 2800);
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ===== Llamadas a Supabase =====
async function rpc(funcion, params = {}) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;
  let resp;
  try {
    resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcion}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        // Las claves "anon" antiguas son JWT y van también como Bearer; las nuevas "publishable" no
        ...(SUPABASE_ANON_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_codigo: sesion.codigo, ...params }),
    });
  } catch {
    throw new Error('No hay conexión con la base de datos. Revisa tu internet.');
  }
  const texto = await resp.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!resp.ok) {
    const mensaje = (datos && datos.message) || 'Ocurrió un error al guardar';
    if (mensaje === 'Código de acceso incorrecto') {
      salir();
      throw new Error('El código de acceso cambió. Vuelve a entrar.');
    }
    throw new Error(mensaje);
  }
  return datos;
}

// ===== Acceso =====
function mostrarAcceso() {
  $('#app').hidden = true;
  $('#pantalla-acceso').hidden = false;
  const f = $('#form-acceso');
  f.quien.value = sesion.quien;
  (sesion.quien ? f.codigo : f.quien).focus();
}

$('#form-acceso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button');
  const error = $('#error-acceso');
  error.hidden = true;
  btn.disabled = true;
  try {
    sesion.codigo = f.codigo.value.trim();
    sesion.quien = f.quien.value.trim();
    const valido = await rpc('validar_codigo');
    if (!valido) throw new Error('Código de acceso incorrecto');
    guardarLocal('codigo', sesion.codigo);
    guardarLocal('quien', sesion.quien);
    f.codigo.value = '';
    await entrar();
  } catch (err) {
    sesion.codigo = '';
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

async function entrar() {
  catalogos = await rpc('catalogos');
  $('#pantalla-acceso').hidden = true;
  $('#app').hidden = false;
  $('#quien-captura').textContent = `Capturando como ${sesion.quien}`;
  router();
}

function salir() {
  sesion.codigo = '';
  guardarLocal('codigo', '');
  mostrarAcceso();
}
$('#btn-salir').addEventListener('click', salir);

// ===== Navegación =====
function router() {
  if (!sesion.codigo) return mostrarAcceso();
  const m = location.hash.match(/^#\/cliente\/(\d+)/);
  if (m) vistaCliente(Number(m[1]));
  else vistaBuscar();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);

// ===== Vista: buscar clientes =====
function vistaBuscar() {
  vista.onclick = null;
  vista.innerHTML = `
    <section class="tarjeta pila">
      <div class="encabezado">
        <h1>Clientes</h1>
        <button class="btn primario" id="btn-nuevo-cliente" type="button">+ Nuevo cliente</button>
      </div>
      <div class="buscador">
        <input id="buscar" type="search" placeholder="Buscar por nombre, teléfono, empresa u obra"
               value="${esc(ultimaBusqueda)}" autocomplete="off">
      </div>
    </section>
    <section class="resultados" id="resultados"><p class="vacio">Cargando…</p></section>`;

  $('#btn-nuevo-cliente').addEventListener('click', () => formCliente());
  const input = $('#buscar');
  input.addEventListener('input', debounce(() => buscar(input.value), 300));
  input.focus();
  buscar(ultimaBusqueda);
}

async function buscar(texto) {
  ultimaBusqueda = texto;
  const cont = $('#resultados');
  try {
    const clientes = await rpc('buscar', { p_texto: texto || null });
    if (ultimaBusqueda !== texto || !document.body.contains(cont)) return; // llegó una búsqueda más nueva
    if (!clientes.length) {
      cont.innerHTML = `<p class="vacio">${texto ? 'Sin resultados. Revisa la búsqueda o registra un cliente nuevo.' : 'Todavía no hay clientes registrados.'}</p>`;
      return;
    }
    cont.innerHTML = clientes.map((c) => `
      <a class="resultado" href="#/cliente/${c.id}">
        <strong>${esc(c.nombre)}</strong>
        <div class="linea">
          <span>${esc(PROFESIONES[c.profesion] || c.profesion)}</span>
          ${c.empresa ? `<span>${esc(c.empresa)}</span>` : ''}
          ${c.telefono ? `<span>${esc(telefono(c.telefono))}</span>` : ''}
          <span>${c.obras} obra(s) · ${c.cotizaciones} cotización(es)</span>
          ${c.ultima_cotizacion ? `<span>Última: ${fecha(c.ultima_cotizacion)}</span>` : ''}
        </div>
      </a>`).join('');
  } catch (err) {
    cont.innerHTML = `<p class="vacio error">${esc(err.message)}</p>`;
  }
}

// ===== Vista: ficha del cliente =====
async function vistaCliente(id) {
  vista.innerHTML = '<p class="vacio">Cargando…</p>';
  let datos;
  try {
    datos = await rpc('ver_cliente', { p_cliente_id: id });
    if (location.hash !== `#/cliente/${id}`) return; // el usuario ya se fue a otra pantalla
  } catch (err) {
    if (location.hash !== `#/cliente/${id}`) return;
    vista.innerHTML = `<p class="vacio error">${esc(err.message)}</p><p class="vacio"><a href="#/">Volver a clientes</a></p>`;
    return;
  }
  const { cliente: c, obras } = datos;

  vista.innerHTML = `
    <p><a href="#/">← Clientes</a></p>
    <section class="tarjeta">
      <div class="encabezado">
        <div>
          <h1>${esc(c.nombre)}</h1>
          <span class="sutil">${esc(PROFESIONES[c.profesion] || c.profesion)}${c.empresa ? ' · ' + esc(c.empresa) : ''}</span>
        </div>
        <div class="botones">
          <button class="btn" data-accion="editar-cliente" type="button">Editar</button>
          <button class="btn peligro" data-accion="eliminar-cliente" type="button">Eliminar</button>
        </div>
      </div>
      <dl class="datos">
        <div><dt>Teléfono</dt><dd>${esc(telefono(c.telefono)) || '—'}</dd></div>
        <div><dt>Correo</dt><dd>${esc(c.correo) || '—'}</dd></div>
        <div><dt>Registrado por</dt><dd>${esc(c.capturado_por) || '—'}</dd></div>
        <div><dt>Última modificación</dt><dd>${fecha(c.actualizado_en)}</dd></div>
      </dl>
    </section>

    <section class="pila">
      <div class="encabezado">
        <h2>Obras</h2>
        <button class="btn primario" data-accion="nueva-obra" type="button">+ Nueva obra</button>
      </div>
      ${obras.length ? obras.map(htmlObra).join('') : '<p class="vacio tarjeta">Este cliente todavía no tiene obras. Agrega una para registrar cotizaciones.</p>'}
    </section>`;

  // Un solo manejador para todos los botones de la ficha
  vista.onclick = (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    const obra = obras.find((o) => o.id === Number(btn.dataset.obra));
    const cot = obra && obra.cotizaciones.find((q) => q.id === Number(btn.dataset.cot));
    const acciones = {
      'editar-cliente': () => formCliente(c),
      'eliminar-cliente': () => eliminar('cliente', c.id, `al cliente "${c.nombre}"`, '#/'),
      'nueva-obra': () => formObra(c.id),
      'editar-obra': () => formObra(c.id, obra),
      'eliminar-obra': () => eliminar('obra', obra.id, `la obra "${obra.nombre}"`),
      'nueva-cotizacion': () => formCotizacion(obra),
      'editar-cotizacion': () => formCotizacion(obra, cot),
      'eliminar-cotizacion': () => eliminar('cotizacion', cot.id, `la cotización del ${fecha(cot.fecha)}`),
      venta: () => formVenta(cot),
      perdida: () => formPerdida(cot),
      reabrir: () => reabrir(cot),
      seguimiento: () => formSeguimiento(cot),
      'eliminar-venta': () => eliminar('venta', Number(btn.dataset.id), 'esta compra'),
      'eliminar-seguimiento': () => eliminar('seguimiento', Number(btn.dataset.id), 'este seguimiento'),
    };
    acciones[btn.dataset.accion]?.();
  };
}

function htmlObra(o) {
  const ubicacion = [o.direccion, o.municipio, o.estado].filter(Boolean).join(', ');
  return `
    <article class="tarjeta pila">
      <div class="encabezado">
        <div>
          <h3>${esc(o.nombre)}</h3>
          <span class="sutil">
            ${esc(ubicacion) || 'Sin dirección'}${o.etapa ? ' · ' + esc(ETAPAS[o.etapa]) : ''}
            ${o.ubicacion_url ? ` · <a href="${esc(o.ubicacion_url)}" target="_blank" rel="noopener">Ver mapa</a>` : ''}
          </span>
        </div>
        <div class="botones">
          <button class="btn chico primario" data-accion="nueva-cotizacion" data-obra="${o.id}" type="button">+ Cotización</button>
          <button class="btn chico" data-accion="editar-obra" data-obra="${o.id}" type="button">Editar</button>
          <button class="btn chico peligro" data-accion="eliminar-obra" data-obra="${o.id}" type="button">Eliminar</button>
        </div>
      </div>
      ${o.cotizaciones.length
        ? o.cotizaciones.map((q) => htmlCotizacion(o, q)).join('')
        : '<p class="sutil">Sin cotizaciones todavía.</p>'}
    </article>`;
}

function htmlCotizacion(o, q) {
  const pct = Math.min(100, (Number(q.m3_comprados) / Number(q.m3_solicitados)) * 100);
  const d = `data-obra="${o.id}" data-cot="${q.id}"`;
  const vencido = q.proximo_contacto && q.proximo_contacto < hoy() && q.estatus !== 'compra_total';
  return `
    <div class="tarjeta anidada">
      <div class="encabezado">
        <div>
          <strong>${fecha(q.fecha)} · ${esc(q.tipo_concreto)}</strong>
          <div class="sutil">${num(q.m3_solicitados)} m³ × ${dinero(q.precio_m3)} = ${dinero(q.monto_cotizado)}</div>
        </div>
        <span class="estatus ${q.estatus}">${ESTATUS[q.estatus]}</span>
      </div>
      <div class="avance" title="${num(q.m3_comprados)} de ${num(q.m3_solicitados)} m³"><span style="width:${pct}%"></span></div>
      <div class="sutil">Comprado: ${num(q.m3_comprados)} de ${num(q.m3_solicitados)} m³ · ${dinero(q.monto_vendido)}</div>
      ${q.estatus === 'no_compro'
        ? `<p><strong>Motivo:</strong> ${esc(q.motivo_perdida)}${q.comentario_perdida ? ' — ' + esc(q.comentario_perdida) : ''}</p>` : ''}
      ${q.proximo_contacto && q.estatus !== 'compra_total'
        ? `<p class="${vencido ? 'error' : 'sutil'}">Próximo contacto: ${fecha(q.proximo_contacto)}${vencido ? ' (vencido)' : ''}</p>` : ''}

      ${q.ventas.length ? `
        <ul class="lista-mini">
          ${q.ventas.map((v) => `
            <li><span>Compra ${fecha(v.fecha)}: ${num(v.m3_comprados)} m³ × ${dinero(v.precio_real_m3)} = ${dinero(v.total)}</span>
              <button class="x" data-accion="eliminar-venta" data-id="${v.id}" ${d} type="button" title="Eliminar compra">quitar</button></li>`).join('')}
        </ul>` : ''}
      ${q.seguimientos.length ? `
        <ul class="lista-mini">
          ${q.seguimientos.map((s) => `
            <li><span>${fecha(s.fecha_contacto)} · ${esc(TIPOS_SEGUIMIENTO[s.tipo])}${s.comentario ? ': ' + esc(s.comentario) : ''}
              <span class="sutil">(${esc(s.capturado_por || '')})</span></span>
              <button class="x" data-accion="eliminar-seguimiento" data-id="${s.id}" ${d} type="button" title="Eliminar seguimiento">quitar</button></li>`).join('')}
        </ul>` : ''}

      <div class="botones" style="margin-top:10px">
        ${q.estatus !== 'compra_total' ? `<button class="btn chico primario" data-accion="venta" ${d} type="button">Registrar compra</button>` : ''}
        ${q.estatus === 'pendiente' ? `<button class="btn chico" data-accion="perdida" ${d} type="button">No compró</button>` : ''}
        ${q.estatus === 'no_compro' ? `<button class="btn chico" data-accion="reabrir" ${d} type="button">Reabrir</button>` : ''}
        <button class="btn chico" data-accion="seguimiento" ${d} type="button">+ Seguimiento</button>
        <button class="btn chico" data-accion="editar-cotizacion" ${d} type="button">Editar</button>
        <button class="btn chico peligro" data-accion="eliminar-cotizacion" ${d} type="button">Eliminar</button>
      </div>
    </div>`;
}

// ===== Formulario genérico =====
// campos: [{ nombre, etiqueta, tipo, valor, requerido, opciones, sugerencias, ancho, min, paso }]
function abrirFormulario({ titulo, campos, alGuardar }) {
  const dlg = $('#dialogo');
  $('#dialogo-titulo').textContent = titulo;
  $('#dialogo-error').hidden = true;
  $('#dialogo-campos').innerHTML = campos.map((c) => {
    const req = c.requerido ? 'required' : '';
    const etiqueta = `${esc(c.etiqueta)}${c.requerido ? ' *' : ''}`;
    let control;
    if (c.tipo === 'select') {
      control = `<select name="${c.nombre}" ${req}>
        <option value="">Selecciona…</option>
        ${Object.entries(c.opciones).map(([v, t]) =>
          `<option value="${esc(v)}" ${String(c.valor ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>`;
    } else if (c.tipo === 'textarea') {
      control = `<textarea name="${c.nombre}" maxlength="2000" ${req}>${esc(c.valor)}</textarea>`;
    } else {
      const lista = c.sugerencias ? `list="sug-${c.nombre}"` : '';
      control = `<input name="${c.nombre}" type="${c.tipo || 'text'}" value="${esc(c.valor)}" ${req} ${lista}
        ${c.min != null ? `min="${c.min}"` : ''} ${c.paso ? `step="${c.paso}"` : ''} ${c.max ? `max="${c.max}"` : ''}
        ${c.tipo === 'text' || !c.tipo ? 'maxlength="200"' : ''}>
        ${c.sugerencias ? `<datalist id="sug-${c.nombre}">${c.sugerencias.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>` : ''}`;
    }
    return `<label class="${c.ancho ? 'ancho' : ''}">${etiqueta}${control}</label>`;
  }).join('');

  const form = $('#form-dialogo');
  const btnGuardar = $('#dialogo-guardar');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const valores = Object.fromEntries(new FormData(form));
    for (const k in valores) valores[k] = valores[k].trim() === '' ? null : valores[k].trim();
    btnGuardar.disabled = true;
    try {
      await alGuardar(valores);
      dlg.close();
    } catch (err) {
      $('#dialogo-error').textContent = err.message;
      $('#dialogo-error').hidden = false;
    } finally {
      btnGuardar.disabled = false;
    }
  };
  $('#dialogo-cancelar').onclick = () => dlg.close();
  dlg.showModal();
  dlg.querySelector('input, select, textarea')?.focus();
}

async function refrescarCatalogos() {
  try { catalogos = await rpc('catalogos'); } catch { /* no es crítico */ }
}

// ===== Formularios =====
function formCliente(c) {
  abrirFormulario({
    titulo: c ? 'Editar cliente' : 'Nuevo cliente',
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre completo', valor: c?.nombre, requerido: true, ancho: true },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'tel', valor: c?.telefono },
      { nombre: 'correo', etiqueta: 'Correo', tipo: 'email', valor: c?.correo },
      { nombre: 'profesion', etiqueta: 'Profesión', tipo: 'select', opciones: PROFESIONES, valor: c?.profesion, requerido: true },
      { nombre: 'empresa', etiqueta: 'Constructora / empresa (si aplica)', valor: c?.empresa, sugerencias: catalogos.empresas },
    ],
    alGuardar: async (v) => {
      const id = await rpc('guardar_cliente', {
        p_id: c?.id ?? null, p_nombre: v.nombre, p_telefono: v.telefono, p_correo: v.correo,
        p_profesion: v.profesion, p_empresa: v.empresa, p_capturado_por: sesion.quien,
      });
      avisar(c ? 'Cliente actualizado' : 'Cliente registrado');
      refrescarCatalogos();
      if (!c) location.hash = `#/cliente/${id}`;
      else router();
    },
  });
}

function formObra(clienteId, o) {
  abrirFormulario({
    titulo: o ? 'Editar obra' : 'Nueva obra',
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre de la obra', valor: o?.nombre, requerido: true, ancho: true },
      { nombre: 'direccion', etiqueta: 'Dirección', valor: o?.direccion, ancho: true },
      { nombre: 'municipio', etiqueta: 'Municipio', valor: o?.municipio },
      { nombre: 'estado', etiqueta: 'Estado', valor: o?.estado },
      { nombre: 'etapa', etiqueta: 'Etapa de la obra', tipo: 'select', opciones: ETAPAS, valor: o?.etapa },
      { nombre: 'ubicacion_url', etiqueta: 'Link de Google Maps', tipo: 'url', valor: o?.ubicacion_url },
    ],
    alGuardar: async (v) => {
      await rpc('guardar_obra', {
        p_id: o?.id ?? null, p_cliente_id: clienteId, p_nombre: v.nombre, p_direccion: v.direccion,
        p_municipio: v.municipio, p_estado: v.estado, p_ubicacion_url: v.ubicacion_url,
        p_etapa: v.etapa, p_capturado_por: sesion.quien,
      });
      avisar(o ? 'Obra actualizada' : 'Obra registrada');
      router();
    },
  });
}

function formCotizacion(obra, q) {
  abrirFormulario({
    titulo: q ? 'Editar cotización' : `Nueva cotización · ${obra.nombre}`,
    campos: [
      { nombre: 'fecha', etiqueta: 'Fecha de cotización', tipo: 'date', valor: q?.fecha ?? hoy(), requerido: true, max: hoy() },
      { nombre: 'tipo_concreto', etiqueta: 'Tipo de concreto', valor: q?.tipo_concreto, requerido: true, sugerencias: TIPOS_CONCRETO },
      { nombre: 'm3', etiqueta: 'm³ solicitados', tipo: 'number', valor: q?.m3_solicitados, requerido: true, min: 0.01, paso: '0.01' },
      { nombre: 'precio', etiqueta: 'Precio por m³ (MXN)', tipo: 'number', valor: q?.precio_m3, requerido: true, min: 0, paso: '0.01' },
    ],
    alGuardar: async (v) => {
      await rpc('guardar_cotizacion', {
        p_id: q?.id ?? null, p_obra_id: obra.id, p_fecha: v.fecha, p_tipo_concreto: v.tipo_concreto,
        p_m3_solicitados: Number(v.m3), p_precio_m3: Number(v.precio), p_capturado_por: sesion.quien,
      });
      avisar(q ? 'Cotización actualizada' : 'Cotización registrada');
      router();
    },
  });
}

function formVenta(q) {
  const restante = Math.max(0, Number(q.m3_solicitados) - Number(q.m3_comprados));
  abrirFormulario({
    titulo: 'Registrar compra',
    campos: [
      { nombre: 'fecha', etiqueta: 'Fecha de compra', tipo: 'date', valor: hoy(), requerido: true, max: hoy() },
      { nombre: 'm3', etiqueta: `m³ comprados (faltan ${num(restante)})`, tipo: 'number', valor: restante || '', requerido: true, min: 0.01, paso: '0.01' },
      { nombre: 'precio', etiqueta: 'Precio real por m³ (MXN)', tipo: 'number', valor: q.precio_m3, requerido: true, min: 0, paso: '0.01', ancho: true },
    ],
    alGuardar: async (v) => {
      await rpc('registrar_venta', {
        p_cotizacion_id: q.id, p_fecha: v.fecha, p_m3_comprados: Number(v.m3),
        p_precio_real_m3: Number(v.precio), p_capturado_por: sesion.quien,
      });
      avisar('Compra registrada');
      router();
    },
  });
}

function formPerdida(q) {
  const motivos = Object.fromEntries(catalogos.motivos.map((m) => [m.id, m.nombre]));
  abrirFormulario({
    titulo: 'El cliente no compró',
    campos: [
      { nombre: 'motivo', etiqueta: '¿Por qué no compró?', tipo: 'select', opciones: motivos, requerido: true, ancho: true },
      { nombre: 'comentario', etiqueta: 'Comentarios', tipo: 'textarea', ancho: true },
    ],
    alGuardar: async (v) => {
      await rpc('marcar_perdida', {
        p_cotizacion_id: q.id, p_perdida: true, p_motivo_id: Number(v.motivo),
        p_comentario: v.comentario, p_capturado_por: sesion.quien,
      });
      avisar('Cotización marcada como perdida');
      router();
    },
  });
}

async function reabrir(q) {
  if (!confirm('¿Reabrir esta cotización? Se quitará el motivo de pérdida.')) return;
  try {
    await rpc('marcar_perdida', {
      p_cotizacion_id: q.id, p_perdida: false, p_motivo_id: null,
      p_comentario: null, p_capturado_por: sesion.quien,
    });
    avisar('Cotización reabierta');
    router();
  } catch (err) { avisar(err.message); }
}

function formSeguimiento(q) {
  abrirFormulario({
    titulo: 'Nuevo seguimiento',
    campos: [
      { nombre: 'fecha', etiqueta: 'Fecha de contacto', tipo: 'date', valor: hoy(), requerido: true, max: hoy() },
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', opciones: TIPOS_SEGUIMIENTO, requerido: true },
      { nombre: 'comentario', etiqueta: 'Comentarios', tipo: 'textarea', ancho: true },
      { nombre: 'proximo', etiqueta: 'Próximo contacto', tipo: 'date', ancho: true },
    ],
    alGuardar: async (v) => {
      await rpc('registrar_seguimiento', {
        p_cotizacion_id: q.id, p_fecha_contacto: v.fecha, p_tipo: v.tipo,
        p_comentario: v.comentario, p_proximo_contacto: v.proximo, p_capturado_por: sesion.quien,
      });
      avisar('Seguimiento registrado');
      router();
    },
  });
}

async function eliminar(tabla, id, descripcion, irA) {
  if (!confirm(`¿Eliminar ${descripcion}? Dejará de aparecer en la página y en el dashboard.`)) return;
  try {
    await rpc('eliminar_registro', { p_tabla: tabla, p_id: id });
    avisar('Eliminado');
    if (irA) location.hash = irA;
    else router();
  } catch (err) { avisar(err.message); }
}

// ===== Inicio =====
if (sesion.codigo) entrar().catch(() => mostrarAcceso());
else mostrarAcceso();
