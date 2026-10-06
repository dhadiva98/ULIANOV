// ===========================================================================
//  EVENTOS — campañas con descuento por fecha
//
//  Un evento es "el 31 de octubre, S/ 10 menos en Fantasía". El sistema lo
//  aplica solo ese día, encima del descuento que ya tenga el cliente por su
//  nivel VIP: los dos se suman.
//
//  Se guarda el DÍA Y EL MES, no el año, así que vuelve cada temporada sin
//  que nadie tenga que acordarse. Para algo de un año concreto (un Black
//  Friday, que cambia de fecha) se le pone el año y ese año nada más.
//
//  Lo que se deja en blanco significa "cualquiera": sin masaje elegido, el
//  evento vale para todo el tarifario.
// ===========================================================================
import { escapar, mensajeError, monto, numero, nombreEvento,
         eventoCubre, hoy } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, esqueleto, vacio } from './ui.js';
import * as D from './datos.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

const DIAS_DEL_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// "31 de octubre" o "del 6 al 23 de diciembre"
function cuando(e) {
  const uno = (d, m) => `${d} de ${MESES[m - 1]}`;
  return (e.desde_dia === e.hasta_dia && e.desde_mes === e.hasta_mes)
    ? uno(e.desde_dia, e.desde_mes)
    : `del ${uno(e.desde_dia, e.desde_mes)} al ${uno(e.hasta_dia, e.hasta_mes)}`;
}

// "en Fantasía", "en los holísticos de 60 min", "en todo el tarifario"
function enQue(e) {
  const p = [];
  if (e.masaje)    p.push(`en ${e.masaje}`);
  if (e.modalidad) p.push(`${e.masaje ? '' : 'en '}${e.modalidad}`);
  if (e.duracion)  p.push(`de ${e.duracion} min`);
  return p.length ? p.join(' ') : 'en todo el tarifario';
}

// ===========================================================================
export async function vistaEventos() {
  const v = $('#vista');
  v.innerHTML = `
    <div class="barra-acciones">
      <button class="btn btn--principal" id="ev-nuevo">+ Nuevo evento</button>
    </div>
    <p class="ayuda" style="margin:-8px 0 16px">
      Un evento rebaja el precio solo en sus fechas, y se suma al descuento
      que el cliente ya tenga por su nivel. Se repite todos los años salvo que
      le pongas un año concreto.</p>
    <div id="ev-lista">${esqueleto(5)}</div>`;

  $('#ev-nuevo').onclick = () => editar({
    nombre: '', icono: '', desde_dia: 1, desde_mes: 1, hasta_dia: 1, hasta_mes: 1,
    anio: null, masaje: null, modalidad: null, duracion: null,
    monto: 10, activo: false
  });

  try {
    const [lista, catalogo] = await Promise.all([
      D.eventos(true),
      D.listasCatalogo().catch(() => ({ masajes: [], modalidades: [], duraciones: [] }))
    ]);
    const hoyISO = hoy();

    $('#ev-lista').innerHTML = lista.length ? `
      <div class="panel"><div class="tabla-envoltura"><table class="a-tarjetas">
        <thead><tr><th>Evento</th><th>Cuándo</th><th>Dónde se aplica</th>
          <th class="num">Descuenta</th><th>Estado</th><th></th></tr></thead>
        <tbody>${lista.map(e => {
          const corriendo = e.activo && eventoCubre(e, hoyISO);
          return `<tr>
            <td class="destacado">${escapar(nombreEvento(e))}</td>
            <td data-etiqueta="Cuándo">${escapar(cuando(e))}${
              e.anio ? `<br><span class="vacio">solo en ${e.anio}</span>` : ''}</td>
            <td data-etiqueta="Dónde">${escapar(enQue(e))}</td>
            <td class="num" data-etiqueta="Descuenta">−${monto(e.monto)}</td>
            <td data-etiqueta="Estado">${
              corriendo ? '<span class="insignia" style="background:var(--superficie-2);color:var(--verde)">🟢 Corriendo hoy</span>'
              : e.activo ? '<span class="insignia" style="background:var(--superficie-2);color:var(--ambar)">Encendido</span>'
              : '<span class="insignia insignia--cancelado">Apagado</span>'}</td>
            <td><button class="btn btn--neutro" data-id="${e.id}"
                  style="padding:9px 15px;min-height:44px">Abrir</button></td>
          </tr>`;
        }).join('')}</tbody></table></div></div>`
      : vacio('Todavía no hay eventos. Con uno nuevo puedes rebajar un masaje solo en ciertas fechas.');

    $('#ev-lista').querySelectorAll('button[data-id]').forEach(b => b.onclick = () =>
      editar(lista.find(x => String(x.id) === b.dataset.id), catalogo));

  } catch (ex) {
    $('#ev-lista').innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`;
  }
}

// ---------------------------------------------------------------------------
async function editar(e, catalogo = null) {
  const cat = catalogo || await D.listasCatalogo()
    .catch(() => ({ masajes: [], modalidades: [], duraciones: [] }));
  const servicios = await D.servicios().catch(() => []);

  const selMes = (id, valor) => `
    <select id="${id}">${MESES.map((m, i) =>
      `<option value="${i + 1}" ${valor == i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>`;

  const anioAhora = Number(hoy().slice(0, 4));

  const cuerpo = abrirHoja(e.id ? 'Evento' : 'Nuevo evento', `
    <div style="display:flex;gap:10px">
      <label class="campo" style="width:92px"><span>Icono</span>
        <input type="text" id="ev-icono" maxlength="4" placeholder="🎃"
               value="${escapar(e.icono || '')}"></label>
      <label class="campo" style="flex:1"><span>Nombre</span>
        <input type="text" id="ev-nombre" placeholder="Halloween"
               value="${escapar(e.nombre || '')}"></label>
    </div>

    <span class="eyebrow" style="display:block;margin:12px 0 8px">Cuándo</span>
    <div style="display:flex;gap:10px;align-items:flex-end">
      <label class="campo" style="width:88px"><span>Desde</span>
        <input type="number" id="ev-dd" min="1" max="31" value="${e.desde_dia}"></label>
      <label class="campo" style="flex:1"><span>&nbsp;</span>${selMes('ev-dm', e.desde_mes)}</label>
    </div>
    <div style="display:flex;gap:10px;align-items:flex-end">
      <label class="campo" style="width:88px"><span>Hasta</span>
        <input type="number" id="ev-hd" min="1" max="31" value="${e.hasta_dia}"></label>
      <label class="campo" style="flex:1"><span>&nbsp;</span>${selMes('ev-hm', e.hasta_mes)}</label>
    </div>
    <label class="campo"><span>¿Qué años?</span>
      <select id="ev-anio">
        <option value="" ${e.anio ? '' : 'selected'}>Todos los años</option>
        ${[anioAhora, anioAhora + 1, anioAhora + 2].map(a =>
          `<option value="${a}" ${e.anio == a ? 'selected' : ''}>Solo ${a}</option>`).join('')}
      </select></label>
    <p class="ayuda" style="margin:-10px 0 18px">
      Para un solo día, pon la misma fecha en los dos. Una temporada puede
      cruzar el Año Nuevo: del 31 de diciembre al 1 de enero es válido.</p>

    <span class="eyebrow" style="display:block;margin:6px 0 8px">Dónde se aplica</span>
    <label class="campo"><span>Masaje</span>
      <select id="ev-masaje"><option value="">Cualquier masaje</option>
        ${(cat.masajes || []).map(m => `<option value="${escapar(m.nombre)}"
          ${e.masaje === m.nombre ? 'selected' : ''}>${escapar(m.nombre)}</option>`).join('')}
      </select></label>
    <label class="campo"><span>Modalidad</span>
      <select id="ev-modalidad"><option value="">Cualquier modalidad</option>
        ${(cat.modalidades || []).map(m => `<option value="${escapar(m.nombre)}"
          ${e.modalidad === m.nombre ? 'selected' : ''}>${escapar(m.nombre)}</option>`).join('')}
      </select></label>
    <label class="campo"><span>Duración</span>
      <select id="ev-duracion"><option value="">Cualquier duración</option>
        ${(cat.duraciones || []).map(d => `<option value="${d.minutos}"
          ${e.duracion == d.minutos ? 'selected' : ''}>${d.minutos} min</option>`).join('')}
      </select></label>

    <label class="campo campo--monto"><span>Cuánto descuenta</span>
      <input type="number" id="ev-monto" step="0.5" min="0" value="${e.monto}"></label>

    <label class="campo" style="flex-direction:row;align-items:center;gap:10px">
      <input type="checkbox" id="ev-activo" ${e.activo ? 'checked' : ''}
             style="width:22px;height:22px">
      <span style="margin:0">Encendido</span></label>
    <p class="ayuda" id="ev-ejemplo" style="margin:4px 0 18px"></p>

    <p class="error" id="ev-error" hidden></p>
    <button class="btn btn--principal btn--bloque" id="ev-ok">Guardar</button>
    ${e.id ? `<button class="btn btn--peligro btn--bloque" id="ev-borrar"
                style="margin-top:10px">Eliminar evento</button>` : ''}`);

  const q = sel => cuerpo.querySelector(sel);
  const err = q('#ev-error');
  const fallo = m => { err.textContent = m; err.hidden = false; };

  // El evento tal como está escrito en este momento.
  const leer = () => ({
    id: e.id,
    nombre:    q('#ev-nombre').value.trim(),
    icono:     q('#ev-icono').value.trim() || null,
    desde_dia: Number(q('#ev-dd').value), desde_mes: Number(q('#ev-dm').value),
    hasta_dia: Number(q('#ev-hd').value), hasta_mes: Number(q('#ev-hm').value),
    anio:      q('#ev-anio').value ? Number(q('#ev-anio').value) : null,
    masaje:    q('#ev-masaje').value    || null,
    modalidad: q('#ev-modalidad').value || null,
    duracion:  q('#ev-duracion').value ? Number(q('#ev-duracion').value) : null,
    monto:     numero(q('#ev-monto').value),
    activo:    q('#ev-activo').checked
  });

  // Un ejemplo con un precio real del tarifario, para no configurar a ciegas.
  const verEjemplo = () => {
    const x = leer();
    const caben = (servicios || []).filter(s =>
      s.activo !== false
      && (!x.masaje    || s.masaje    === x.masaje)
      && (!x.modalidad || s.modalidad === x.modalidad)
      && (!x.duracion  || Number(s.duracion) === x.duracion));

    if (!caben.length) {
      q('#ev-ejemplo').textContent =
        'Con esa combinación no hay ningún masaje en el tarifario, así que este '
        + 'evento no rebajaría nada. Revisa el masaje, la modalidad y la duración.';
      return;
    }
    const s = caben[0];
    const nuevo = Math.max(numero(s.precio_referencial) - x.monto, 0);
    q('#ev-ejemplo').textContent =
      `${x.activo ? 'Encendido' : 'Cuando lo enciendas'}: ${cuando(x)}, un `
      + `${s.masaje} ${s.modalidad} de ${s.duracion}' pasa de `
      + `${monto(s.precio_referencial)} a ${monto(nuevo)}`
      + `${caben.length > 1 ? `, y lo mismo en otros ${caben.length - 1} del tarifario` : ''}. `
      + 'Si el cliente además tiene nivel VIP, los dos descuentos se suman.';
  };
  ['#ev-nombre','#ev-icono','#ev-dd','#ev-dm','#ev-hd','#ev-hm','#ev-anio',
   '#ev-masaje','#ev-modalidad','#ev-duracion','#ev-monto','#ev-activo']
    .forEach(sel => q(sel)?.addEventListener('input', verEjemplo));
  verEjemplo();

  q('#ev-ok').onclick = async () => {
    const x = leer();
    if (!x.nombre)  return fallo('Ponle un nombre al evento.');
    if (!(x.monto > 0)) return fallo('El descuento tiene que ser mayor que cero.');
    // El día 31 de un mes de 30 no existe, y el servidor lo aceptaría sin
    // quejarse: el evento simplemente nunca se activaría.
    if (x.desde_dia > DIAS_DEL_MES[x.desde_mes - 1])
      return fallo(`${MESES[x.desde_mes - 1]} no tiene ${x.desde_dia} días.`);
    if (x.hasta_dia > DIAS_DEL_MES[x.hasta_mes - 1])
      return fallo(`${MESES[x.hasta_mes - 1]} no tiene ${x.hasta_dia} días.`);

    try {
      await D.guardarEvento(x);
      avisar(x.activo ? 'Evento guardado y encendido' : 'Evento guardado, apagado', 'exito');
      cerrarHoja(); vistaEventos();
    } catch (ex) { fallo(mensajeError(ex)); }
  };

  const borrar = q('#ev-borrar');
  if (borrar) borrar.onclick = async () => {
    const ok = await confirmar({
      titulo: 'Eliminar evento', aceptar: 'Eliminar', peligro: true,
      texto: 'Las atenciones que ya se cobraron con este evento no se tocan: '
           + 'guardaron su descuento en el momento. Solo deja de aplicarse de aquí en adelante.'
    });
    if (!ok) return;
    try {
      await D.borrarEvento(e.id);
      avisar('Evento eliminado', 'exito');
      cerrarHoja(); vistaEventos();
    } catch (ex) { fallo(mensajeError(ex)); }
  };
}
