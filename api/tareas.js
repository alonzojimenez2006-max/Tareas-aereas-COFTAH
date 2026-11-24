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
        console.error('Error registrando movimiento en tareas_delegadas:', err);
    }
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
        const colsRes = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tareas_delegadas'
            ORDER BY ordinal_position ASC
        `);
        const schemaCols = colsRes.rows;
        const nombresCols = new Set(schemaCols.map(c => c.column_name));

        if (req.method === 'GET') {
            const tieneProgramaId = nombresCols.has('programa_id');
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
                   FROM tareas_delegadas t
                   LEFT JOIN clientes_agenda c ON t.programa_id = c.id
                   LEFT JOIN personal pf ON c.facilitador_id = pf.id
                   LEFT JOIN personal pr ON t.responsable = pr.nombre
                   ORDER BY t.fecha_limite ASC`
                : `SELECT t.*,
                          pr.foto_url AS responsable_foto
                   FROM tareas_delegadas t
                   LEFT JOIN personal pr ON t.responsable = pr.nombre
                   ORDER BY t.fecha_limite ASC`;

            const result = await pool.query(query);
            return res.status(200).json(result.rows);
        }

        if (req.method === 'POST') {
            const { tipo_tarea, programa_id, responsable, descripcion, fecha_limite, urgencia } = req.body;
            const progId = tipo_tarea === 'vinculada' && programa_id ? parseInt(programa_id) : null;

            const mapaValores = {
                tipo_tarea: tipo_tarea || 'aislada',
                programa_id: progId,
                responsable: responsable,
                descripcion: descripcion,
                fecha_limite: fecha_limite,
                urgencia: urgencia || 'rutina',
                completada: false
            };

            const campos = [];
            const valores = [];
            const placeholders = [];

            for (const col of schemaCols) {
                const nombre = col.column_name;
                if (nombre === 'id') continue;

                if (nombre === 'created_at' || nombre === 'fecha_creacion') {
                    campos.push(`"${nombre}"`);
                    placeholders.push(`NOW() AT TIME ZONE 'America/Caracas'`);
                    continue;
                }

                if (Object.prototype.hasOwnProperty.call(mapaValores, nombre)) {
                    campos.push(`"${nombre}"`);
                    valores.push(mapaValores[nombre]);
                    placeholders.push(`$${valores.length}`);
                } else if (col.is_nullable === 'NO' && !col.column_default) {
                    let fallback = '';
                    if (col.data_type.includes('int') || col.data_type.includes('numeric')) fallback = 0;
                    else if (col.data_type === 'boolean') fallback = false;
                    else if (col.data_type.includes('timestamp') || col.data_type === 'date') fallback = fecha_limite;

                    campos.push(`"${nombre}"`);
                    valores.push(fallback);
                    placeholders.push(`$${valores.length}`);
                }
            }

            const result = await pool.query(
                `INSERT INTO tareas_delegadas (${campos.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
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
            const prevRes = await pool.query('SELECT * FROM tareas_delegadas WHERE id = $1', [id]);
            if (prevRes.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
            const tarea = prevRes.rows[0];
            const desc = tarea.descripcion || '';

            if (accion === 'proceso') {
                await pool.query(`UPDATE tareas_delegadas SET urgencia = 'en_proceso' WHERE id = $1`, [id]);
                await registrarMovimiento(
                    `${tarea.responsable} (Tablero TV)`,
                    'EDITAR',
                    'Tareas',
                    `Función iniciada: ${desc.substring(0, 60)}`,
                    `Estatus: ${(tarea.urgencia || '').toUpperCase()} → EN PROCESO`
                );
            } else {
                await pool.query(`UPDATE tareas_delegadas SET completada = TRUE WHERE id = $1`, [id]);
                await registrarMovimiento(
                    `${tarea.responsable} (Tablero TV)`,
                    'EDITAR',
                    'Tareas',
                    `Función completada: ${desc.substring(0, 60)}`,
                    `Estatus: PENDIENTE → COMPLETADA`
                );
            }

            return res.status(200).json({ message: 'Tarea actualizada' });
        }

        if (req.method === 'DELETE') {
            const { id } = req.body;
            const prevRes = await pool.query('SELECT * FROM tareas_delegadas WHERE id = $1', [id]);
            await pool.query('DELETE FROM tareas_delegadas WHERE id = $1', [id]);

            if (prevRes.rows.length > 0) {
                const t = prevRes.rows[0];
                const desc = t.descripcion || '';
                await registrarMovimiento(
                    usuarioActivo,
                    'ELIMINAR',
                    'Tareas',
                    `Función eliminada (${t.responsable}): ${desc.substring(0, 60)}`,
                    `Urgencia previa: ${(t.urgencia || '').toUpperCase()}`
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
