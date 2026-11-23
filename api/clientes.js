import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function formatearFechaISO(fechaStr) {
    if (!fechaStr) return '';
    const soloFecha = String(fechaStr).split('T')[0];
    const partes = soloFecha.split('-');
    if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
    return soloFecha;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

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

                if (result.rowCount === 0) return res.status(404).json({ error: 'Bloque no encontrado en la base de datos' });
                return res.status(200).json(result.rows);
            }

            // EDICIÓN INDIVIDUAL (UN SOLO DÍA)
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

            if (result.rowCount === 0) return res.status(404).json({ error: 'Registro no encontrado en la base de datos' });
            return res.status(200).json(result.rows[0]);
        }
        
        if (req.method === 'DELETE') {
            const { id, grupo_id, borrar_grupo } = req.body;

            if (borrar_grupo && grupo_id) {
                await pool.query('DELETE FROM clientes_agenda WHERE grupo_id = $1', [grupo_id]);
                return res.status(200).json({ message: 'Bloque de formaciones borrado' });
            }

            await pool.query('DELETE FROM clientes_agenda WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Cliente borrado' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
        
    } catch (error) {
        console.error("🚨 ERROR EN API CLIENTES:", error);
        return res.status(500).json({ error: 'Error interno en el servidor', detalle: error.message });
    }
}
