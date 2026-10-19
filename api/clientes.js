import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            // Traemos todo, incluyendo la nueva columna 'participantes' gracias al "SELECT c.*"
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
            // 1. AHORA RECIBIMOS LA VARIABLE "participantes"
            let { fechas_atencion, logo_url, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, facilitador_id, estatus, participantes } = req.body;
            
            if (!fechas_atencion || fechas_atencion.length === 0) {
                return res.status(400).json({ error: 'Se requiere al menos una fecha.' });
            }

            // 2. Blindaje: Asegurarnos de que sea un número. Si viene vacío, lo ponemos en 0.
            const cantParticipantes = parseInt(participantes) || 0;

            for (let fecha of fechas_atencion) {
                const validacionTurno = await pool.query(
                    `SELECT id FROM clientes_agenda 
                     WHERE facilitador_id = $1 
                     AND DATE(fecha_atencion) = DATE($2)`,
                    [facilitador_id, fecha]
                );

                if (validacionTurno.rows.length > 0) {
                    let fechaCorta = fecha.split('T')[0];
                    return res.status(400).json({ 
                        error: `No se puede registrar. El facilitador ${facilitador} ya tiene una actividad el día ${fechaCorta}.` 
                    });
                }
            }
            
            let registrosCreados = [];
            for (let fecha of fechas_atencion) {
                // 3. INYECTAMOS LOS PARTICIPANTES EN LA BASE DE DATOS ($10)
                const result = await pool.query(
                    `INSERT INTO clientes_agenda (fecha_atencion, logo_url, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, facilitador_id, estatus, participantes) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
                    [fecha, logo_url || null, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, facilitador_id, estatus, cantParticipantes]
                );
                registrosCreados.push(result.rows[0]);
            }
            
            return res.status(201).json(registrosCreados);
        }
        
        if (req.method === 'DELETE') {
            const { id } = req.body;
            await pool.query('DELETE FROM clientes_agenda WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Cliente borrado' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
        
    } catch (error) {
        console.error("🚨 ERROR EN API CLIENTES:", error);
        return res.status(500).json({ error: 'Error interno', detalle: error.message });
    }
}
