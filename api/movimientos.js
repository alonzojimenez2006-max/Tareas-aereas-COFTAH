import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-rol');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // OBTENER NOTIFICACIONES DEL DÍA PARA EL TABLERO (PC, TV Y TELÉFONOS)
        if (req.method === 'GET' && req.query.notif_hoy === '1') {
            const result = await pool.query(`
                SELECT id, usuario, accion, modulo, resumen, cambios_detalle, fecha_hora,
                       COALESCE(leido_notif, FALSE) AS leido_notif
                FROM historial_movimientos
                WHERE DATE(fecha_hora) = DATE(NOW() AT TIME ZONE 'America/Caracas')
                  AND accion = 'CREAR'
                  AND modulo IN ('Formaciones', 'Tareas')
                ORDER BY fecha_hora DESC, id DESC
            `);
            return res.status(200).json(result.rows);
        }

        // OBTENER HISTORIAL COMPLETO PARA EL PANEL ADMIN
        if (req.method === 'GET') {
            const result = await pool.query(`
                SELECT id, usuario, accion, modulo, resumen, cambios_detalle, fecha_hora
                FROM historial_movimientos
                ORDER BY fecha_hora DESC, id DESC
                LIMIT 300
            `);
            return res.status(200).json(result.rows);
        }

        // MARCAR GRUPO DE NOTIFICACIONES DEL DÍA COMO LEÍDAS EN TODOS LOS DISPOSITIVOS
        if (req.method === 'PATCH') {
            const { action } = req.body;
            if (action === 'marcar_leidas') {
                await pool.query(`
                    UPDATE historial_movimientos
                    SET leido_notif = TRUE
                    WHERE DATE(fecha_hora) = DATE(NOW() AT TIME ZONE 'America/Caracas')
                      AND accion = 'CREAR'
                      AND modulo IN ('Formaciones', 'Tareas')
                      AND COALESCE(leido_notif, FALSE) = FALSE
                `);
                return res.status(200).json({ message: 'Notificaciones del día marcadas como leídas.' });
            }
            return res.status(400).json({ error: 'Acción no válida.' });
        }

        // REGISTRAR MOVIMIENTO MANUAL
        if (req.method === 'POST') {
            const { usuario, accion, modulo, resumen, cambios_detalle } = req.body;
            if (!usuario || !accion || !modulo || !resumen) {
                return res.status(400).json({ error: 'Faltan campos obligatorios del movimiento.' });
            }

            const result = await pool.query(
                `INSERT INTO historial_movimientos (usuario, accion, modulo, resumen, cambios_detalle, fecha_hora)
                 VALUES ($1, $2, $3, $4, $5, NOW() AT TIME ZONE 'America/Caracas')
                 RETURNING *`,
                [usuario, accion, modulo, resumen, cambios_detalle || '']
            );
            return res.status(201).json(result.rows[0]);
        }

        // EDITAR REGISTRO DE AUDITORÍA (Exclusivo para Master)
        if (req.method === 'PUT') {
            const { id, usuario, accion, modulo, resumen, cambios_detalle, rol_solicitante } = req.body;

            if (rol_solicitante !== 'master') {
                return res.status(403).json({ error: 'Acceso denegado. Solo el usuario Maestro puede editar movimientos.' });
            }

            if (!id || !resumen) {
                return res.status(400).json({ error: 'El ID y el resumen son obligatorios.' });
            }

            const result = await pool.query(
                `UPDATE historial_movimientos
                 SET usuario = $1, accion = $2, modulo = $3, resumen = $4, cambios_detalle = $5
                 WHERE id = $6
                 RETURNING *`,
                [usuario, accion, modulo, resumen, cambios_detalle || '', id]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Registro de movimiento no encontrado.' });
            }

            return res.status(200).json(result.rows[0]);
        }

        // ELIMINAR REGISTRO DE AUDITORÍA (Exclusivo para Master)
        if (req.method === 'DELETE') {
            const { id, rol_solicitante } = req.body;

            if (rol_solicitante !== 'master') {
                return res.status(403).json({ error: 'Acceso denegado. Solo el usuario Maestro puede eliminar movimientos.' });
            }

            await pool.query('DELETE FROM historial_movimientos WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Movimiento eliminado.' });
        }

        return res.status(405).json({ error: 'Método no permitido' });

    } catch (error) {
        console.error('🚨 ERROR EN API MOVIMIENTOS:', error);
        return res.status(500).json({ error: 'Error interno en el servidor', detalle: error.message });
    }
}
