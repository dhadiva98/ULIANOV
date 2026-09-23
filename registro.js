// ===========================================================================
//  REGISTRAR SERVICIO
//
//  Debe completarse en pocos segundos. La tarifa aparece DESPUÉS de elegir
//  masaje y tiempo, siempre etiquetada como referencia, con el precio a
//  cobrar editable justo debajo.
// ===========================================================================
import { estado, hoy, horaAhora, hora12, sumarMinutos, monto, numero,
         escapar, mensajeError, vibrar, esAdmin, pagoPrevisto,
         precioBasePago, pctDeModalidad } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, autocompletar } from './ui.js';
import * as D from './datos.js';

const MOTIVOS = ['Cliente frecuente', 'Promoción', 'Cortesía', 'Campaña',
                 'Compensación', 'Descuento especial', 'Otro'];

// ---------------------------------------------------------------------------
//  Atajo de reserva: tres campos y un botón. Debe hacerse en segundos.
// ---------------------------------------------------------------------------
export function reservaRapida(fecha, alGuardar) {
  const cuerpo = abrirHoja('Reserva rápida', `
    <div id="rr-cliente"></div>
    <label class="campo"><span>Hora</span>
      <input type="time" id="rr-hora" value="${horaAhora()}"></label>
    <div id="rr-masajista"></div>
    <label class="campo"><span>Fecha</span>
      <input type="date" id="rr-fecha" value="${fecha}"></label>
    <p class="ayuda">Con un nombre, una hora o una terapeuta ya se puede guardar.
       El resto se completa cuando llegue el momento.</p>
    <button class="btn btn--principal btn--bloque" id="rr-guardar"
            style="margin-top:14px">Guardar reserva</button>`);

  let cliente = null, masajista = null;

  const bCliente = autocompletar({
    contenedor: cuerpo.querySelector('#rr-cliente'),
    etiqueta: 'Nombre o apodo',
    buscar: D.buscarClientes,
    pintar: c => ({ titulo: c.nombre || 'Sin nombre',
                    nota: c.visitas ? `${c.visitas} ${c.visitas === 1 ? 'visita' : 'visitas'}` : 'Nuevo' }),
    alElegir: c => cliente = c,
    permitirCrear: (t) => ({ id: null, nombre: t, __texto: true }),
    textoCrear: 'Anotar como'
  });

  autocompletar({
    contenedor: cuerpo.querySelector('#rr-masajista'),
    etiqueta: 'Terapeuta',
    buscar: D.buscarMasajistas,
    pintar: m => ({ titulo: m.display }),
    alElegir: m => masajista = m
  });

  cuerpo.querySelector('#rr-guardar').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const c = bCliente.valor();
    try {
      await D.guardarRegistro({
        estado: 'reserva',
        fecha: cuerpo.querySelector('#rr-fecha').value,
        hora_ingreso: cuerpo.querySelector('#rr-hora').value || null,
        cliente_id: c && !c.__texto ? c.id : null,
        cliente_texto: c && c.__texto ? c.nombre : (c ? null : bCliente.texto() || null)
      }, masajista ? [masajista.id] : []);
      avisar('Reserva guardada', 'exito');
      cerrarHoja(); alGuardar?.();
    } catch (ex) { avisar(mensajeError(ex), 'error'); btn.disabled = false; }
  };
}

// ---------------------------------------------------------------------------
//  Formulario completo. Sirve para crear y para completar una reserva.
// ---------------------------------------------------------------------------
export async function formularioServicio(reg, fecha, alGuardar) {
  const editando = !!reg;
  const cuerpo = abrirHoja(editando ? 'Completar atención' : 'Registrar servicio', `
    <!-- El cliente va PRIMERO: es lo primero que se pregunta en el mostrador.
         Antes estaba escondido dentro del desplegable y no se encontraba. -->
    <div id="f-cliente"></div>

    <div id="f-masaje"></div>
    <div id="f-combinaciones"></div>
    <div id="f-tarifa"></div>

    <div class="fila">
      <label class="campo"><span>Día</span>
        <input type="date" id="f-fecha" value="${reg?.fecha || fecha}"></label>
      <label class="campo"><span>Hora de ingreso</span>
        <input type="time" id="f-hora" value="${reg?.hora_ingreso?.slice(0,5) || horaAhora()}"></label>
    </div>
    <p class="ayuda" id="f-termina" style="margin:-10px 0 18px"></p>

    <!-- Cuántas masajistas atienden lo decide el TARIFARIO, no quien registra.
         Antes había una casilla que cualquiera podía desmarcar; ahora los
         campos salen solos según el servicio elegido. -->
    <div id="f-masajistas"></div>

    <div id="f-pago"></div>

    <details style="margin:8px 0 18px">
      <summary style="padding:12px 0;font-weight:600;cursor:pointer">Motivo del descuento y notas</summary>
      <div style="padding-top:12px">
        <label class="campo"><span>Motivo del descuento</span>
          <select id="f-motivo"><option value="">Sin motivo</option>
            ${MOTIVOS.map(m => `<option>${m}</option>`).join('')}</select></label>
        <label class="campo oculto" id="f-motivo-otro-caja"><span>¿Cuál?</span>
          <input type="text" id="f-motivo-otro"></label>
        <label class="campo"><span>Nota interna</span>
          <textarea id="f-notas" placeholder="Solo la ven ustedes.">${escapar(reg?.notas || '')}</textarea></label>
      </div>
    </details>

    <p class="error" id="f-error" hidden></p>
    <div class="barra-acciones" style="margin:0">
      <button class="btn btn--neutro" id="f-reserva" style="flex:1">Guardar como reserva</button>
      <button class="btn btn--principal" id="f-atendido" style="flex:1.3">Guardar atención</button>
    </div>
    ${editando && reg.estado === 'reserva'
      ? '<button class="btn btn--peligro btn--bloque" id="f-borrar" style="margin-top:12px">Borrar esta reserva</button>'
      : ''}`);

  // --- Estado del formulario ---
  let servicio  = reg?.servicio || null;
  let masaje    = servicio?.masaje || null;
  let masajistas = (reg?.masajistas || []).map(m => ({
    id: m.masajista_id, display: m.masajista?.nombre
      ? `${m.masajista.nombre} ${m.masajista.apellido || ''}`.trim()
      : m.masajista_nombre_snapshot
  })).filter(m => m.id);
  // Una reserva rápida con un nombre nuevo lo guarda en cliente_texto: todavía
  // no existe una ficha. Si aquí solo se mirara reg.cliente, ese nombre
  // desaparecería al abrir la reserva para completarla, y habría que volver a
  // preguntárselo a la persona que ya está en la camilla.
  let cliente   = reg?.cliente
                || (reg?.cliente_texto ? { id: null, nombre: reg.cliente_texto, __texto: true } : null);
  let todos     = [];

  const el = s => cuerpo.querySelector(s);

  // === 1. Masaje (autocompletado) ==========================================
  autocompletar({
    contenedor: el('#f-masaje'),
    etiqueta: 'Masaje', requerido: true,
    valorInicial: masaje ? { masaje } : null,
    buscar: async t => {
      const r = await D.buscarServicios(t);
      const vistos = new Set();
      return r.filter(s => !vistos.has(s.masaje) && vistos.add(s.masaje))
              .map(s => ({ masaje: s.masaje }));
    },
    pintar: m => ({ titulo: m.masaje }),
    alElegir: async m => {
      const nuevoMasaje = m?.masaje || null;
      // OJO: el autocompletado llama a alElegir también al pintar el valor
      // inicial. Si aquí se borrara el servicio siempre, al abrir un registro
      // para corregir solo la hora se perdería la modalidad y el tiempo ya
      // elegidos. Solo se limpia cuando el masaje CAMBIA de verdad.
      if (nuevoMasaje !== masaje) servicio = null;
      masaje = nuevoMasaje;
      await pintarCombinaciones();
      pintarTarifa();
    }
  });

  // === 2. Modalidad y tiempo (selección progresiva) ========================
  // Solo se muestran las combinaciones QUE EXISTEN. Nada de opciones
  // deshabilitadas ni celdas vacías.
  async function pintarCombinaciones() {
    const caja = el('#f-combinaciones');
    if (!masaje) { caja.innerHTML = ''; return; }

    if (!todos.length) todos = await D.servicios(true);
    const propios = todos.filter(s => s.masaje === masaje);
    if (!propios.length) { caja.innerHTML = '<p class="ayuda">Este masaje no tiene precios cargados.</p>'; return; }

    const porModalidad = {};
    propios.forEach(s => (porModalidad[s.modalidad] ||= []).push(s));

    caja.innerHTML = `<p class="eyebrow" style="margin-bottom:10px">Modalidad y tiempo</p>` +
      Object.entries(porModalidad).map(([mod, lista]) => `
        <div class="grupo-modalidad">
          <span>${escapar(mod)}${lista[0].terapeutas_requeridas > 1 ? ' · 2 srtas' : ''}</span>
          <div class="duraciones">
            ${lista.sort((a,b) => a.duracion - b.duracion).map(s => `
              <button type="button" class="duracion${servicio?.id === s.id ? ' elegida' : ''}"
                      data-id="${s.id}">
                <strong>${s.duracion}'</strong><small>${monto(s.precio_referencial)}</small>
              </button>`).join('')}
          </div>
        </div>`).join('');

    caja.querySelectorAll('.duracion').forEach(b => b.onclick = () => {
      servicio = propios.find(s => s.id === b.dataset.id);
      caja.querySelectorAll('.duracion').forEach(x => x.classList.toggle('elegida', x === b));
      vibrar(10);
      pintarTarifa();
      pintarMasajistas();   // el servicio manda cuántas srtas hacen falta
    });
  }

  // === 3. Tarifa referencial y precio a cobrar ============================
  function pintarTarifa() {
    const caja = el('#f-tarifa');
    if (!servicio) { caja.innerHTML = ''; actualizarTermina(); return; }
    const ref = numero(servicio.precio_referencial);
    const actual = el('#f-cobrado')?.value;

    caja.innerHTML = `
      <div class="tarifa">
        <div class="tarifa__linea"><span>Tarifa referencial</span><span>${monto(ref)}</span></div>
        <div class="tarifa__linea tarifa__linea--desc oculto" id="f-linea-desc">
          <span id="f-desc-etq">Descuento</span><span id="f-desc-val"></span></div>
        <div class="tarifa__linea tarifa__linea--total"><span>Precio cobrado</span>
          <span id="f-cobrado-eco">${monto(ref)}</span></div>
      </div>
      <label class="campo campo--monto"><span>Precio a cobrar</span>
        <input type="number" id="f-cobrado" inputmode="decimal" step="0.5" min="0"
               value="${actual ?? (reg?.precio_cobrado ?? ref)}"></label>
      <p class="ayuda" style="margin:-10px 0 18px">La tarifa es solo una referencia. Puedes cobrar más o menos.</p>`;

    el('#f-cobrado').addEventListener('input', calcular);
    calcular();
    actualizarTermina();
  }

  // descuento = referencial − cobrado (si es menor)
  // ajuste    = cobrado − referencial (si es mayor)
  // Cobrar por encima NUNCA bloquea el registro.
  function calcular() {
    if (!servicio) return;
    const ref = numero(servicio.precio_referencial);
    const cob = numero(el('#f-cobrado').value);
    const desc = Math.max(0, ref - cob), aju = Math.max(0, cob - ref);
    const linea = el('#f-linea-desc');

    el('#f-cobrado-eco').textContent = monto(cob);
    if (desc > 0)      { linea.classList.remove('oculto'); el('#f-desc-etq').textContent = 'Descuento';
                         el('#f-desc-val').textContent = '−' + monto(desc); }
    else if (aju > 0)  { linea.classList.remove('oculto'); el('#f-desc-etq').textContent = 'Ajuste';
                         el('#f-desc-val').textContent = '+' + monto(aju); }
    else                 linea.classList.add('oculto');

    pintarPago();
  }

  function actualizarTermina() {
    const h = el('#f-hora').value;
    el('#f-termina').textContent = (servicio && h)
      ? `Ingreso ${hora12(h)} · ${servicio.duracion}' → termina ~${hora12(sumarMinutos(h, servicio.duracion))}`
      : '';
  }
  el('#f-hora').addEventListener('input', actualizarTermina);

  // === 4. Masajistas ======================================================
  //
  //  Cuántas atienden lo decide el TARIFARIO (terapeutas_requeridas), y cómo
  //  se reparte el pago también (pago_reparto). Quien registra no puede
  //  cambiarlo: solo la administración, y desde Servicios.
  //
  //  Si el servicio pide dos y solo se alcanza a anotar una, se guarda igual
  //  —no se bloquea el cobro con el cliente delante— pero queda avisado en
  //  pantalla y esa masajista cobra solo su mitad.
  // ------------------------------------------------------------------------
  let cfgPagos = { porcentaje: 40, apoyo: 25 };
  let modalidades = [];
  D.configPagos().then(c => { cfgPagos = c; pintarPagos(); });
  D.listasCatalogo().then(l => { modalidades = l.modalidades || []; pintarPagos(); })
                    .catch(() => {});

  let firma = null;              // para repintar solo cuando de verdad cambia
  let extraCampos = 0;           // huecos que la administradora pidió a mano
  const buscadores = [];

  function pintarMasajistas() {
    const caja = el('#f-masajistas');
    const req  = Number(servicio?.terapeutas_requeridas) || 1;
    const rep  = servicio?.pago_reparto || 'porcentaje_dividido';
    const apoyo = rep === 'principal_apoyo';

    // Nunca se quitan campos que ya tienen a alguien elegida, ni los huecos
    // que la administradora abrió a mano.
    const puestas = masajistas.filter(Boolean).length;
    const n = Math.max(req, puestas + extraCampos, 1);

    const nuevaFirma = `${n}|${apoyo}`;
    if (nuevaFirma === firma) { pintarPagos(); return; }
    firma = nuevaFirma;

    caja.innerHTML = '';
    buscadores.length = 0;

    for (let i = 0; i < n; i++) {
      const etiqueta = !apoyo
        ? (n === 1 ? 'Masajista' : `Masajista ${i + 1}`)
        : (i === 0 ? 'Masajista principal' : 'Señorita de apoyo');

      const fila = document.createElement('div');
      const hueco = document.createElement('div');
      fila.append(hueco);
      caja.append(fila);

      const pie = document.createElement('p');
      pie.className = 'ayuda';
      pie.style.cssText = 'margin:-10px 0 14px';
      pie.dataset.pago = String(i);
      caja.append(pie);

      buscadores.push(autocompletar({
        contenedor: hueco,
        etiqueta,
        requerido: i < req,   // si el servicio pide dos, la segunda no es opcional
        valorInicial: masajistas[i] || null,
        buscar: D.buscarMasajistas,
        pintar: m => ({ titulo: m.display }),
        alElegir: m => { masajistas[i] = m || undefined; pintarPagos(); }
      }));
    }

    // Salida de emergencia, solo para la administradora: un caso raro en que
    // de verdad entró una tercera. Recepción no la ve.
    if (esAdmin()) {
      const mas = document.createElement('button');
      mas.type = 'button'; mas.className = 'enlace';
      mas.textContent = '+ Agregar otra masajista';
      mas.onclick = () => { extraCampos++; firma = null; pintarMasajistas(); };
      caja.append(mas);
    }

    pintarPagos();
  }

  // Debajo de cada masajista, lo que va a cobrar. Solo la administración:
  // recepción registra sin ver montos de pago, igual que no ve la Caja.
  function pintarPagos() {
    const caja = el('#f-masajistas');
    if (!caja) return;
    const req = Number(servicio?.terapeutas_requeridas) || 1;
    const rep = servicio?.pago_reparto || 'porcentaje_dividido';

    caja.querySelectorAll('[data-pago]').forEach(pie => {
      const i = Number(pie.dataset.pago);
      const falta = i < req && !masajistas[i];

      if (falta) {
        pie.style.color = 'var(--rojo)';
        pie.textContent =
          i === 0                   ? 'Falta elegir a la masajista.'
        : rep === 'principal_apoyo' ? 'Falta la señorita de apoyo. Se puede guardar igual, '
                                    + 'pero entonces nadie cobrará ese monto.'
        :                             'Falta la segunda. Se puede guardar igual, pero la '
                                    + 'primera cobrará solo su parte.';
        return;
      }
      pie.style.color = '';
      if (!esAdmin() || !servicio || !masajistas[i]) { pie.textContent = ''; return; }

      // En holístico el pago sale del precio del Egypcio de esa duración,
      // no del masaje que se hizo. Se dice de dónde salió para que el número
      // no parezca un error cuando no coincide con lo que paga el cliente.
      const base = precioBasePago(servicio, todos, modalidades);
      if (base.falta) {
        pie.style.color = 'var(--rojo)';
        pie.textContent = `Falta cargar el precio de ${base.origen} en Servicios. `
                        + 'Sin él no se puede calcular su pago.';
        return;
      }
      const pct = pctDeModalidad(servicio.modalidad, modalidades, cfgPagos.porcentaje);
      const m = pagoPrevisto(base.precio, req, rep, i + 1,
                             { porcentaje: pct, apoyo: cfgPagos.apoyo });
      pie.textContent = m == null ? ''
        : `Cobra ${monto(m)}` + (base.origen ? ` · ${pct}% de ${base.origen}` : '');
    });
  }

  pintarMasajistas();

  // === 5. Forma de pago, dinero recibido y vuelto =========================
  function pintarPago() {
    const caja = el('#f-pago');
    const forma = el('#f-forma')?.value ?? reg?.forma_pago ?? '';
    const recibido = el('#f-recibido')?.value ?? reg?.dinero_recibido ?? '';
    const via = el('#f-vuelto-via')?.value ?? reg?.vuelto_metodo ?? 'efectivo';
    const cobrado = numero(el('#f-cobrado')?.value);

    caja.innerHTML = `
      <label class="campo"><span>Forma de pago</span>
        <select id="f-forma">
          <option value="">Todavía no se registró</option>
          <option value="efectivo" ${forma === 'efectivo' ? 'selected' : ''}>Efectivo</option>
          <option value="tarjeta"  ${forma === 'tarjeta'  ? 'selected' : ''}>Tarjeta</option>
          <option value="yape"     ${forma === 'yape'     ? 'selected' : ''}>Yape</option>
        </select></label>
      ${forma === 'efectivo' ? `
        <label class="campo campo--monto"><span>¿Cuánto entregó el cliente?</span>
          <input type="number" id="f-recibido" inputmode="decimal" step="0.5" min="0" value="${recibido}"></label>
        <div class="tarifa" id="f-vuelto-caja"></div>
        <label class="campo"><span>El vuelto se entrega por</span>
          <select id="f-vuelto-via">
            <option value="efectivo" ${via === 'efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="yape"     ${via === 'yape'     ? 'selected' : ''}>Yape</option>
          </select></label>
        <p class="ayuda" style="margin:-10px 0 18px">Si devuelves por Yape, la venta sigue contando como efectivo.</p>
      ` : ''}`;

    el('#f-forma').onchange = pintarPago;
    if (forma === 'efectivo') {
      const rec = el('#f-recibido');
      const dibujarVuelto = () => {
        const r = numero(rec.value);
        const v = r - cobrado;
        el('#f-vuelto-caja').innerHTML = r === 0 ? '<div class="tarifa__linea"><span>Vuelto</span><span>—</span></div>'
          : v < 0
            ? `<div class="tarifa__linea tarifa__linea--desc"><span>Falta</span><span>${monto(-v)}</span></div>`
            : `<div class="tarifa__linea"><span>Vuelto</span><span>${monto(v)}</span></div>`;
      };
      rec.addEventListener('input', dibujarVuelto);
      dibujarVuelto();
    }
  }
  pintarPago();

  // === 6. Cliente (el campo va arriba del todo) y motivo ==================
  autocompletar({
    contenedor: el('#f-cliente'), etiqueta: 'Cliente', valorInicial: cliente,
    buscar: D.buscarClientes,
    pintar: c => ({ titulo: (c.vip ? '★ ' : '') + (c.nombre || 'Sin nombre'),
                    nota: c.visitas ? `${c.visitas} visitas` : 'Nuevo' }),
    alElegir: c => cliente = c,
    permitirCrear: crearClienteConAviso,
    textoCrear: 'Crear cliente'
  });

  el('#f-motivo').onchange = e =>
    el('#f-motivo-otro-caja').classList.toggle('oculto', e.target.value !== 'Otro');
  if (reg?.motivo_descuento) el('#f-motivo').value = reg.motivo_descuento;

  // === 7. Guardar ==========================================================
  // El ORDEN importa: la primera es la principal, y en Sorpresa es quien
  // cobra el porcentaje. Por eso se recorre por posición y se descartan los
  // huecos al final, sin reordenar lo que ya eligió la persona.
  const listaMasajistas = () =>
    buscadores.map(b => b.valor()).filter(Boolean).map(m => m.id)
      .filter((id, i, a) => a.indexOf(id) === i);

  function datos(estadoDestino) {
    const c = cliente;
    return {
      estado: estadoDestino,
      // La fecha sale del campo, no del día que se está mirando: así se puede
      // mover un registro a otro día sin tener que borrarlo y rehacerlo.
      fecha: el('#f-fecha').value || fecha,
      hora_ingreso: el('#f-hora').value || null,
      servicio_id: servicio?.id || null,
      precio_referencial: servicio ? servicio.precio_referencial : null,
      precio_cobrado: el('#f-cobrado') ? numero(el('#f-cobrado').value) : null,
      cliente_id: c && !c.__texto ? c.id : null,
      cliente_texto: c && c.__texto ? c.nombre : null,
      motivo_descuento: el('#f-motivo').value || null,
      motivo_descuento_texto: el('#f-motivo').value === 'Otro' ? el('#f-motivo-otro').value : null,
      forma_pago: el('#f-forma').value || null,
      dinero_recibido: el('#f-recibido') ? (numero(el('#f-recibido').value) || null) : null,
      vuelto_metodo: el('#f-vuelto-via')?.value || null,
      notas: el('#f-notas').value || null
    };
  }

  async function guardar(destino) {
    const err = el('#f-error');
    err.hidden = true;
    const ms = listaMasajistas();

    if (destino === 'atendido') {
      // Aquí sí se exigen los datos mínimos, con mensajes en lenguaje humano.
      if (!servicio)   return fallo('Falta elegir el masaje y el tiempo.');
      if (!ms.length)  return fallo('Falta elegir la masajista.');
      const cob = numero(el('#f-cobrado').value);
      if (!(cob >= 0)) return fallo('Escribe cuánto se cobró.');
      const forma = el('#f-forma').value;
      if (forma === 'efectivo' && el('#f-recibido').value &&
          numero(el('#f-recibido').value) < cob)
        return fallo('El monto recibido es insuficiente.');

      // Aviso de cruce de horarios: advierte, no bloquea.
      if (el('#f-hora').value && ms.length) {
        try {
          const choques = await D.avisoSolapamiento(ms, el('#f-fecha').value || fecha, el('#f-hora').value,
                                                    servicio.duracion, reg?.id || null);
          if (choques?.length) {
            const c = choques[0];
            const seguir = await confirmar({
              titulo: 'Horarios cruzados',
              texto: `${c.masajista} ya tiene un masaje de ${hora12(c.desde?.slice(0,5))} a ${hora12(c.hasta?.slice(0,5))}. ¿Lo registro igual?`,
              aceptar: 'Registrar igual'
            });
            if (!seguir) return;
          }
        } catch (_) {}
      }
    }

    const btn = destino === 'atendido' ? el('#f-atendido') : el('#f-reserva');
    btn.disabled = true;
    try {
      await D.guardarRegistro(datos(destino), ms, reg?.id || null);
      avisar(destino === 'atendido' ? 'Masaje guardado' : 'Reserva guardada', 'exito');
      cerrarHoja();
      alGuardar?.();
    } catch (ex) { fallo(mensajeError(ex)); btn.disabled = false; }
  }

  function fallo(msg) {
    const err = el('#f-error');
    err.textContent = msg; err.hidden = false;
    err.scrollIntoView({ block: 'center', behavior: 'smooth' });
    vibrar([12, 60, 12]);
  }

  el('#f-reserva').onclick  = () => guardar('reserva');
  el('#f-atendido').onclick = () => guardar('atendido');

  // Una reserva no contiene dinero ni afecta ningún cuadre: sí puede borrarse
  // de verdad. Una atención, nunca.
  const borrar = el('#f-borrar');
  if (borrar) borrar.onclick = async () => {
    const ok = await confirmar({
      titulo: 'Borrar reserva', peligro: true, aceptar: 'Borrar',
      texto: 'Se quita de la agenda. No es una venta, así que no afecta la caja.'
    });
    if (!ok) return;
    try {
      await D.borrarRegistro(reg.id);
      avisar('Reserva borrada', 'exito');
      cerrarHoja(); alGuardar?.();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };

  await pintarCombinaciones();
  if (servicio) pintarTarifa();
}

// ---------------------------------------------------------------------------
//  Crear cliente con aviso de posible duplicado.
//  No bloquea la creación, pero obliga a pasar por la advertencia.
// ---------------------------------------------------------------------------
export async function crearClienteConAviso(texto, parecidos = []) {
  const casi = (parecidos || []).find(c => c.puntaje > 1.4);
  if (casi) {
    const esEse = await confirmar({
      titulo: '¿Es este cliente?',
      texto: `Ya existe ${casi.nombre}${casi.visitas ? ` con ${casi.visitas} visitas` : ''}. ¿Te refieres a esa persona?`,
      aceptar: 'Sí, es este cliente'
    });
    if (esEse) return casi;
  }
  try {
    const nuevo = await D.crearCliente({ nombre: texto });
    avisar('Cliente creado', 'exito');
    return nuevo;
  } catch (ex) { avisar(mensajeError(ex), 'error'); return null; }
}
