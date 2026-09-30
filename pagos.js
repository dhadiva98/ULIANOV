// ===========================================================================
//  PAGO A LAS MASAJISTAS — solo administración
//
//  Hasta setiembre de 2026 el pago era diario. Desde el 1 de octubre es
//  semanal: la semana va de domingo a sábado y se paga el sábado. La primera
//  fue corta, del jueves 1 al sábado 3, porque el cambio cayó a mitad de
//  semana.
//
//  Quién decide eso es el servidor, no esta pantalla: se le pasa una fecha
//  cualquiera y él contesta a qué periodo pertenece. Por eso una fecha de
//  setiembre sigue mostrando su día suelto, como siempre.
//
//  ADELANTOS: si a media semana se le entrega algo a cuenta, se anota aquí
//  y el día de pago se descuenta solo.
//
//  El dinero de estos pagos NO sale de la caja del día, así que nada de lo
//  que pasa aquí toca el cuadre de efectivo. Son dos cuentas separadas.
// ===========================================================================
import { hoy, fechaLarga, fechaCorta, monto, numero, escapar,
         mensajeError, vibrar } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, esqueleto, vacio } from './ui.js';
import * as D from './datos.js';

let fecha = null;

// "Semana del 4 al 10 de octubre", o la fecha larga si el periodo es un día.
// Se escribe en palabras y sin repetir el mes cuando es el mismo: es el
// título que se lee todos los días, y con dd/mm/aaaa dos veces era ilegible.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

function diaYMes(iso, conMes = true) {
  const [, m, d] = String(iso).split('-').map(Number);
  return conMes ? `${d} de ${MESES[m - 1]}` : String(d);
}

function tituloPeriodo(p) {
  if (!p || !p.es_semanal) return fechaLarga(p?.desde || fecha);
  const mismoMes = p.desde.slice(0, 7) === p.hasta.slice(0, 7);
  return `Semana del ${diaYMes(p.desde, !mismoMes)} al ${diaYMes(p.hasta)}`;
}

export async function vistaPagos() {
  fecha ||= hoy();
  const v = $('#vista');

  v.innerHTML = `
    <div class="barra-acciones">
      <input type="date" id="pg-fecha" value="${fecha}">
      <button class="btn btn--neutro" id="pg-hoy">Volver a hoy</button>
    </div>
    <div id="pg-atrasos"></div>
    <p class="eyebrow" id="pg-titulo" style="margin:0 0 14px">${escapar(fechaLarga(fecha))}</p>
    <div id="pg-lista">${esqueleto(4)}</div>`;

  $('#pg-fecha').onchange = e => { fecha = e.target.value || hoy(); vistaPagos(); };
  $('#pg-hoy').onclick    = () => { fecha = hoy(); vistaPagos(); };

  avisarAtrasos();
  pintarLista();
}

// ---------------------------------------------------------------------------
//  Semanas anteriores sin cerrar. Va arriba del todo porque es lo único que
//  puede hacer que alguien se quede sin cobrar sin que nadie se entere.
// ---------------------------------------------------------------------------
async function avisarAtrasos() {
  const caja = $('#pg-atrasos');
  if (!caja) return;
  try {
    const atrasos = await D.periodosPendientes();
    if (!atrasos?.length) { caja.innerHTML = ''; return; }

    const total = atrasos.reduce((s, a) => s + numero(a.falta), 0);
    caja.innerHTML = `
      <div class="panel" style="border-color:var(--rojo);margin-bottom:14px">
        <div class="panel__cuerpo">
          <span class="eyebrow" style="display:block;margin-bottom:6px;color:var(--rojo)">
            Quedaron semanas sin cerrar</span>
          <strong>Faltan ${monto(total)} de ${atrasos.length}
            ${atrasos.length === 1 ? 'periodo anterior' : 'periodos anteriores'}</strong>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            ${atrasos.map(a => `<button class="btn btn--neutro" data-ir="${a.hasta}"
                style="padding:8px 14px;min-height:40px">
                ${fechaCorta(a.hasta)} · ${monto(a.falta)}</button>`).join('')}
          </div>
        </div>
      </div>`;
    caja.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => {
      fecha = b.dataset.ir; vistaPagos();
    });
  } catch { caja.innerHTML = ''; }   // sin aviso es mejor que con un error
}

// ---------------------------------------------------------------------------
async function pintarLista() {
  const caja = $('#pg-lista');
  let filas, adelantos = [];
  try {
    [filas, adelantos] = await Promise.all([
      D.pagosDelPeriodo(fecha),
      D.adelantosDelPeriodo(fecha).catch(() => [])
    ]);
  } catch (ex) {
    caja.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`;
    return;
  }

  const p = filas[0];
  const esDiaDePago = p?.es_semanal && p.hasta === fecha;
  const titulo = $('#pg-titulo');
  if (titulo) {
    titulo.innerHTML = escapar(tituloPeriodo(p))
      + (p?.es_semanal
          ? ` · <span style="color:${esDiaDePago ? 'var(--verde)' : 'inherit'}">${
              esDiaDePago ? 'hoy es día de pago' : 'se paga el ' + diaYMes(p.hasta)}</span>`
          : '');
  }

  if (!filas.length) {
    caja.innerHTML = vacio('En ese periodo no hay masajes atendidos, así que no hay nada que pagar.');
    return;
  }

  const vivos      = filas.filter(f => !f.regimen_anterior);
  const total      = vivos.reduce((s, f) => s + numero(f.corresponde), 0);
  const adelantado = vivos.reduce((s, f) => s + numero(f.adelantado), 0);
  // Lo que de verdad salió del bolsillo el día de pago, no lo que correspondía:
  // si un masaje se corrigió después de pagar, las dos cifras no son la misma.
  const entregado  = vivos.reduce((s, f) => s + numero(f.pagado), 0);
  const pendiente  = vivos.filter(f => f.pagado == null)
                          .reduce((s, f) => s + numero(f.falta), 0);

  caja.innerHTML = `
    <div class="rejilla">
      <div class="metrica destacada"><span class="eyebrow">Les toca</span><b>${monto(total)}</b></div>
      ${adelantado > 0 ? `<div class="metrica"><span class="eyebrow">Adelantado</span>
        <b>${monto(adelantado)}</b></div>` : ''}
      <div class="metrica"><span class="eyebrow">Entregado el día de pago</span><b>${monto(entregado)}</b></div>
      <div class="metrica"><span class="eyebrow">Falta entregar</span><b>${monto(pendiente)}</b></div>
    </div>

    <div class="panel">
      <div class="panel__cabecera"><span class="eyebrow">${
        p?.es_semanal ? 'Señoritas de la semana' : 'Señoritas del día'}</span></div>
      <div class="tabla-envoltura"><table>
        <thead><tr><th>Masajista</th><th class="num">Masajes</th><th class="num">Le toca</th>
          ${adelantado > 0 ? '<th class="num">Adelantado</th>' : ''}
          <th class="num">Falta</th><th>Estado</th><th></th></tr></thead>
        <tbody>${filas.map((f, i) => fila(f, i, adelantado > 0)).join('')}</tbody>
      </table></div>
    </div>

    ${adelantos.length ? `
    <div class="panel" style="margin-top:14px">
      <div class="panel__cabecera"><span class="eyebrow">Adelantos de este periodo</span></div>
      <div class="tabla-envoltura"><table>
        <thead><tr><th>Cuándo</th><th>Masajista</th><th class="num">Monto</th>
          <th>Cómo</th><th>Nota</th><th></th></tr></thead>
        <tbody>${adelantos.map(a => `<tr>
          <td>${fechaCorta(a.fecha)}</td>
          <td>${escapar(a.masajista)}</td>
          <td class="num">${monto(a.monto)}</td>
          <td>${escapar(a.forma_pago)}</td>
          <td>${a.notas ? escapar(a.notas) : '<span class="vacio">—</span>'}</td>
          <td class="num"><button class="btn btn--neutro" data-quitar="${a.id}"
                style="padding:8px 13px;min-height:40px">Quitar</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}`;

  caja.querySelectorAll('[data-pagar]').forEach(b => b.onclick = () =>
    hojaPago(filas[Number(b.dataset.pagar)]));
  caja.querySelectorAll('[data-deshacer]').forEach(b => b.onclick = () =>
    deshacer(filas[Number(b.dataset.deshacer)]));
  caja.querySelectorAll('[data-adelanto]').forEach(b => b.onclick = () =>
    hojaAdelanto(filas[Number(b.dataset.adelanto)]));
  caja.querySelectorAll('[data-quitar]').forEach(b => b.onclick = () =>
    quitarAdelanto(adelantos.find(a => String(a.id) === b.dataset.quitar)));
}

// ---------------------------------------------------------------------------
function fila(f, i, hayAdelantos) {
  // Masajes de antes del cambio de régimen: no hay monto que mostrar, porque
  // ese pago se hizo a mano y fuera del sistema.
  if (f.regimen_anterior) return `
    <tr class="cancelado">
      <td>${escapar(f.masajista)}</td>
      <td class="num">${f.servicios}</td>
      <td class="num">—</td>
      ${hayAdelantos ? '<td class="num">—</td>' : ''}
      <td class="num">—</td>
      <td><span class="insignia">Régimen anterior</span></td>
      <td></td>
    </tr>`;

  const dif = f.diferencia == null ? 0 : numero(f.diferencia);
  const pagado = f.pagado != null;
  const falta = numero(f.falta);

  const estado = !pagado
    ? '<span class="insignia insignia--reserva">Pendiente</span>'
    : dif === 0
      ? `<span class="insignia insignia--atendido">Pagado · ${escapar(f.forma_pago)}</span>`
      : `<span class="insignia insignia--descuento">Pagado ${monto(f.pagado)}</span>`;

  // Si el masaje se corrigió después de pagar, se dice con todas sus letras
  // en qué dirección y por cuánto, en vez de dejar un número raro.
  const aviso = (pagado && dif !== 0)
    ? `<div class="ayuda" style="color:var(--rojo);margin-top:4px">
         ${dif > 0
            ? `Faltan ${monto(dif)}: se corrigió un masaje después de pagarle.`
            : `Se le entregó ${monto(-dif)} de más.`}
       </div>`
    // Se le adelantó más de lo que llegó a juntar. No es un error, pero hay
    // que verlo: esa plata se le descuenta de la semana siguiente.
    : (!pagado && falta < 0)
      ? `<div class="ayuda" style="color:var(--ambar);margin-top:4px">
           Se le adelantó ${monto(-falta)} más de lo que juntó.</div>`
      : '';

  return `
    <tr>
      <td>${escapar(f.masajista)}${aviso}</td>
      <td class="num">${f.servicios}</td>
      <td class="num"><strong>${monto(f.corresponde)}</strong></td>
      ${hayAdelantos ? `<td class="num">${
        numero(f.adelantado) > 0 ? '−' + monto(f.adelantado) : '<span class="vacio">—</span>'}</td>` : ''}
      <td class="num">${pagado ? '<span class="vacio">—</span>'
                               : `<strong>${monto(Math.max(falta, 0))}</strong>`}</td>
      <td>${estado}</td>
      <td class="num" style="white-space:nowrap">${pagado
        ? `<button class="btn btn--neutro" data-deshacer="${i}">Deshacer</button>`
        : `<button class="btn btn--neutro" data-adelanto="${i}"
             style="padding:9px 13px;min-height:44px">Adelanto</button>
           <button class="btn btn--principal" data-pagar="${i}">Marcar pagado</button>`}</td>
    </tr>`;
}

// ---------------------------------------------------------------------------
function hojaPago(f) {
  const falta = Math.max(numero(f.falta), 0);
  const ade   = numero(f.adelantado);

  const cuerpo = abrirHoja(`Pagar a ${f.masajista}`, `
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Masajes del periodo</span><span>${f.servicios}</span></div>
      <div class="tarifa__linea"><span>Juntó</span><span>${monto(f.corresponde)}</span></div>
      ${ade > 0 ? `<div class="tarifa__linea tarifa__linea--desc">
        <span>Ya se llevó adelantado</span><span>−${monto(ade)}</span></div>` : ''}
      <div class="tarifa__linea tarifa__linea--total"><span>Se le entrega ahora</span>
        <b style="font-size:20px">${monto(falta)}</b></div>
    </div>

    <label class="campo"><span>¿Cómo se le pagó?</span>
      <select id="pp-forma">
        <option value="efectivo">Efectivo</option>
        <option value="yape">Yape</option>
      </select></label>

    <label class="campo"><span>Nota (opcional)</span>
      <input type="text" id="pp-nota" placeholder="Por ejemplo: se fue temprano el jueves"></label>

    <p class="ayuda" style="margin:-6px 0 18px">Este dinero no sale de la caja del día,
       así que el cuadre de efectivo no cambia.</p>

    <p class="error" id="pp-error" hidden></p>
    <button class="btn btn--principal btn--bloque" id="pp-ok">
      Confirmar pago de ${monto(falta)}</button>`);

  cuerpo.querySelector('#pp-ok').onclick = async e => {
    const err = cuerpo.querySelector('#pp-error');
    err.hidden = true;
    e.currentTarget.disabled = true;
    try {
      const entregado = await D.marcarPago(
        f.masajista_id,
        cuerpo.querySelector('#pp-forma').value,
        fecha,
        cuerpo.querySelector('#pp-nota').value);
      vibrar(12);
      avisar(`${f.masajista} cobró ${monto(entregado)}`, 'exito');
      cerrarHoja();
      vistaPagos();
    } catch (ex) {
      err.textContent = mensajeError(ex); err.hidden = false;
      e.currentTarget.disabled = false;
    }
  };
}

// ---------------------------------------------------------------------------
function hojaAdelanto(f) {
  const falta = Math.max(numero(f.falta), 0);

  const cuerpo = abrirHoja(`Adelanto a ${f.masajista}`, `
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Lleva juntado</span><span>${monto(f.corresponde)}</span></div>
      ${numero(f.adelantado) > 0 ? `<div class="tarifa__linea">
        <span>Ya adelantado</span><span>${monto(f.adelantado)}</span></div>` : ''}
      <div class="tarifa__linea tarifa__linea--total"><span>Le faltaría cobrar</span>
        <b>${monto(falta)}</b></div>
    </div>

    <label class="campo campo--monto"><span>Cuánto le entregas</span>
      <input type="number" id="pa-monto" inputmode="decimal" step="0.5" min="0"
             placeholder="0.00"></label>

    <label class="campo"><span>¿Cómo se lo entregas?</span>
      <select id="pa-forma">
        <option value="efectivo">Efectivo</option>
        <option value="yape">Yape</option>
      </select></label>

    <label class="campo"><span>Nota (opcional)</span>
      <input type="text" id="pa-nota" placeholder="Por ejemplo: pidió a cuenta"></label>

    <p class="ayuda" style="margin:-6px 0 18px">
      Se anota con la fecha de hoy y se le descuenta solo el día de pago.
      Puedes adelantarle más de lo que lleva juntado; quedará a la vista.</p>

    <p class="error" id="pa-error" hidden></p>
    <button class="btn btn--principal btn--bloque" id="pa-ok">Anotar el adelanto</button>`);

  cuerpo.querySelector('#pa-ok').onclick = async e => {
    const err = cuerpo.querySelector('#pa-error');
    err.hidden = true;
    const m = numero(cuerpo.querySelector('#pa-monto').value);
    if (!(m > 0)) { err.textContent = 'Escribe cuánto le entregas.'; err.hidden = false; return; }
    e.currentTarget.disabled = true;
    try {
      // La fecha del adelanto es HOY, no la del periodo que se esté mirando:
      // es el día en que de verdad salió la plata.
      await D.registrarAdelanto(f.masajista_id, m,
        cuerpo.querySelector('#pa-forma').value, hoy(),
        cuerpo.querySelector('#pa-nota').value);
      vibrar(12);
      avisar(`Adelanto de ${monto(m)} a ${f.masajista}`, 'exito');
      cerrarHoja();
      vistaPagos();
    } catch (ex) {
      err.textContent = mensajeError(ex); err.hidden = false;
      e.currentTarget.disabled = false;
    }
  };
}

// ---------------------------------------------------------------------------
async function quitarAdelanto(a) {
  if (!a) return;
  const ok = await confirmar({
    titulo: 'Quitar el adelanto',
    texto: `Se borrará el adelanto de ${monto(a.monto)} a ${a.masajista}. `
         + 'Úsalo solo si lo anotaste por error: el dinero que ya entregaste no vuelve solo.',
    aceptar: 'Quitar', peligro: true
  });
  if (!ok) return;
  try {
    await D.borrarAdelanto(a.id);
    avisar('Adelanto quitado', 'exito');
    vistaPagos();
  } catch (ex) { avisar(mensajeError(ex), 'error'); }
}

// ---------------------------------------------------------------------------
async function deshacer(f) {
  const ok = await confirmar({
    titulo: 'Deshacer el pago',
    texto: `${f.masajista} volverá a aparecer como pendiente. `
         + 'Úsalo solo si lo marcaste por error. Los adelantos de ese periodo no se tocan.',
    aceptar: 'Deshacer', peligro: true
  });
  if (!ok) return;
  try {
    await D.deshacerPago(f.masajista_id, fecha);
    avisar('Pago deshecho', 'exito');
    vistaPagos();
  } catch (ex) { avisar(mensajeError(ex), 'error'); }
}
