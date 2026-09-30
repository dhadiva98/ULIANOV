// ===========================================================================
//  CAPA DE DATOS — todas las consultas a Supabase en un solo sitio
//  Supabase es la ÚNICA fuente de verdad. Nada de esto se guarda localmente.
// ===========================================================================
import { sb } from './core.js';

const ok = ({ data, error }) => { if (error) throw error; return data; };

// --- Selección estándar de un registro con sus relaciones ------------------
// Se traen los nombres VIVOS (servicio, cliente, masajistas) además de los
// snapshots, para poder aplicar la regla de resolución de nombres.
const REGISTRO = `
  id, estado, fecha, hora_ingreso, precio_referencial, precio_cobrado,
  descuento, ajuste, motivo_descuento, motivo_descuento_texto,
  forma_pago, dinero_recibido, vuelto, vuelto_metodo, notas,
  anulado, motivo_anulacion, motivo_cancelacion, atendido_en,
  servicio_id, servicio_nombre_snapshot, cliente_id, cliente_texto, usuario_id,
  servicio:servicios ( id, masaje, modalidad, duracion, nombre_completo,
                       precio_referencial, terapeutas_requeridas, pago_reparto ),
  cliente:clientes ( id, nombre, vip, visitas, ultima_visita, nivel, visitas_mes ),
  masajistas:registro_masajistas (
    orden, masajista_id, masajista_nombre_snapshot,
    masajista:masajistas ( id, nombre, apellido, eliminada ) )`;

// ===========================  REGISTROS  ===================================

export const registrosDelDia = fecha =>
  sb.from('registros_servicios').select(REGISTRO)
    .eq('fecha', fecha)
    .order('hora_ingreso', { ascending: true, nullsFirst: false })
    .order('id')
    .then(ok);

export const registro = id =>
  sb.from('registros_servicios').select(REGISTRO).eq('id', id).single().then(ok);

export const proximasReservas = desde =>
  sb.from('registros_servicios').select(REGISTRO)
    .eq('estado', 'reserva').gt('fecha', desde)
    .order('fecha').order('hora_ingreso', { nullsFirst: false }).limit(100).then(ok);

export function historial(f = {}) {
  let q = sb.from('registros_servicios').select(REGISTRO);
  if (f.desde)      q = q.gte('fecha', f.desde);
  if (f.hasta)      q = q.lte('fecha', f.hasta);
  if (f.estado)     q = q.eq('estado', f.estado);
  if (f.forma_pago) q = q.eq('forma_pago', f.forma_pago);
  if (f.servicio)   q = q.eq('servicio_id', f.servicio);
  if (f.cliente)    q = q.eq('cliente_id', f.cliente);
  if (f.conDescuento) q = q.gt('descuento', 0);
  return q.order('fecha', { ascending: false })
          .order('hora_ingreso', { ascending: false, nullsFirst: false })
          .limit(f.limite || 300).then(ok);
}

// Guardado atómico: el registro y sus masajistas viajan en una sola operación.
// Nunca puede quedar una venta sin sus masajistas si algo falla a mitad.
export const guardarRegistro = (datos, masajistas = [], id = null) =>
  sb.rpc('guardar_registro', { p_datos: datos, p_masajistas: masajistas, p_id: id }).then(ok);

export const borrarRegistro = id =>
  sb.from('registros_servicios').delete().eq('id', id).then(ok);

// Anular ya no es un camino de ida: la administración puede revertirlo.
// El servidor decide a qué estado vuelve según los datos que tenga el registro.
export const desanularRegistro = id =>
  sb.rpc('desanular_registro', { p_id: id }).then(ok);

// Una atención NUNCA se borra: solo baja lógica con motivo obligatorio.
export const anularRegistro = (id, motivo) =>
  sb.from('registros_servicios')
    .update({ anulado: true, motivo_anulacion: motivo, estado: 'cancelado' })
    .eq('id', id).then(ok);

export const avisoSolapamiento = (masajistas, fecha, hora, duracion, excluir = null) =>
  sb.rpc('solapamientos', {
    p_masajistas: masajistas, p_fecha: fecha, p_hora: hora,
    p_duracion: duracion, p_excluir: excluir
  }).then(ok);

// ===========================  BÚSQUEDAS  ===================================

export const buscarClientes    = t => sb.rpc('buscar_clientes',    { p_texto: t }).then(ok);
export const buscarMasajistas  = t => sb.rpc('buscar_masajistas',  { p_texto: t }).then(ok);
export const buscarServicios   = t => sb.rpc('buscar_servicios',   { p_texto: t }).then(ok);
export const duplicadosCliente = () => sb.rpc('posibles_duplicados').then(ok);

// ===========================  CATÁLOGO  ====================================

export const servicios = (soloActivos = true) => {
  let q = sb.from('servicios').select('*');
  if (soloActivos) q = q.eq('activo', true);
  return q.order('masaje').order('modalidad').order('duracion').then(ok);
};

// Quitar una combinación del tarifario NO la borra: la marca inactiva, porque
// puede tener historial colgando. La matriz solo muestra las activas, así que
// la celda se ve vacía aunque la fila siga existiendo.
//
// Por eso aquí no vale un insert a secas: chocaría con la restricción
// servicios_masaje_modalidad_duracion_key. Se usa upsert sobre esa misma
// clave, de modo que volver a poner un precio reactiva la fila de siempre
// en lugar de intentar crear una nueva.
export const guardarServicio = (s) => {
  const { id, ...resto } = s;
  if (id) return sb.from('servicios').update(resto).eq('id', id).then(ok);
  return sb.from('servicios')
           .upsert(resto, { onConflict: 'masaje,modalidad,duracion' })
           .then(ok);
};

export const listasCatalogo = async () => ({
  masajes:     await sb.from('masajes').select('*').order('orden').then(ok),
  modalidades: await sb.from('modalidades').select('*').order('orden').then(ok),
  duraciones:  await sb.from('duraciones').select('*').order('minutos').then(ok)
});

export const agregarAlCatalogo = (tabla, fila) => sb.from(tabla).insert(fila).then(ok);

// ---------------------------------------------------------------------------
//  PAGO A LAS MASAJISTAS
//
//  El porcentaje y el monto de la señorita de apoyo viven en la tabla de
//  configuración, no escritos dentro del programa: la administradora los
//  cambia desde Configuración y el sistema los toma de ahí.
//  Se guardan en memoria durante la sesión para no preguntarlos en cada tecla.
// ---------------------------------------------------------------------------
let _cfgPagos = null;

export async function configPagos(recargar = false) {
  if (_cfgPagos && !recargar) return _cfgPagos;
  try {
    const filas = await sb.from('configuracion').select('clave, valor')
      .in('clave', ['pago_porcentaje', 'pago_apoyo_monto']).then(ok);
    const v = c => filas.find(f => f.clave === c)?.valor;
    _cfgPagos = {
      porcentaje: Number(v('pago_porcentaje')) || 40,
      apoyo:      Number(v('pago_apoyo_monto')) || 25
    };
  } catch {
    _cfgPagos = { porcentaje: 40, apoyo: 25 };   // nunca dejar la pantalla sin números
  }
  return _cfgPagos;
}

// Los umbrales del programa VIP: cuántas visitas hacen falta para ganar cada
// nivel y cuántas para conservarlo. Igual que los de pago, se cambian en la
// tabla de configuración y el programa los lee de ahí, no los lleva escritos.
let _cfgNiveles = null;

export async function configNiveles(recargar = false) {
  if (_cfgNiveles && !recargar) return _cfgNiveles;
  try {
    const filas = await sb.from('configuracion').select('clave, valor')
      .in('clave', ['vip_min_clasico', 'vip_min_black',
                    'vip_mant_clasico', 'vip_mant_black']).then(ok);
    const v = c => filas.find(f => f.clave === c)?.valor;
    _cfgNiveles = {
      ganaClasico: Number(v('vip_min_clasico'))  || 2,
      ganaBlack:   Number(v('vip_min_black'))    || 4,
      mantClasico: Number(v('vip_mant_clasico')) || 2,
      mantBlack:   Number(v('vip_mant_black'))   || 3
    };
  } catch {
    _cfgNiveles = { ganaClasico: 2, ganaBlack: 4, mantClasico: 2, mantBlack: 3 };
  }
  return _cfgNiveles;
}

// ---------------------------------------------------------------------------
//  EVENTOS CON DESCUENTO POR FECHA
//  Recepción los lee (los necesita para que el precio salga bien en pantalla);
//  crearlos y cambiarlos es solo de administración, y esa barrera está en el
//  servidor, no en que el botón no se vea.
// ---------------------------------------------------------------------------
let _eventos = null;

export async function eventos(recargar = false) {
  if (_eventos && !recargar) return _eventos;
  try {
    _eventos = await sb.from('eventos').select('*')
      .order('desde_mes').order('desde_dia').then(ok);
  } catch { _eventos = []; }   // sin eventos la pantalla sigue funcionando
  return _eventos;
}

export const guardarEvento = e => {
  _eventos = null;
  const fila = {
    nombre: e.nombre, icono: e.icono || null,
    desde_dia: e.desde_dia, desde_mes: e.desde_mes,
    hasta_dia: e.hasta_dia, hasta_mes: e.hasta_mes,
    anio: e.anio ?? null,
    masaje: e.masaje || null, modalidad: e.modalidad || null,
    duracion: e.duracion || null,
    monto: e.monto, activo: e.activo
  };
  return e.id
    ? sb.from('eventos').update(fila).eq('id', e.id).select().single().then(ok)
    : sb.from('eventos').insert(fila).select().single().then(ok);
};

export const borrarEvento = id => {
  _eventos = null;
  return sb.from('eventos').delete().eq('id', id).then(ok);
};

export const guardarConfigPagos = async (porcentaje, apoyo) => {
  const r = await sb.from('configuracion').upsert([
    { clave: 'pago_porcentaje',  valor: String(porcentaje) },
    { clave: 'pago_apoyo_monto', valor: String(apoyo) }
  ], { onConflict: 'clave' }).then(ok);
  _cfgPagos = null;              // se vuelve a leer del servidor
  return r;
};

// Reporte de pagos y detalle de un registro. Ambos son SOLO ADMIN: la
// barrera está en el servidor, no en que la pantalla no muestre el botón.
export const reportePagos = (desde, hasta) =>
  sb.rpc('reporte_pagos', { p_desde: desde, p_hasta: hasta }).then(ok);

export const pagosDeRegistro = id =>
  sb.rpc('pagos_de_registro', { p_id: id }).then(ok);

// --- Pago diario -----------------------------------------------------------
// El monto lo recalcula el servidor al marcar: nunca se le manda desde aquí,
// para que no pueda registrarse un pago por una cifra distinta a la real.
//
// "Periodo" es el día (como era hasta setiembre) o la semana de domingo a
// sábado (desde octubre). Se le pasa una fecha cualquiera y el servidor
// resuelve a qué periodo pertenece.
export const pagosDelPeriodo = fecha =>
  sb.rpc('pagos_del_periodo', { p_fecha: fecha }).then(ok);

export const adelantosDelPeriodo = fecha =>
  sb.rpc('adelantos_del_periodo', { p_fecha: fecha }).then(ok);

export const registrarAdelanto = (masajistaId, monto, formaPago, fecha, notas = null) =>
  sb.rpc('registrar_adelanto', { p_masajista_id: masajistaId, p_monto: monto,
                                 p_forma_pago: formaPago, p_fecha: fecha,
                                 p_notas: notas }).then(ok);

export const borrarAdelanto = id =>
  sb.rpc('borrar_adelanto', { p_id: id }).then(ok);

// Semanas anteriores que quedaron sin cerrar. Con pago diario un olvido se
// veía al día siguiente; con pago semanal podría quedarse atrás sin que nadie
// lo note, así que la pantalla lo avisa arriba del todo.
export const periodosPendientes = () =>
  sb.rpc('periodos_pendientes', {}).then(ok);

export const marcarPago = (masajistaId, formaPago, fecha, notas = null) =>
  sb.rpc('marcar_pago', { p_masajista_id: masajistaId, p_forma_pago: formaPago,
                          p_fecha: fecha, p_notas: notas }).then(ok);

export const deshacerPago = (masajistaId, fecha) =>
  sb.rpc('deshacer_pago', { p_masajista_id: masajistaId, p_fecha: fecha }).then(ok);

export const resumenPagosDia = fecha =>
  sb.rpc('resumen_pagos_dia', { p_fecha: fecha }).then(ok);

// Renombrar propaga solo: las claves foráneas tienen ON UPDATE CASCADE.
// Los registros ya guardados NO cambian, porque llevan su propia copia
// del nombre y del precio del momento en que se hicieron.
export const renombrarCatalogo = (tabla, campo, viejo, nuevo) =>
  sb.from(tabla).update({ [campo]: nuevo }).eq(campo, viejo).then(ok);

// Repaso diario de niveles. Un cliente que deja de venir no dispara ningún
// trigger, así que su nivel se quedaría congelado: esto lo pone al día.
// Por dentro comprueba si ya se hizo hoy, así que llamarla de más no cuesta.
// Reglas de descuento por nivel. Se leen una vez por sesión: cambian poco y
// hacen falta en cada tecla del formulario.
let _reglasVip = null;
export async function reglasDescuentoVip(recargar = false) {
  if (_reglasVip && !recargar) return _reglasVip;
  try {
    const [reglas, cfg] = await Promise.all([
      sb.from('descuentos_vip').select('*').then(ok),
      sb.from('configuracion').select('clave, valor')
        .in('clave', ['vip_tramo1_hasta','vip_tramo2_hasta','vip_tramo3_hasta']).then(ok)
    ]);
    const v = c => Number(cfg.find(f => f.clave === c)?.valor);
    _reglasVip = { reglas, tramos: {
      t1: v('vip_tramo1_hasta') || 139,
      t2: v('vip_tramo2_hasta') || 204,
      t3: v('vip_tramo3_hasta') || 304 } };
  } catch {
    _reglasVip = { reglas: [], tramos: { t1: 139, t2: 204, t3: 304 } };
  }
  return _reglasVip;
}

export const guardarDescuentoVip = (id, t1, t2, t3, t4) =>
  sb.rpc('guardar_descuento_vip',
         { p_id: id, p_t1: t1, p_t2: t2, p_t3: t3, p_t4: t4 })
    .then(ok).then(r => { _reglasVip = null; return r; });

// Ficha privada del cliente: teléfono y observaciones. El servidor solo se
// la entrega a administración, así que para recepción esto devuelve vacío.
// Cambiar la contraseña de otra persona. Va por una pieza aparte instalada
// en Supabase, porque necesita permisos que no pueden vivir en esta app.
export const cambiarClaveDe = async (usuarioId, clave) => {
  const { data, error } = await sb.functions.invoke('cambiar-clave', {
    body: { usuario_id: usuarioId, clave }
  });
  if (error) {
    // El cuerpo del error trae el motivo real; el genérico no dice nada útil.
    let detalle = '';
    try { detalle = (await error.context?.json())?.error || ''; } catch {}
    throw new Error(detalle || 'No se pudo cambiar la contraseña. '
      + '¿Está instalada la pieza "cambiar-clave" en Supabase?');
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

export const fichaPrivada = id =>
  sb.rpc('ficha_privada', { p_cliente: id }).then(ok)
    .then(r => r?.[0] || null).catch(() => null);

export const guardarFichaPrivada = (id, telefono, observaciones) =>
  sb.rpc('guardar_ficha_privada',
         { p_cliente: id, p_telefono: telefono, p_observaciones: observaciones }).then(ok);

export const actualizarNiveles = () =>
  sb.rpc('actualizar_niveles').then(ok).catch(() => 0);

// El porcentaje propio de un masaje. null = usar el general de Configuración.
export const configPagoMasaje = (nombre, porcentaje) =>
  sb.from('masajes').update({ pago_porcentaje: porcentaje })
    .eq('nombre', nombre).then(ok);

export const configPagoModalidad = (nombre, porcentaje, masajeReferencia) =>
  sb.from('modalidades')
    .update({ pago_porcentaje: porcentaje, pago_masaje_referencia: masajeReferencia })
    .eq('nombre', nombre).then(ok);

export const borrarDelCatalogo = (tabla, campo, valor) =>
  sb.from(tabla).delete().eq(campo, valor).then(ok);

// ===========================  MASAJISTAS  ==================================

export const masajistas = (filtro = 'todas') => {
  let q = sb.from('masajistas').select('*');
  if (filtro === 'eliminadas') q = q.eq('eliminada', true);
  else {
    q = q.eq('eliminada', false);
    if (filtro !== 'todas') q = q.eq('estado_laboral', filtro);
  }
  return q.order('nombre').then(ok);
};

export const guardarMasajista = m => {
  const { id, ...resto } = m;
  return id ? sb.from('masajistas').update(resto).eq('id', id).then(ok)
            : sb.from('masajistas').insert(resto).then(ok);
};

// Dar de baja (temporal, reactivable) y eliminar (definitiva) conviven.
// Las dos son lógicas: el historial nunca pierde su nombre.
export const cambiarEstadoMasajista = (id, estado) =>
  sb.from('masajistas').update({ estado_laboral: estado }).eq('id', id).then(ok);

export const eliminarMasajista = id =>
  sb.from('masajistas').update({
    eliminada: true, eliminada_en: new Date().toISOString()
  }).eq('id', id).then(ok);

export const restaurarMasajista = id =>
  sb.from('masajistas').update({
    eliminada: false, eliminada_en: null, estado_laboral: 'activa'
  }).eq('id', id).then(ok);

// ===========================  CLIENTES  ====================================

export const clientes = (texto = '') => {
  let q = sb.from('clientes').select('*').eq('estado', 'activo');
  if (texto) q = q.ilike('nombre', `%${texto}%`);
  return q.order('visitas', { ascending: false }).limit(200).then(ok);
};

export const crearCliente = c =>
  sb.from('clientes').insert(c).select().single().then(ok);

export const guardarCliente = c =>
  sb.from('clientes').update(c).eq('id', c.id).select().single().then(ok);

export const historialCliente = id =>
  sb.from('registros_servicios').select(REGISTRO)
    .eq('cliente_id', id).order('fecha', { ascending: false }).limit(100).then(ok);

export const fusionarClientes = (conservar, absorber) =>
  sb.rpc('fusionar_clientes', { p_conservar: conservar, p_absorber: absorber }).then(ok);

// ===========================  ASISTENCIA  ==================================

export const asistenciasDe = fecha =>
  sb.from('asistencias').select('*, masajista:masajistas(id,nombre,apellido)')
    .eq('fecha', fecha).then(ok);

export const guardarAsistencia = a =>
  sb.from('asistencias').upsert(a, { onConflict: 'masajista_id,fecha' }).then(ok);

export const asistenciasRango = (desde, hasta) =>
  sb.from('asistencias').select('*, masajista:masajistas(id,nombre,apellido)')
    .gte('fecha', desde).lte('fecha', hasta).order('fecha').then(ok);

// ===========================  CAJA Y CIERRE  ===============================

export const resumenDia   = fecha => sb.rpc('resumen_dia', { p_fecha: fecha }).then(ok);
export const diaCerrado   = fecha => sb.rpc('dia_esta_cerrado', { p_fecha: fecha }).then(ok);
export const diasCerrados = () =>
  sb.from('dias_cerrados').select('*').order('fecha', { ascending: false }).limit(60).then(ok);

export const registrarFondo = (fecha, monto) =>
  sb.rpc('registrar_fondo_inicial', { p_fecha: fecha, p_monto: monto }).then(ok);

export const cerrarDia = (fecha, contado, cajaFija, fondo, obs) =>
  sb.rpc('cerrar_dia', {
    p_fecha: fecha, p_efectivo_contado: contado,
    p_caja_fija_siguiente: cajaFija, p_fondo_inicial: fondo, p_observaciones: obs
  }).then(ok);

export const reabrirDia = fecha => sb.rpc('reabrir_dia', { p_fecha: fecha }).then(ok);

export const justificar = (fecha, motivo, monto) =>
  sb.rpc('justificar_diferencia', { p_fecha: fecha, p_motivo: motivo, p_monto: monto }).then(ok);

export const cierre = fecha =>
  sb.from('cierres_diarios').select('*, ajustes:ajustes_cierre(*)')
    .eq('fecha', fecha).maybeSingle().then(ok);

// ===========================  USUARIOS Y EQUIPOS  ==========================

export const perfiles = () =>
  sb.from('perfiles').select('*').order('nombre').then(ok);

export const dispositivos = () =>
  sb.from('dispositivos').select('*, usuario:perfiles(nombre)')
    .order('ultimo_acceso', { ascending: false }).then(ok);

export const revocarDispositivo = id => sb.rpc('revocar_dispositivo', { p_id: id }).then(ok);

export const activarUsuario = (id, activo) =>
  sb.from('perfiles').update({ activo }).eq('id', id).then(ok);

export const cambiarRol = (id, rol) =>
  sb.from('perfiles').update({ rol }).eq('id', id).then(ok);

export const auditoria = (limite = 200) =>
  sb.from('auditoria').select('*, usuario:perfiles(nombre)')
    .order('created_at', { ascending: false }).limit(limite).then(ok);
