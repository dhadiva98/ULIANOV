// ===========================================================================
//  ULIANOV — Cambiar la contraseña de un usuario desde el sistema
//
//  POR QUÉ HACE FALTA ESTA PIEZA APARTE
//  Cambiar la contraseña de OTRA persona necesita una llave con permisos de
//  administración total. Esa llave no puede vivir en la aplicación: el código
//  está publicado en GitHub y cualquiera podría leerla. Aquí sí puede estar,
//  porque este código corre en los servidores de Supabase y nadie lo ve.
//
//  QUIÉN PUEDE USARLA
//  Solo quien entre con una sesión de administración activa. La función
//  comprueba tres cosas antes de hacer nada:
//    1. Que la sesión sea válida.
//    2. Que ese usuario tenga rol de administración.
//    3. Que su cuenta esté activa.
//  Si falla cualquiera, devuelve error y no toca nada.
// ===========================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CABECERAS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-id',
  'Content-Type': 'application/json',
};

const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: CABECERAS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CABECERAS });

  try {
    const URL_SB   = Deno.env.get('SUPABASE_URL')!;
    const ANON     = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // --- 1. ¿Quién llama? -------------------------------------------------
    const autorizacion = req.headers.get('Authorization') ?? '';
    if (!autorizacion.startsWith('Bearer ')) {
      return responder({ error: 'Falta la sesión.' }, 401);
    }

    const comoUsuario = createClient(URL_SB, ANON, {
      global: { headers: { Authorization: autorizacion } },
    });

    const { data: { user }, error: errUser } = await comoUsuario.auth.getUser();
    if (errUser || !user) {
      return responder({ error: 'La sesión no es válida. Vuelve a entrar.' }, 401);
    }

    // --- 2. ¿Es administración, y está activa? ----------------------------
    // Se consulta con la llave de administración para que no dependa de las
    // reglas de lectura: aquí lo que importa es el dato real.
    const admin = createClient(URL_SB, SERVICIO, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: perfil } = await admin
      .from('perfiles').select('rol, activo, nombre').eq('id', user.id).single();

    if (!perfil || perfil.rol !== 'admin' || !perfil.activo) {
      return responder({ error: 'Solo la administración puede cambiar contraseñas.' }, 403);
    }

    // --- 3. Lo que se pide ------------------------------------------------
    const { usuario_id, clave } = await req.json().catch(() => ({}));

    if (!usuario_id || typeof usuario_id !== 'string') {
      return responder({ error: 'Falta indicar de quién es la contraseña.' }, 400);
    }
    if (typeof clave !== 'string' || clave.length < 8) {
      return responder({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
    }

    const { data: destino } = await admin
      .from('perfiles').select('nombre').eq('id', usuario_id).single();
    if (!destino) {
      return responder({ error: 'Esa persona no existe en el sistema.' }, 404);
    }

    // --- 4. Cambiarla -----------------------------------------------------
    const { error: errCambio } = await admin.auth.admin.updateUserById(
      usuario_id, { password: clave });

    if (errCambio) {
      return responder({ error: 'No se pudo cambiar: ' + errCambio.message }, 400);
    }

    // --- 5. Dejar constancia ----------------------------------------------
    // Un cambio de contraseña tiene que quedar registrado: es de las cosas
    // que después hay que poder explicar.
    await admin.from('auditoria').insert({
      usuario_id: user.id,
      accion: 'CLAVE',
      tabla_afectada: 'auth.users',
      registro_id: usuario_id,
      descripcion: `${perfil.nombre} cambió la contraseña de ${destino.nombre}`,
    });

    return responder({ ok: true, nombre: destino.nombre });

  } catch (e) {
    return responder({ error: 'Algo falló: ' + String(e) }, 500);
  }
});
