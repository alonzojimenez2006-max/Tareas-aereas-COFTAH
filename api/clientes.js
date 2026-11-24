import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function normalizarFechaStr(val) {
    if (!val) return '';
    if (val instanceof Date) return val.toISOString().replace('Z', '');
    return String(val).replace('Z', '');
}

function formatearFechaISO(fechaVal) {
    const str = normalizarFechaStr(fechaVal);
    if (!str) return '';
    const soloFecha = str.split('T')[0].split(' ')[0];
    const partes = soloFecha.split('-');
    if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
    return soloFecha;
}

function extraerHoraHHMM(fechaVal) {
    const str = normalizarFechaStr(fechaVal);
    if (!str) return '08:00';
    const separador = str.includes('T') ? 'T' : ' ';
    const partes = str.split(separador);
    if (partes.length > 1) return partes[1].substring(0, 5);
    return '08:00';
}

function formatearFechaHora(fechaVal) {
    return `${formatearFechaISO(fechaVal)} ${extraerHoraHHMM(fechaVal)}`;
}

async function registrarMovimiento(usuario, accion, modulo, resumen, cambiosDetalle = '') {
    try {
        await pool.query(
            `INSERT INTO historial_movimientos (usuario, accion, modulo, resumen, cambios_detalle, fecha_hora)
             VALUES ($1, $2, $3, $4, $5, NOW() AT TIME ZONE 'America/Caracas')`,
            [usuario || 'Admin', accion, modulo, resumen, cambiosDetalle]
        );
    } catch (err) {
        console.error('Error registrando movimiento en clientes:', err);
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-nombre, x-user-rol');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuarioActivo = req.body?.usuario_solicitante || req.headers['x-user-nombre'] || 'Admin';

    try {
        if (req.method === 'GET') {
            const result = await pool.query(`
                SELECT c.*, 
                       COALESCE(d.logo_url, c.logo_url, 'COFTAH.png.png') AS logo_url_final,
                       p.foto_url AS facilitador_foto
                FROM clientes_agenda c
                LEFT JOIN directorio_clientes d ON c.nombre_cliente = d.nombre
                LEFT JOIN personal p ON c.facilitador_id = p.id
                ORDER BY c.fecha_atencion ASC
            `);
            return res.status(200).json(result.rows);
        }
        
        if (req.method === 'POST') {
            let { fechas_atencion, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, facilitador_id, estatus, participantes, duracion_curso, forzar } = req.body;
            
            if (!fechas_atencion || fechas_atencion.length === 0) {
                return res.status(400).json({ error: 'Se requiere al menos una fecha.' });
            }

            const cantParticipantes = parseInt(participantes) || 0;
            const idFacilitador = parseInt(facilitador_id) || null;
            const duracionFinal = duracion_curso || '-';
            const grupoId = `GRP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            // VERIFICACIÓN DE CHOQUE DE FECHAS
            for (let fecha of fechas_atencion) {
                const validacionTurno = await pool.query(
                    `SELECT id FROM clientes_agenda WHERE facilitador = $1 AND DATE(fecha_atencion) = DATE($2)`,
                    [facilitador, fecha]
                );
                
                if (validacionTurno.rows.length > 0 && !forzar) {
                    const fechaCorta = formatearFechaISO(fecha);
                    return res.status(409).json({ 
                        confirmacion_requerida: true, 
                        error: `⚠️ AUTORIZACIÓN REQUERIDA\n\nEl facilitador ${facilitador} ya tiene otra formación asignada el día ${fechaCorta}.\n\n¿Autorizas asignarle esta nueva formación para el mismo día?` 
                    });
                }
            }
            
            let registrosCreados = [];
            for (let fecha of fechas_atencion) {
                const result = await pool.query(
                    `INSERT INTO clientes_agenda (fecha_atencion, logo_url, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, facilitador_id, estatus, participantes, duracion_curso, grupo_id) 
                    VALUES ($1, 'default.png', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                    [fecha, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, idFacilitador, estatus, cantParticipantes, duracionFinal, grupoId]
                );
                registrosCreados.push(result.rows[0]);
            }

            const fechasLista = fechas_atencion.map(f => formatearFechaHora(f)).join(', ');
            const resumen = fechas_atencion.length > 1
                ? `Bloque programado (${fechas_atencion.length} días): ${nombre_cliente} - ${accion_formacion}`
                : `Formación programada: ${nombre_cliente} - ${accion_formacion}`;
            const detalle = `Fechas: ${fechasLista} | Facilitador: ${facilitador} | Lugar: ${lugar_atencion} (${ciudad}) | Part.: ${cantParticipantes} | Duración: ${duracionFinal} | Estatus: ${estatus.toUpperCase()}`;

            await registrarMovimiento(usuarioActivo, 'CREAR', 'Formaciones', resumen, detalle);
            
            return res.status(201).json(registrosCreados);
        }

        if (req.method === 'PUT') {
            const { id, grupo_id, aplicar_grupo, fecha_atencion, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, facilitador_id, estatus, participantes, duracion_curso, forzar } = req.body;
            
            if (!id) return res.status(400).json({ error: 'El ID es obligatorio para editar' });

            const cantParticipantes = parseInt(participantes) || 0;
            const idFacilitador = parseInt(facilitador_id) || null;
            const duracionFinal = duracion_curso || '-';

            // EDICIÓN EN BLOQUE (TODOS LOS DÍAS DEL GRUPO)
            if (aplicar_grupo && grupo_id) {
                const previoRes = await pool.query(
                    `SELECT * FROM clientes_agenda WHERE grupo_id = $1 ORDER BY fecha_atencion ASC`,
                    [grupo_id]
                );
                if (previoRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Bloque no encontrado en la base de datos' });
                }

                const validacionGrupo = await pool.query(
                    `SELECT DISTINCT TO_CHAR(fecha_atencion, 'DD/MM/YYYY') AS fecha_choque
                     FROM clientes_agenda
                     WHERE facilitador = $1
                       AND DATE(fecha_atencion) IN (SELECT DATE(fecha_atencion) FROM clientes_agenda WHERE grupo_id = $2)
                       AND (grupo_id IS NULL OR grupo_id != $2)`,
                    [facilitador, grupo_id]
                );

                if (validacionGrupo.rows.length > 0 && !forzar) {
                    const fechasConflicto = validacionGrupo.rows.map(r => r.fecha_choque).join(', ');
                    return res.status(409).json({
                        confirmacion_requerida: true,
                        error: `⚠️ AUTORIZACIÓN REQUERIDA\n\nEl facilitador ${facilitador} ya tiene otra formación asignada en las siguientes fechas del bloque: ${fechasConflicto}.\n\n¿Autorizas aplicar este cambio a todos los días?`
                    });
                }

                const horaNueva = fecha_atencion.includes('T') ? fecha_atencion.split('T')[1] : '08:00:00';
                const prev = previoRes.rows[0];

                const result = await pool.query(
                    `UPDATE clientes_agenda
                     SET fecha_atencion = (fecha_atencion::date + $1::time),
                         nombre_cliente = $2,
                         lugar_atencion = $3,
                         ciudad = $4,
                         accion_formacion = $5,
                         facilitador = $6,
                         facilitador_id = $7,
                         estatus = $8,
                         participantes = $9,
                         duracion_curso = $10
                     WHERE grupo_id = $11 RETURNING *`,
                    [horaNueva, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, idFacilitador, estatus, cantParticipantes, duracionFinal, grupo_id]
                );

                let cambios = [];
                const horaPrev = extraerHoraHHMM(prev.fecha_atencion);
                const horaAct = horaNueva.substring(0, 5);
                if (horaPrev !== horaAct) cambios.push(`Hora: ${horaPrev} → ${horaAct}`);
                if (prev.nombre_cliente !== nombre_cliente) cambios.push(`Cliente: ${prev.nombre_cliente} → ${nombre_cliente}`);
                if (prev.accion_formacion !== accion_formacion) cambios.push(`Acción: ${prev.accion_formacion} → ${accion_formacion}`);
                if (prev.lugar_atencion !== lugar_atencion) cambios.push(`Lugar: ${prev.lugar_atencion} → ${lugar_atencion}`);
                if (prev.ciudad !== ciudad) cambios.push(`Ciudad: ${prev.ciudad} → ${ciudad}`);
                if (Number(prev.participantes) !== cantParticipantes) cambios.push(`Part.: ${prev.participantes} → ${cantParticipantes}`);
                if ((prev.duracion_curso || '-') !== duracionFinal) cambios.push(`Duración: ${prev.duracion_curso || '-'} → ${duracionFinal}`);
                if (prev.facilitador !== facilitador) cambios.push(`Facilitador: ${prev.facilitador} → ${facilitador}`);
                if (prev.estatus !== estatus) cambios.push(`Estatus: ${prev.estatus.toUpperCase()} → ${estatus.toUpperCase()}`);

                await registrarMovimiento(
                    usuarioActivo,
                    'EDITAR',
                    'Formaciones',
                    `Bloque editado (${result.rowCount} días): ${nombre_cliente} - ${accion_formacion}`,
                    cambios.length > 0 ? cambios.join(' | ') : 'Actualización de bloque sin cambios en valores'
                );

                return res.status(200).json(result.rows);
            }

            // EDICIÓN INDIVIDUAL (UN SOLO DÍA)
            const previoIndivRes = await pool.query('SELECT * FROM clientes_agenda WHERE id = $1', [id]);
            if (previoIndivRes.rows.length === 0) {
                return res.status(404).json({ error: 'Registro no encontrado en la base de datos' });
            }
            const prev = previoIndivRes.rows[0];

            const validacionTurno = await pool.query(
                `SELECT id FROM clientes_agenda WHERE facilitador = $1 AND DATE(fecha_atencion) = DATE($2) AND id != $3`,
                [facilitador, fecha_atencion, id]
            );
            
            if (validacionTurno.rows.length > 0 && !forzar) {
                const fechaCorta = formatearFechaISO(fecha_atencion);
                return res.status(409).json({ 
                    confirmacion_requerida: true, 
                    error: `⚠️ AUTORIZACIÓN REQUERIDA\n\nEl facilitador ${facilitador} ya tiene otra formación distinta asignada el día ${fechaCorta}.\n\n¿Autorizas asignarle esta formación doble?` 
                });
            }

            const result = await pool.query(
                `UPDATE clientes_agenda 
                 SET fecha_atencion = $1, nombre_cliente = $2, lugar_atencion = $3, ciudad = $4, accion_formacion = $5, facilitador = $6, facilitador_id = $7, estatus = $8, participantes = $9, duracion_curso = $10
                 WHERE id = $11 RETURNING *`,
                [fecha_atencion, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, idFacilitador, estatus, cantParticipantes, duracionFinal, id]
            );

            let cambios = [];
            const fechaHoraPrev = formatearFechaHora(prev.fecha_atencion);
            const fechaHoraAct = formatearFechaHora(fecha_atencion);
            if (fechaHoraPrev !== fechaHoraAct) cambios.push(`Fecha/Hora: ${fechaHoraPrev} → ${fechaHoraAct}`);
            if (prev.nombre_cliente !== nombre_cliente) cambios.push(`Cliente: ${prev.nombre_cliente} → ${nombre_cliente}`);
            if (prev.accion_formacion !== accion_formacion) cambios.push(`Acción: ${prev.accion_formacion} → ${accion_formacion}`);
            if (prev.lugar_atencion !== lugar_atencion) cambios.push(`Lugar: ${prev.lugar_atencion} → ${lugar_atencion}`);
            if (prev.ciudad !== ciudad) cambios.push(`Ciudad: ${prev.ciudad} → ${ciudad}`);
            if (Number(prev.participantes) !== cantParticipantes) cambios.push(`Part.: ${prev.participantes} → ${cantParticipantes}`);
            if ((prev.duracion_curso || '-') !== duracionFinal) cambios.push(`Duración: ${prev.duracion_curso || '-'} → ${duracionFinal}`);
            if (prev.facilitador !== facilitador) cambios.push(`Facilitador: ${prev.facilitador} → ${facilitador}`);
            if (prev.estatus !== estatus) cambios.push(`Estatus: ${prev.estatus.toUpperCase()} → ${estatus.toUpperCase()}`);

            await registrarMovimiento(
                usuarioActivo,
                'EDITAR',
                'Formaciones',
                `Formación editada: ${nombre_cliente} - ${accion_formacion} (${formatearFechaISO(fecha_atencion)})`,
                cambios.length > 0 ? cambios.join(' | ') : 'Sin cambios relevantes'
            );

            return res.status(200).json(result.rows[0]);
        }
        
        if (req.method === 'DELETE') {
            const { id, grupo_id, borrar_grupo } = req.body;

            if (borrar_grupo && grupo_id) {
                const prevGrupo = await pool.query(
                    'SELECT * FROM clientes_agenda WHERE grupo_id = $1 ORDER BY fecha_atencion ASC',
                    [grupo_id]
                );
                await pool.query('DELETE FROM clientes_agenda WHERE grupo_id = $1', [grupo_id]);

                if (prevGrupo.rows.length > 0) {
                    const primero = prevGrupo.rows[0];
                    const fechasBorradas = prevGrupo.rows.map(r => formatearFechaISO(r.fecha_atencion)).join(', ');
                    await registrarMovimiento(
                        usuarioActivo,
                        'ELIMINAR',
                        'Formaciones',
                        `Bloque eliminado (${prevGrupo.rows.length} días): ${primero.nombre_cliente} - ${primero.accion_formacion}`,
                        `Fechas eliminadas: ${fechasBorradas} | Facilitador: ${primero.facilitador}`
                    );
                }
                return res.status(200).json({ message: 'Bloque de formaciones borrado' });
            }

            const prevIndiv = await pool.query('SELECT * FROM clientes_agenda WHERE id = $1', [id]);
            await pool.query('DELETE FROM clientes_agenda WHERE id = $1', [id]);

            if (prevIndiv.rows.length > 0) {
                const reg = prevIndiv.rows[0];
                await registrarMovimiento(
                    usuarioActivo,
                    'ELIMINAR',
                    'Formaciones',
                    `Formación eliminada: ${reg.nombre_cliente} - ${reg.accion_formacion}`,
                    `Fecha: ${formatearFechaHora(reg.fecha_atencion)} | Facilitador: ${reg.facilitador} | Lugar: ${reg.lugar_atencion} (${reg.ciudad})`
                );
            }

            return res.status(200).json({ message: 'Cliente borrado' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
        
    } catch (error) {
        console.error("🚨 ERROR EN API CLIENTES:", error);
        return res.status(500).json({ error: 'Error interno en el servidor', detalle: error.message });
    }
}
