import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function registrarMovimiento(usuario, accion, modulo, resumen, cambiosDetalle = '') {
    try {
        await pool.query(
            `INSERT INTO historial_movimientos (usuario, accion, modulo, resumen, cambios_detalle, fecha_hora)
             VALUES ($1, $2, $3, $4, $5, NOW() AT TIME ZONE 'America/Caracas')`,
            [usuario || 'Admin', accion, modulo, resumen, cambiosDetalle]
        );
    } catch (err) {
        console.error('Error registrando movimiento en tareas:', err);
    }
}

async function obtenerColumnasTareas() {
    const colsRes = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tareas'
    `);
    return new Set(colsRes.rows.map(r => r.column_name));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-nombre, x-user-rol');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuarioActivo = req.body?.usuario_solicitante || req.headers['x-user-nombre'] || 'Admin';

    try {
        const cols = await obtenerColumnasTareas();

        if (req.method === 'GET') {
            const tieneProgramaId = cols.has('programa_id');
            const query = tieneProgramaId
                ? `SELECT t.*,
                          c.nombre_cliente,
                          c.accion_formacion,
                          c.fecha_atencion AS fecha_programa,
                          c.lugar_atencion,
                          c.ciudad,
                          c.facilitador,
                          pf.foto_url AS facilitador_foto,
                          pr.foto_url AS responsable_foto
                   FROM tareas t
                   LEFT JOIN clientes_agenda c ON t.programa_id = c.id
                   LEFT JOIN personal pf ON c.facilitador_id = pf.id
                   LEFT JOIN personal pr ON t.responsable = pr.nombre
                   ORDER BY t.fecha_limite ASC`
                : `SELECT t.*,
                          pr.foto_url AS responsable_foto
                   FROM tareas t
                   LEFT JOIN personal pr ON t.responsable = pr.nombre
                   ORDER BY t.fecha_limite ASC`;

            const result = await pool.query(query);
            return res.status(200).json(result.rows);
        }

        if (req.method === 'POST') {
            const { tipo_tarea, programa_id, responsable, descripcion, fecha_limite, urgencia } = req.body;
            const progId = tipo_tarea === 'vinculada' && programa_id ? parseInt(programa_id) : null;

            const campos = [];
            const valores = [];
            const placeholders = [];

            const agregar = (col, val, esSqlCrudo = false) => {
                if (cols.has(col)) {
                    campos.push(`"${col}"`);
                    if (esSqlCrudo) {
                        placeholders.push(val);
                    } else {
                        valores.push(val);
                        placeholders.push(`$${valores.length}`);
                    }
                }
            };

            agregar('tipo_tarea', tipo_tarea || 'aislada');
            agregar('programa_id', progId);
            agregar('responsable', responsable);
            agregar('descripcion', descripcion);
            agregar('fecha_limite', fecha_limite);
            agregar('urgencia', urgencia || 'rutina');
            agregar('completada', false);
            agregar('created_at', `NOW() AT TIME ZONE 'America/Caracas'`, true);

            const result = await pool.query(
                `INSERT INTO tareas (${campos.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
                valores
            );

            let infoVinculo = 'Tipo: Aislada';
            if (progId) {
                const progRes = await pool.query('SELECT nombre_cliente, accion_formacion FROM clientes_agenda WHERE id = $1', [progId]);
                if (progRes.rows.length > 0) {
                    infoVinculo = `Vinculada a: ${progRes.rows[0].nombre_cliente} (${progRes.rows[0].accion_formacion})`;
                }
            }

            await registrarMovimiento(
                usuarioActivo,
                'CREAR',
                'Tareas',
                `Función delegada a ${responsable}: ${descripcion.substring(0, 60)}`,
                `${infoVinculo} | Urgencia: ${(urgencia || 'rutina').toUpperCase()} | Límite: ${fecha_limite.replace('T', ' ')}`
            );

            return res.status(201).json(result.rows[0]);
        }

        if (req.method === 'PATCH') {
            const { id, accion } = req.body;
            const prevRes = await pool.query('SELECT * FROM tareas WHERE id = $1', [id]);
            if (prevRes.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
            const tarea = prevRes.rows[0];

            if (accion === 'proceso') {
                await pool.query(`UPDATE tareas SET urgencia = 'en_proceso' WHERE id = $1`, [id]);
                await registrarMovimiento(
                    `${tarea.responsable} (Tablero TV)`,
                    'EDITAR',
                    'Tareas',
                    `Función iniciada: ${tarea.descripcion.substring(0, 60)}`,
                    `Estatus: ${tarea.urgencia.toUpperCase()} → EN PROCESO`
                );
            } else {
                await pool.query(`UPDATE tareas SET completada = TRUE WHERE id = $1`, [id]);
                await registrarMovimiento(
                    `${tarea.responsable} (Tablero TV)`,
                    'EDITAR',
                    'Tareas',
                    `Función completada: ${tarea.descripcion.substring(0, 60)}`,
                    `Estatus: PENDIENTE → COMPLETADA`
                );
            }

            return res.status(200).json({ message: 'Tarea actualizada' });
        }

        if (req.method === 'DELETE') {
            const { id } = req.body;
            const prevRes = await pool.query('SELECT * FROM tareas WHERE id = $1', [id]);
            await pool.query('DELETE FROM tareas WHERE id = $1', [id]);

            if (prevRes.rows.length > 0) {
                const t = prevRes.rows[0];
                await registrarMovimiento(
                    usuarioActivo,
                    'ELIMINAR',
                    'Tareas',
                    `Función eliminada (${t.responsable}): ${t.descripcion.substring(0, 60)}`,
                    `Urgencia previa: ${t.urgencia.toUpperCase()} | Estado: ${t.completada ? 'Completada' : 'Pendiente'}`
                );
            }

            return res.status(200).json({ message: 'Tarea eliminada' });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error('🚨 ERROR EN API TAREAS:', error);
        return res.status(500).json({ error: 'Error al delegar función', detalle: error.message });
    }
}
