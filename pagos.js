// ===========================================================================
//  PAGO DIARIO A LAS MASAJISTAS — solo administración
//
//  El pago se entrega al cerrar el día, señorita por señorita. Esta pantalla
//  muestra a quién le toca cuánto, y deja marcar quién ya cobró.
//
//  El dinero de estos pagos NO sale de la caja del día, así que nada de lo
//  que pasa aquí toca el cuadre de efectivo. Son dos cuentas separadas.
// ===========================================================================
import { hoy, fechaLarga, monto, escapar, mensajeError, vibrar } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, esqueleto, vacio } from './ui.js';
import * as D from './datos.js';

let fecha = null;

export async function vistaPagos() {
  fecha ||= hoy();
  const v = $('#vista');

  v.innerHTML = `
    <div class="barra-acciones">
      <input type="date" id="pg-fecha" value="${fecha}">
      <button class="btn btn--neutro" id="pg-hoy">Volver a hoy</button>
    </div>
    <p class="eyebrow" style="margin:0 0 14px">${escapar(fechaLarga(fecha))}</p>
    <div id="pg-lista">${esqueleto(4)}</div>`;

  $('#pg-fecha').onchange = e => { fecha = e.target.value || hoy(); vistaPagos(); };
  $('#pg-hoy').onclick    = () => { fecha = hoy(); vistaPagos(); };

  pintarLista();
}

async function pintarLista() {
  const caja = $('#pg-lista');
  let filas;
  try {
    filas = await D.pagosDelDia(fecha);
  } catch (ex) {
    caja.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`;
    return;
  }

  if (!filas.length) {
    caja.innerHTML = vacio('Ese día no hay masajes atendidos, así que no hay nada que pagar.');
    return;
  }

  const num = x => Number(x) || 0;
  const vivos     = filas.filter(f => !f.regimen_anterior);
  const total     = vivos.reduce((s, f) => s + num(f.corresponde), 0);
  const pendiente = vivos.filter(f => f.pagado == null)
                         .reduce((s, f) => s + num(f.corresponde), 0);
  // Lo que de verdad salió del bolsillo, no lo que correspondía: si un masaje
  // se corrigió después de pagar, las dos cifras no son la misma.
  const entregado = vivos.reduce((s, f) => s + num(f.pagado), 0);

  caja.innerHTML = `
    <div class="rejilla">
      <div class="metrica destacada"><span class="eyebrow">Les toca hoy</span><b>${monto(total)}</b></div>
      <div class="metrica"><span class="eyebrow">Ya entregado</span><b>${monto(entregado)}</b></div>
      <div class="metrica"><span class="eyebrow">Falta entregar</span><b>${monto(pendiente)}</b></div>
    </div>

    <div class="panel">
      <div class="panel__cabecera"><span class="eyebrow">Señoritas del día</span></div>
      <div class="tabla-envoltura"><table>
        <thead><tr><th>Masajista</th><th class="num">Masajes</th><th class="num">Le toca</th>
          <th>Estado</th><th></th></tr></thead>
        <tbody>${filas.map((f, i) => fila(f, i)).join('')}</tbody>
      </table></div>
    </div>`;

  caja.querySelectorAll('[data-pagar]').forEach(b => b.onclick = () =>
    hojaPago(filas[Number(b.dataset.pagar)]));
  caja.querySelectorAll('[data-deshacer]').forEach(b => b.onclick = () =>
    deshacer(filas[Number(b.dataset.deshacer)]));
}

function fila(f, i) {
  // Masajes de antes del cambio de régimen: no hay monto que mostrar, porque
  // ese pago se hizo a mano y fuera del sistema.
  if (f.regimen_anterior) return `
    <tr class="cancelado">
      <td>${escapar(f.masajista)}</td>
      <td class="num">${f.servicios}</td>
      <td class="num">—</td>
      <td><span class="insignia">Régimen anterior</span></td>
      <td></td>
    </tr>`;

  const dif = f.diferencia == null ? 0 : Number(f.diferencia);
  const pagado = f.pagado != null;

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
            : `Se le pagó ${monto(-dif)} de más: se anuló o corrigió un masaje después.`}
       </div>`
    : '';

  return `
    <tr>
      <td>${escapar(f.masajista)}${aviso}</td>
      <td class="num">${f.servicios}</td>
      <td class="num"><strong>${monto(f.corresponde)}</strong></td>
      <td>${estado}</td>
      <td class="num">${pagado
        ? `<button class="btn btn--neutro" data-deshacer="${i}">Deshacer</button>`
        : `<button class="btn btn--principal" data-pagar="${i}">Marcar pagado</button>`}</td>
    </tr>`;
}

function hojaPago(f) {
  const cuerpo = abrirHoja(`Pagar a ${f.masajista}`, `
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Masajes del día</span><span>${f.servicios}</span></div>
      <div class="tarifa__linea"><span>Le corresponde</span>
        <b style="font-size:20px">${monto(f.corresponde)}</b></div>
    </div>

    <label class="campo"><span>¿Cómo se le pagó?</span>
      <select id="pp-forma">
        <option value="efectivo">Efectivo</option>
        <option value="yape">Yape</option>
      </select></label>

    <label class="campo"><span>Nota (opcional)</span>
      <input type="text" id="pp-nota" placeholder="Por ejemplo: se fue temprano"></label>

    <p class="ayuda" style="margin:-6px 0 18px">Este dinero no sale de la caja del día,
       así que el cuadre de efectivo no cambia.</p>

    <p class="error" id="pp-error" hidden></p>
    <button class="btn btn--principal btn--bloque" id="pp-ok">
      Confirmar pago de ${monto(f.corresponde)}</button>`);

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
      pintarLista();
    } catch (ex) {
      err.textContent = mensajeError(ex); err.hidden = false;
      e.currentTarget.disabled = false;
    }
  };
}

async function deshacer(f) {
  const ok = await confirmar({
    titulo: 'Deshacer el pago',
    texto: `${f.masajista} volverá a aparecer como pendiente por ${monto(f.corresponde)}. `
         + 'Úsalo solo si lo marcaste por error.',
    aceptar: 'Deshacer', peligro: true
  });
  if (!ok) return;
  try {
    await D.deshacerPago(f.masajista_id, fecha);
    avisar('Pago deshecho', 'exito');
    pintarLista();
  } catch (ex) { avisar(mensajeError(ex), 'error'); }
}
