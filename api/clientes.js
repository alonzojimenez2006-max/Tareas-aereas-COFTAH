import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Añadido PUT
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
            let { fechas_atencion, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, facilitador_id, estatus, participantes, duracion_curso } = req.body;
            
            if (!fechas_atencion || fechas_atencion.length === 0) {
                return res.status(400).json({ error: 'Se requiere al menos una fecha.' });
            }

            const cantParticipantes = parseInt(participantes) || 0;
            const idFacilitador = parseInt(facilitador_id) || null;
            const duracionFinal = duracion_curso || '-'; 

            for (let fecha of fechas_atencion) {
                const validacionTurno = await pool.query(
                    `SELECT id FROM clientes_agenda WHERE facilitador = $1 AND DATE(fecha_atencion) = DATE($2)`,
                    [facilitador, fecha]
                );
                if (validacionTurno.rows.length > 0) {
                    let fechaCorta = fecha.split('T')[0];
                    return res.status(400).json({ error: `El facilitador ${facilitador} ya tiene una actividad el ${fechaCorta}.` });
                }
            }
            
            let registrosCreados = [];
            for (let fecha of fechas_atencion) {
                const result = await pool.query(
                    `INSERT INTO clientes_agenda (fecha_atencion, logo_url, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, facilitador_id, estatus, participantes, duracion_curso) 
                    VALUES ($1, 'default.png', $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
                    [fecha, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, idFacilitador, estatus, cantParticipantes, duracionFinal]
                );
                registrosCreados.push(result.rows[0]);
            }
            
            return res.status(201).json(registrosCreados);
        }

        // NUEVO MÉTODO PARA EDITAR (ACTUALIZAR)
        if (req.method === 'PUT') {
            const { id, fecha_atencion, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, facilitador_id, estatus, participantes, duracion_curso } = req.body;
            
            if (!id) return res.status(400).json({ error: 'El ID es obligatorio para editar' });

            const cantParticipantes = parseInt(participantes) || 0;
            const idFacilitador = parseInt(facilitador_id) || null;
            const duracionFinal = duracion_curso || '-';

            const result = await pool.query(
                `UPDATE clientes_agenda 
                 SET fecha_atencion = $1, 
                     nombre_cliente = $2, 
                     lugar_atencion = $3, 
                     ciudad = $4, 
                     accion_formacion = $5, 
                     facilitador = $6, 
                     facilitador_id = $7, 
                     estatus = $8, 
                     participantes = $9, 
                     duracion_curso = $10
                 WHERE id = $11 RETURNING *`,
                [fecha_atencion, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, idFacilitador, estatus, cantParticipantes, duracionFinal, id]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Registro no encontrado en la base de datos' });
            }

            return res.status(200).json(result.rows[0]);
        }
        
        if (req.method === 'DELETE') {
            const { id } = req.body;
            await pool.query('DELETE FROM clientes_agenda WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Cliente borrado' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
        
    } catch (error) {
        console.error("🚨 ERROR EN API CLIENTES:", error);
        return res.status(500).json({ error: 'Error interno en el servidor', detalle: error.message });
    }
}
