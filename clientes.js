// ===========================================================================
//  CLIENTES — ficha, corrección de nombre, fusión de duplicados
//
//  Los registros se relacionan por cliente_id, nunca por nombre: por eso
//  corregir el nombre actualiza automáticamente todo el historial.
// ===========================================================================
import { esAdmin, fechaCorta, monto, escapar, mensajeError, esperar,
         insigniaNivel, nombreNivel, mesEnPalabras,
         faltanParaMantener, pideParaMantener, nivelSiCierraAsi } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, esqueleto, vacio, autocompletar } from './ui.js';
import * as D from './datos.js';

export async function vistaClientes() {
  const v = $('#vista');
  v.innerHTML = `
    <div class="barra-acciones">
      <input type="search" id="c-buscar" placeholder="Buscar cliente…"
             style="flex:1;min-width:200px;padding:13px 14px;border-radius:10px;font-size:16px;
                    border:1.5px solid var(--borde-fuerte);background:var(--superficie);color:inherit">
      <select id="c-nivel" style="padding:12px 14px;border-radius:10px;font-size:15px;
              border:1.5px solid var(--borde-fuerte);background:var(--superficie);color:inherit">
        <option value="">Todos los niveles</option>
        <option value="black">Solo VIP Black</option>
        <option value="clasico">Solo VIP Clásico</option>
        <option value="ninguno">Sin nivel</option>
        <option value="riesgo">En riesgo este mes</option>
      </select>
      ${esAdmin() ? '<button class="btn btn--neutro" id="c-duplicados">Posibles duplicados</button>' : ''}
    </div>
    <div id="c-lista">${esqueleto(6)}</div>`;

  const pintar = async (texto = '') => {
    const caja = $('#c-lista');
    try {
      const nivelPedido = document.querySelector('#c-nivel')?.value || '';
      const todos = await D.clientes(texto);
      const cfgN = await D.configNiveles().catch(() => undefined);
      // "En riesgo" son los que tienen nivel y este mes todavía no llegaron a
      // las visitas que necesitan para conservarlo. Es la lista para llamar.
      const enRiesgo = c => !c.vip && (c.nivel || 'ninguno') !== 'ninguno'
        && faltanParaMantener(c.nivel, c.visitas_mes, cfgN) > 0;
      const lista = nivelPedido === 'riesgo' ? todos.filter(enRiesgo)
        : nivelPedido ? todos.filter(c => (c.nivel || 'ninguno') === nivelPedido)
        : todos;
      caja.innerHTML = lista.length ? `
        <div class="panel"><div class="tabla-envoltura"><table class="a-tarjetas">
          <thead><tr><th></th><th>Nombre</th>
            <th class="num">Este mes</th><th class="num">Visitas</th>
            <th>Última visita</th></tr></thead>
          <tbody>${lista.map(c => `<tr data-clic data-id="${c.id}">
            <td style="width:74px">${insigniaNivel(c.nivel)}</td>
            <td class="destacado">${escapar(c.nombre || 'Sin nombre')}</td>
            <td class="num" data-etiqueta="Este mes">${c.visitas_mes ?? 0}</td>
            <td class="num" data-etiqueta="Visitas">${c.visitas}</td>
            <td data-etiqueta="Última">${c.ultima_visita ? fechaCorta(c.ultima_visita) : '<span class="vacio">—</span>'}</td>
          </tr>`).join('')}</tbody></table></div></div>`
        : vacio(nivelPedido === 'riesgo'
                ? 'Ningún cliente en riesgo: todos los que tienen nivel ya vinieron las veces que necesitan este mes.'
              : nivelPedido ? `Ningún cliente en ${nombreNivel(nivelPedido).toLowerCase()}.`
              : texto ? 'Ningún cliente con ese nombre.'
              : 'Todavía no hay clientes registrados.');

      caja.querySelectorAll('tr[data-clic]').forEach(tr => tr.onclick = () =>
        ficha(lista.find(c => c.id === tr.dataset.id)));
    } catch (ex) { caja.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
  };

  $('#c-buscar').oninput = esperar(e => pintar(e.target.value.trim()), 250);
  $('#c-nivel').onchange  = () => pintar($('#c-buscar').value.trim());
  const dup = $('#c-duplicados');
  if (dup) dup.onclick = panelDuplicados;
  pintar();
}

// ---------------------------------------------------------------------------
async function ficha(c) {
  const cuerpo = abrirHoja(c.nombre || 'Cliente', `
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Visitas</span><span>${c.visitas}</span></div>
      <div class="tarifa__linea"><span>Última visita</span><span>${c.ultima_visita ? fechaCorta(c.ultima_visita) : '—'}</span></div>
      <div class="tarifa__linea"><span>Visitas este mes</span>
        <span>${c.visitas_mes ?? 0}</span></div>
      <div class="tarifa__linea"><span>Nivel</span>
        <span>${insigniaNivel(c.nivel, { texto: true }) || 'Sin nivel'}</span></div>
      ${c.nivel && c.nivel !== 'ninguno' && c.nivel_confirmado_en ? `
      <div class="tarifa__linea"><span>Tiene el nivel desde</span>
        <span>${escapar(mesEnPalabras(c.nivel_confirmado_en) || '—')}</span></div>` : ''}
    </div>
    <!-- Cuántas visitas necesita para conservar el nivel y qué pasa si no
         llega. Los números salen de la configuración, no van escritos aquí,
         así que se pide aparte y se rellena al llegar. -->
    <div id="cf-nivel"></div>
    <!-- Teléfono y observaciones viven en la ficha privada, que solo la
         administración puede leer. Se piden aparte, después de abrir. -->
    <div id="cf-privado"></div>
    <div class="barra-acciones">
      ${esAdmin() ? '<button class="btn btn--neutro" id="c-editar" style="flex:1">Editar datos</button>' : ''}
      ${esAdmin() ? '<button class="btn btn--neutro" id="c-fusionar" style="flex:1">Fusionar</button>' : ''}
    </div>
    <span class="eyebrow" style="margin:6px 0 10px">Historial de visitas</span>
    <div id="c-hist">${esqueleto(3)}</div>`);

  // La explicación del nivel, con los números de la configuración.
  D.configNiveles().then(cfg => {
    const caja = cuerpo.querySelector('#cf-nivel');
    if (!caja) return;
    const vino   = c.visitas_mes ?? 0;
    const pide   = pideParaMantener(c.nivel, cfg);
    const faltan = faltanParaMantener(c.nivel, c.visitas_mes, cfg);

    // La regla, dicha con los umbrales que están puestos hoy.
    const regla = c.vip
      ? 'Tiene la estrella puesta a mano, así que es VIP Black mientras la tenga, vengan las visitas que vengan. Si se la quitas, vuelve al nivel que sostengan sus visitas.'
      : c.nivel === 'black'
      ? `El VIP Black se gana con ${cfg.ganaBlack} visitas en un mes y se conserva con ${cfg.mantBlack} cada mes. Si un mes solo viene ${cfg.mantClasico}, pasa a VIP Clásico; si viene menos, se queda sin nivel y para recuperarlo tendría que juntar otra vez ${cfg.ganaBlack} en un mes.`
      : c.nivel === 'clasico'
      ? `El VIP Clásico se gana con ${cfg.ganaClasico} visitas en un mes y se conserva con ${cfg.mantClasico} cada mes. Si un mes no llega, se queda sin nivel. Con ${cfg.ganaBlack} visitas en un mes pasa a VIP Black.`
      : `Con ${cfg.ganaClasico} visitas en un mismo mes pasa a VIP Clásico, y con ${cfg.ganaBlack} a VIP Black.`;

    // Y cómo va este mes, que es lo que se puede hacer algo al respecto.
    const situacion = (c.vip || !c.nivel || c.nivel === 'ninguno') ? ''
      : faltan === 0
      ? `<p class="ayuda" style="margin:0 0 18px">Este mes ya vino ${vino} ${vino === 1 ? 'vez' : 'veces'}: con eso conserva su nivel cuando el mes cierre.</p>`
      : `<p class="ayuda" style="margin:0 0 18px"><strong>Este mes lleva ${vino} de las ${pide} visitas que necesita.</strong> Le ${
          faltan === 1 ? 'falta 1' : `faltan ${faltan}`
        } antes de que termine el mes: si cierra así, ${
          nivelSiCierraAsi(c.nivel, vino, cfg) === 'ninguno'
            ? 'se queda sin nivel'
            : `pasa a ${nombreNivel(nivelSiCierraAsi(c.nivel, vino, cfg))}`
        }.</p>`;

    caja.innerHTML =
      `<p class="ayuda" style="margin:-10px 0 ${situacion ? '10px' : '18px'}">${regla}</p>` + situacion;
  }).catch(() => {});

  // Con recepción el botón no existe, así que se comprueba antes de tocarlo.
  const bEditar = cuerpo.querySelector('#c-editar');
  if (bEditar) bEditar.onclick = () => { editar(c); };

  // Los datos privados se piden aparte: el servidor solo se los da a la
  // administración, así que con recepción esto queda vacío y no se ve nada.
  (async () => {
    const caja = cuerpo.querySelector('#cf-privado');
    if (!caja || !esAdmin()) return;
    const f = await D.fichaPrivada(c.id);
    c.telefono = f?.telefono ?? null;          // el editor los necesita luego
    c.observaciones = f?.observaciones ?? null;
    if (!f?.telefono && !f?.observaciones) return;
    caja.innerHTML = `
      <div class="panel" style="margin-bottom:18px"><div class="panel__cuerpo">
        <span class="eyebrow">Datos privados · solo administración</span>
        ${f.telefono ? `<p style="margin:8px 0 0"><strong>${escapar(f.telefono)}</strong></p>` : ''}
        ${f.observaciones ? `<p style="margin:8px 0 0">${escapar(f.observaciones)}</p>` : ''}
      </div></div>`;
  })();
  const f = cuerpo.querySelector('#c-fusionar');
  if (f) f.onclick = () => fusionar(c);

  try {
    const regs = await D.historialCliente(c.id);
    cuerpo.querySelector('#c-hist').innerHTML = regs.length ? `
      <div class="panel"><div class="tabla-envoltura"><table>
        <thead><tr><th>Fecha</th><th>Servicio</th><th>Masajista</th>
          <th class="num">Ref.</th><th class="num">Desc.</th><th class="num">Cobrado</th><th>Pago</th></tr></thead>
        <tbody>${regs.map(r => `<tr>
          <td>${fechaCorta(r.fecha)}</td>
          <td>${escapar(r.servicio?.nombre_completo || r.servicio_nombre_snapshot || '—')}</td>
          <td>${escapar((r.masajistas || []).map(m => m.masajista && !m.masajista.eliminada
                ? m.masajista.nombre : m.masajista_nombre_snapshot).join(' | ') || '—')}</td>
          <td class="num">${monto(r.precio_referencial)}</td>
          <td class="num">${Number(r.descuento) > 0 ? '−' + monto(r.descuento) : '—'}</td>
          <td class="num"><strong>${monto(r.precio_cobrado)}</strong></td>
          <td>${r.forma_pago || '<span class="vacio">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div></div>`
      : '<p class="ayuda">Todavía no tiene visitas registradas.</p>';
  } catch (ex) {
    cuerpo.querySelector('#c-hist').innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`;
  }
}

// Corregir el nombre actualiza todo el historial sin perder visitas.
async function editar(c) {
  // Se piden los datos privados AQUÍ, no se confía en que ya estén cargados.
  // Si se abriera el editor antes de que llegaran, el teléfono saldría vacío
  // y al guardar se borraría sin que nadie se diera cuenta.
  if (esAdmin() && c.telefono === undefined) {
    const f = await D.fichaPrivada(c.id);
    c.telefono = f?.telefono ?? null;
    c.observaciones = f?.observaciones ?? null;
  }

  const cuerpo = abrirHoja('Editar cliente', `
    <label class="campo"><span>Nombre</span>
      <input type="text" id="ce-nombre" value="${escapar(c.nombre || '')}"></label>
    <label class="campo"><span>Teléfono</span>
      <input type="tel" id="ce-tel" value="${escapar(c.telefono || '')}"></label>
    <label class="casilla"><input type="checkbox" id="ce-vip" ${c.vip ? 'checked' : ''}>
      <span>VIP Black fijo — se queda en Black aunque deje de venir.
            Para familia o gente de la casa. Sin esto, el nivel lo pone
            el sistema solo, según sus visitas.</span></label>
    <label class="campo"><span>Observaciones</span>
      <textarea id="ce-obs">${escapar(c.observaciones || '')}</textarea></label>
    <button class="btn btn--principal btn--bloque" id="ce-guardar">Guardar cambios</button>`);

  cuerpo.querySelector('#ce-guardar').onclick = async () => {
    const nombreNuevo = cuerpo.querySelector('#ce-nombre').value.trim();
    // Lo público va a la tabla de clientes; lo privado a la suya, que
    // recepción no puede leer. Se llevan juntos hasta el momento de guardar.
    const datos = {
      id: c.id,
      nombre: nombreNuevo || null,
      vip: cuerpo.querySelector('#ce-vip').checked,
      _privado: {
        telefono:      cuerpo.querySelector('#ce-tel').value.trim(),
        observaciones: cuerpo.querySelector('#ce-obs').value.trim()
      }
    };

    // Corregir un nombre mal escrito suele significar que ya existe la
    // persona bien escrita. Si no se avisa aquí, quedan dos fichas idénticas
    // y el historial de esa persona se parte en dos.
    if (nombreNuevo && nombreNuevo !== c.nombre) {
      const gemelo = await buscarGemelo(nombreNuevo, c.id);
      if (gemelo) return proponerUnir(c, gemelo, datos);
    }

    await aplicar(datos);
  };

  async function aplicar(datos) {
    const { _privado, ...publico } = datos;
    try {
      await D.guardarCliente(publico);
      if (_privado) await D.guardarFichaPrivada(publico.id, _privado.telefono, _privado.observaciones);
      avisar('Cliente actualizado', 'exito');
      cerrarHoja();
      vistaClientes();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  }
}

// Busca un cliente distinto cuyo nombre normalizado sea idéntico.
// Solo coincidencia exacta: para los parecidos ya está "Posibles duplicados".
async function buscarGemelo(nombre, propioId) {
  try {
    const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase().replace(/\s+/g, ' ').trim();
    const objetivo = norm(nombre);
    const hallados = await D.buscarClientes(nombre);
    return hallados.find(x => x.id !== propioId && norm(x.nombre) === objetivo) || null;
  } catch { return null; }   // si la búsqueda falla, no bloqueamos el guardado
}

// Ofrece unir en lugar de crear un duplicado. Deja salida por si de verdad
// son dos personas distintas con el mismo nombre.
function proponerUnir(actual, gemelo, datos) {
  const cuerpo = abrirHoja('Ya existe alguien con ese nombre', `
    <p class="ayuda" style="margin:0 0 18px">
      Al corregir el nombre, esta ficha queda igual que otra que ya existe.
      Si son la misma persona, únelas: el historial se junta y no se pierde
      ninguna visita.</p>

    <div class="tarifa" style="margin-bottom:8px">
      <div class="tarifa__linea"><span>Ficha que estás editando</span>
        <b>${escapar(actual.nombre || '—')}</b></div>
      <div class="tarifa__linea"><span>Visitas</span>
        <b>${actual.visitas ?? 0}</b></div>
    </div>
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Ficha que ya existía</span>
        <b>${escapar(gemelo.nombre)}</b></div>
      <div class="tarifa__linea"><span>Visitas</span>
        <b>${gemelo.visitas ?? 0}</b></div>
    </div>

    <button class="btn btn--principal btn--bloque" id="pu-unir">
      Unir en una sola ficha</button>
    <button class="btn btn--neutro btn--bloque" id="pu-separado" style="margin-top:10px">
      Son personas distintas, guardar por separado</button>`);

  // Se conserva la ficha con más visitas: la otra se absorbe.
  const propias = actual.visitas ?? 0, ajenas = gemelo.visitas ?? 0;
  const [conservar, absorber] = propias >= ajenas
    ? [actual.id, gemelo.id] : [gemelo.id, actual.id];

  cuerpo.querySelector('#pu-unir').onclick = async () => {
    try {
      // Primero se corrige el nombre, para que la ficha que sobreviva
      // quede bien escrita aunque la que se conserve sea la otra.
      const { _privado, ...publico } = datos;
      await D.guardarCliente(publico);
      if (_privado) await D.guardarFichaPrivada(publico.id, _privado.telefono, _privado.observaciones);
      const r = await D.fusionarClientes(conservar, absorber);
      avisar(`Unidas. Se movieron ${r.registros_movidos} registros.`, 'exito');
      cerrarHoja();
      vistaClientes();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };

  cuerpo.querySelector('#pu-separado').onclick = async () => {
    try {
      const { _privado, ...publico } = datos;
      await D.guardarCliente(publico);
      if (_privado) await D.guardarFichaPrivada(publico.id, _privado.telefono, _privado.observaciones);
      avisar('Guardado como ficha separada', 'exito');
      cerrarHoja();
      vistaClientes();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}

// ---------------------------------------------------------------------------
//  Fusión: reasigna todos los registros y no borra nada físicamente.
// ---------------------------------------------------------------------------
function fusionar(conservar) {
  const cuerpo = abrirHoja('Fusionar clientes', `
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Se conserva</span>
        <span>${escapar(conservar.nombre || '—')} · ${conservar.visitas} visitas</span></div>
    </div>
    <div id="fu-absorber"></div>
    <div id="fu-resultado"></div>
    <p class="error">Esta acción no se puede deshacer desde la aplicación.</p>
    <button class="btn btn--principal btn--bloque" id="fu-ok" disabled>Fusionar</button>`);

  let absorber = null;
  autocompletar({
    contenedor: cuerpo.querySelector('#fu-absorber'),
    etiqueta: 'Cliente que se absorbe', requerido: true,
    buscar: async t => (await D.buscarClientes(t)).filter(c => c.id !== conservar.id),
    pintar: c => ({ titulo: c.nombre || 'Sin nombre', nota: `${c.visitas} visitas` }),
    alElegir: c => {
      absorber = c;
      cuerpo.querySelector('#fu-ok').disabled = !c;
      cuerpo.querySelector('#fu-resultado').innerHTML = c ? `
        <div class="tarifa" style="margin-bottom:18px">
          <div class="tarifa__linea tarifa__linea--total"><span>Resultado</span>
            <span>${escapar(conservar.nombre)} · ${conservar.visitas + c.visitas} visitas</span></div>
          <div class="tarifa__linea"><span>Registros que se mueven</span><span>${c.visitas}</span></div>
        </div>` : '';
    }
  });

  cuerpo.querySelector('#fu-ok').onclick = async () => {
    if (!absorber) return;
    try {
      const r = await D.fusionarClientes(conservar.id, absorber.id);
      avisar(`Fusionado. Se movieron ${r.registros_movidos} registros.`, 'exito');
      cerrarHoja(); vistaClientes();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}

// ---------------------------------------------------------------------------
//  Panel de posibles duplicados: los detecta el servidor por similitud.
// ---------------------------------------------------------------------------
async function panelDuplicados() {
  const cuerpo = abrirHoja('Posibles duplicados', esqueleto(4));
  try {
    const pares = await D.duplicadosCliente();
    cuerpo.innerHTML = pares.length ? `
      <p class="ayuda" style="margin-bottom:16px">Nombres muy parecidos. Revisa antes de unirlos.</p>
      ${pares.map((p, i) => `
        <div class="panel" style="margin-bottom:12px"><div class="panel__cuerpo">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <span><strong>${escapar(p.nombre_a)}</strong> · ${p.visitas_a} visitas</span>
            <span><strong>${escapar(p.nombre_b)}</strong> · ${p.visitas_b} visitas</span>
          </div>
          <button class="btn btn--suave btn--bloque" style="margin-top:12px" data-par="${i}">
            Unir en “${escapar(p.visitas_a >= p.visitas_b ? p.nombre_a : p.nombre_b)}”</button>
        </div></div>`).join('')}`
      : vacio('No se encontraron nombres parecidos. La base está limpia.');

    cuerpo.querySelectorAll('[data-par]').forEach(b => b.onclick = async () => {
      const p = pares[Number(b.dataset.par)];
      const [con, abs] = p.visitas_a >= p.visitas_b
        ? [p.id_a, p.id_b] : [p.id_b, p.id_a];
      const ok = await confirmar({
        titulo: 'Unir clientes', aceptar: 'Unir',
        texto: `Todos los masajes pasarán a un solo cliente. No se borra nada, pero no se puede deshacer.`
      });
      if (!ok) return;
      try {
        const r = await D.fusionarClientes(con, abs);
        avisar(`Unidos. Se movieron ${r.registros_movidos} registros.`, 'exito');
        panelDuplicados();
      } catch (ex) { avisar(mensajeError(ex), 'error'); }
    });
  } catch (ex) { cuerpo.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}
