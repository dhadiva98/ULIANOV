// ===========================================================================
//  NÚCLEO — cliente de Supabase, identidad del dispositivo, estado y formato
// ===========================================================================

const C = window.CONFIG;

// --- Identidad del dispositivo ---------------------------------------------
// Se genera una sola vez y viaja en cada petición como cabecera x-device-id.
// Las policies del servidor la usan para poder revocar este equipo.
function idDispositivo() {
  let id = localStorage.getItem('ulianov.dispositivo');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID()
                            : Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem('ulianov.dispositivo', id);
  }
  return id;
}

export const DISPOSITIVO = idDispositivo();

export const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON, {
  auth: {
    persistSession: true,        // la sesión sobrevive a cerrar la pestaña
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'ulianov.sesion'
  },
  global: { headers: { 'x-device-id': DISPOSITIVO } },
  realtime: { params: { eventsPerSecond: 20 } }
});

// --- Estado en memoria ------------------------------------------------------
export const estado = {
  usuario: null,      // fila de `perfiles`
  vista: 'agenda',
  fecha: hoy(),       // fecha que se está mirando en la agenda
  bloqueada: false
};

export const esAdmin = () => estado.usuario?.rol === 'admin';

// --- Fechas y horas ---------------------------------------------------------
// Todo se calcula con el reloj local del dispositivo, que en el spa siempre
// es América/Lima. Nunca en UTC: un registro de las 8 PM caería en el día
// siguiente y descuadraría el cierre.
export function hoy() { return aISO(new Date()); }

export function aISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sumarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return aISO(d);
}

export function fechaLarga(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00')
    .toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function fechaCorta(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Formato 12 horas con AM/PM, como en la referencia: "4:30 PM"
export function hora12(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function horaAhora() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Hora estimada de término: informativa, nunca se guarda como dato duro.
export function sumarMinutos(hhmm, min) {
  if (!hhmm || !min) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + Number(min);
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// --- Dinero -----------------------------------------------------------------
// Se guarda con céntimos, se muestra con un decimal como máximo:
// 185 -> "S/ 185"   ·   185.5 -> "S/ 185.5"
// (para cambiar a dos decimales fijos, es este único sitio)
export function monto(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  // Dos decimales cuando los hay, no uno: con el 35% aparecen pagos de
  // S/ 57.75 y con un solo decimal se leían "S/ 57.8", cinco céntimos de más.
  // En plata que se entrega en mano eso no puede pasar.
  const txt = Number.isInteger(v) ? v.toLocaleString('es-PE')
                                  : v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return 'S/ ' + txt;
}

export const numero = n => (n === null || n === undefined) ? 0 : Number(n);

// --- Utilidades varias ------------------------------------------------------
export function esperar(fn, ms = 180) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function vibrar(patron = 12) {
  if (navigator.vibrate) try { navigator.vibrate(patron); } catch (_) {}
}

export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Nombre a mostrar de un registro: nombre VIVO si la entidad existe,
// snapshot solo si fue eliminada. Un nombre mal escrito es un error a
// corregir, no un dato histórico a congelar.
export function nombreVivo(relacion, snapshot, campo = 'nombre_completo') {
  return relacion?.[campo] || snapshot || null;
}

// Traduce los errores crudos de PostgreSQL a algo que una persona entienda.
// ---------------------------------------------------------------------------
//  PAGO DE UNA MASAJISTA — espejo exacto de la función pago_de_masajista()
//  del servidor. Aquí solo sirve para MOSTRAR lo que se va a pagar mientras
//  se llena el formulario. El número que de verdad se guarda lo calcula el
//  servidor, no esta función: si alguna vez discrepan, manda el servidor.
// ---------------------------------------------------------------------------
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const t2 = x => Math.floor(x * 100 + 1e-9) / 100;

export function pagoPrevisto(precio, requeridas, reparto, orden, cfg) {
  const p = Number(precio);
  if (!(p > 0)) return null;

  const n     = Math.max(Number(requeridas) || 1, 1);
  const apoyo = Number(cfg?.apoyo ?? 25);

  if (reparto === 'principal_apoyo') {
    // El monto de la apoyo sale PRIMERO del precio; el porcentaje de la
    // principal se saca de lo que queda.
    return orden <= 1
      ? r2(Math.max(p - apoyo, 0) * (cfg?.porcentaje ?? 40) / 100)
      : Math.min(apoyo, p);
  }

  const pool = r2(p * (cfg?.porcentaje ?? 40) / 100);

  // Se divide entre las que el tarifario exige, no entre las registradas:
  // un 4 manos con una sola masajista le paga a ella solo su mitad.
  const base = t2(pool / n);
  return orden <= 1 ? r2(pool - base * (n - 1)) : base;
}

// Precio sobre el que se calcula el pago. Espejo de precio_base_pago() del
// servidor: en holístico la señorita cobra sobre el Egypcio de esa duración,
// no sobre el masaje que se hizo.
export function precioBasePago(servicio, todosLosServicios = [], modalidades = []) {
  if (!servicio) return { precio: null, origen: null, falta: false };

  const mod = modalidades.find(m => m.nombre === servicio.modalidad);
  const ref = mod?.pago_masaje_referencia;

  if (!ref || ref === servicio.masaje)
    return { precio: Number(servicio.precio_referencial), origen: null, falta: false };

  const base = todosLosServicios.find(s =>
    s.masaje === ref && s.modalidad === servicio.modalidad &&
    Number(s.duracion) === Number(servicio.duracion) && s.activo !== false);

  const etiqueta = `${ref} ${servicio.modalidad} ${servicio.duracion}'`;
  return base
    ? { precio: Number(base.precio_referencial), origen: etiqueta, falta: false }
    : { precio: null, origen: etiqueta, falta: true };
}

// El porcentaje que aplica: el propio de la modalidad si lo tiene.
export function pctDeModalidad(nombreModalidad, modalidades = [], general = 40) {
  const m = modalidades.find(x => x.nombre === nombreModalidad);
  return m?.pago_porcentaje != null ? Number(m.pago_porcentaje) : general;
}

// El porcentaje que de verdad le toca a un servicio, con el mismo orden de
// prioridad que usa el servidor al guardar la atención:
//   1. la MODALIDAD, si tiene el suyo — el holístico paga la mitad y eso
//      manda sobre todo, incluso sobre el porcentaje propio del masaje;
//   2. el MASAJE, si tiene el suyo — aquí entra el Sorpresa;
//   3. el general de Configuración.
// Si esto y el servidor dejaran de coincidir, la pantalla mostraría un pago
// distinto al que se guarda, así que los dos se cambian juntos.
export function pctAplicable(nombreMasaje, nombreModalidad,
                             masajes = [], modalidades = [], general = 40) {
  const mod = modalidades.find(x => x.nombre === nombreModalidad);
  if (mod?.pago_porcentaje != null) return Number(mod.pago_porcentaje);
  const mas = masajes.find(x => x.nombre === nombreMasaje);
  if (mas?.pago_porcentaje != null) return Number(mas.pago_porcentaje);
  return general;
}

// El distintivo del nivel, en un solo sitio para que las cinco pantallas
// que lo muestran no se desincronicen nunca.
export function insigniaNivel(nivel, { texto = false } = {}) {
  if (nivel === 'black')
    return `<span class="nivel nivel--black" title="VIP Black"><span class="ast">★</span>BLACK</span>`;
  if (nivel === 'clasico')
    return `<span class="nivel nivel--clasico" title="VIP Clásico">★${texto ? ' VIP Clásico' : ''}</span>`;
  return '';
}

// Nombre del cliente con su nivel delante, para los sitios donde solo cabe
// texto plano (el buscador escapa el HTML, así que la pastilla no sirve ahí).
// Black lleva la palabra: con solo la estrella no se distinguía de Clásico.
export const etiquetaCliente = c =>
  (c?.nivel === 'black'   ? '★ BLACK · '
 : c?.nivel === 'clasico' ? '★ '
 : '') + (c?.nombre || 'Sin nombre');

export const nombreNivel = n =>
  n === 'black' ? 'VIP Black' : n === 'clasico' ? 'VIP Clásico' : 'Sin nivel';

// Umbrales del programa VIP. Los de verdad viven en la tabla de configuración
// y se cambian desde ahí; estos son solo el respaldo para que la pantalla no
// se quede sin números si el servidor no contesta.
export const NIVELES_POR_DEFECTO =
  { ganaClasico: 2, ganaBlack: 4, mantClasico: 2, mantBlack: 3 };

// Cuántas visitas le faltan este mes para no perder el nivel que tiene.
// Espejo de faltan_para_mantener() del servidor.
export function faltanParaMantener(nivel, visitasMes, cfg) {
  const c = cfg || NIVELES_POR_DEFECTO;
  const pide = nivel === 'black'   ? Number(c.mantBlack   ?? 3)
             : nivel === 'clasico' ? Number(c.mantClasico ?? 2)
             : 0;
  return Math.max(pide - (Number(visitasMes) || 0), 0);
}

// Cuántas visitas pide el mes para conservar cada nivel.
export const pideParaMantener = (nivel, cfg) => {
  const c = cfg || NIVELES_POR_DEFECTO;
  return nivel === 'black'   ? Number(c.mantBlack   ?? 3)
       : nivel === 'clasico' ? Number(c.mantClasico ?? 2)
       : 0;
};

// En qué nivel quedaría el cliente si el mes cerrara tal como está ahora.
// Espejo de nivel_mantenible() del servidor, con el mismo tope: conservar
// nunca sube de nivel, solo puede dejarlo igual o más abajo.
export function nivelSiCierraAsi(nivel, visitasMes, cfg) {
  const c = cfg || NIVELES_POR_DEFECTO;
  const n = Number(visitasMes) || 0;
  const sostiene = n >= Number(c.mantBlack   ?? 3) ? 'black'
                 : n >= Number(c.mantClasico ?? 2) ? 'clasico'
                 : 'ninguno';
  const r = x => x === 'black' ? 2 : x === 'clasico' ? 1 : 0;
  return r(sostiene) < r(nivel) ? sostiene : nivel;
}

// "julio de 2026". Se escribe a mano en vez de dejárselo al navegador porque
// el mes se lee en la ficha del cliente y tiene que salir igual en el celular
// de recepción que en la computadora, sin depender del idioma del equipo.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

export function mesEnPalabras(iso) {
  if (!iso) return null;
  const [a, m] = String(iso).split('-');
  const nombre = MESES[Number(m) - 1];
  return nombre ? `${nombre} de ${a}` : null;
}

// Descuento por nivel VIP. Espejo de descuento_vip() del servidor; aquí solo
// sirve para precargar el precio mientras se llena el formulario. El número
// que queda guardado lo calcula el servidor.
export function descuentoVip(nivel, precio, duracion, modalidad, reglas = [], tramos = {}) {
  const p = Number(precio);
  if (!nivel || nivel === 'ninguno' || !(p > 0)) return { monto: 0, regla: null };

  // Gana la regla más específica: la que coincide en duración y modalidad.
  const candidatas = reglas.filter(r =>
    r.nivel === nivel &&
    (r.duracion == null  || Number(r.duracion) === Number(duracion)) &&
    (r.modalidad == null || r.modalidad === modalidad));
  if (!candidatas.length) return { monto: 0, regla: null };

  const peso = r => (r.duracion != null ? 1 : 0) + (r.modalidad != null ? 1 : 0);
  candidatas.sort((a, b) => peso(b) - peso(a)
                         || (b.modalidad != null) - (a.modalidad != null));
  const r = candidatas[0];

  const t1 = Number(tramos.t1 ?? 139), t2 = Number(tramos.t2 ?? 204), t3 = Number(tramos.t3 ?? 304);
  const m = p <= t1 ? r.tramo1 : p <= t2 ? r.tramo2 : p <= t3 ? r.tramo3 : r.tramo4;
  return { monto: Math.min(Number(m) || 0, p), regla: r.nota || null };
}

export function mensajeError(e) {
  const m = String(e?.message || e || '');
  if (/masajistas activas|no existe/i.test(m)) return m.replace(/^.*?:\s*/, '');
  if (/al menos una masajista/i.test(m))       return 'Falta elegir la masajista.';
  if (/al menos un dato/i.test(m))             return 'Escribe al menos un nombre, una hora o una terapeuta.';
  if (/repetir la misma masajista/i.test(m))   return 'Esa masajista ya está en este registro.';
  if (/row-level security|permission denied/i.test(m))
    return 'Tu usuario no tiene permiso para hacer eso.';
  if (/duplicate key.*cierres/i.test(m))       return 'Este día ya fue cerrado.';
  if (/duplicate key.*servicios_masaje/i.test(m))
    return 'Esa combinación ya existe en el tarifario, aunque esté quitada. ' +
           'Vuelve a intentarlo: se reactivará la de siempre.';
  if (/duplicate key.*asistencias/i.test(m))   return 'Esa asistencia ya estaba registrada para ese día.';
  if (/duplicate key/i.test(m))                return 'Ya existe un registro igual.';
  if (/violates foreign key.*masajes/i.test(m))
    return 'No se puede eliminar ese masaje: todavía tiene precios cargados en la matriz.';
  if (/violates foreign key.*modalidades/i.test(m))
    return 'No se puede eliminar esa modalidad: todavía tiene precios cargados en la matriz.';
  if (/violates foreign key/i.test(m))
    return 'No se puede eliminar: hay otros datos que dependen de esto.';
  if (/violates check constraint.*efectivo/i.test(m))
    return 'El efectivo recibido no alcanza para cubrir el total.';
  if (/violates check constraint.*atendido/i.test(m))
    return 'Para marcarlo como atendido faltan datos obligatorios.';
  // El servidor ya manda estos dos en castellano y bien explicados: se dejan
  // pasar tal cual, solo limpiando el prefijo técnico que antepone Postgres.
  if (/hace falta el precio de|precio de referencia para pagar/i.test(m))
    return m.replace(/^.*?:\s*/, '');
  if (/violates not-null|null value in column/i.test(m))
    return 'Falta rellenar un campo obligatorio.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
  if (/JWT|token/i.test(m))                    return 'La sesión caducó. Vuelve a entrar.';
  console.error('[Ulianov]', e);               // el detalle técnico, solo en consola
  return m || 'Algo no salió bien. Inténtalo de nuevo.';
}
