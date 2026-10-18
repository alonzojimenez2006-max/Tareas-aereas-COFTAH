import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
    // 1. CORS y Destrucción ESTRICTA de Caché para Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // MÉTODO GET: Obtener todos los clientes programados
        if (req.method === 'GET') {
            const result = await pool.query('SELECT * FROM clientes_agenda ORDER BY fecha_atencion ASC');
            return res.status(200).json(result.rows);
        }
        
        // MÉTODO POST: Registrar nuevo cliente (AHORA MULTI-DÍA)
        if (req.method === 'POST') {
            // Recibimos "fechas_atencion" como un arreglo (array) de fechas
            let { fechas_atencion, logo_url, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, estatus } = req.body;
            
            // Validación 1: Logo Opcional Seguro
            if (!logo_url || logo_url.trim() === '') {
                logo_url = 'COFTAH.png.png';
            }

            // Validar que se reciba al menos una fecha
            if (!fechas_atencion || fechas_atencion.length === 0) {
                return res.status(400).json({ error: 'Se requiere al menos una fecha para la formación.' });
            }

            // Validación 2: Prevención de doble turno (Revisamos todos los días solicitados)
            for (let fecha of fechas_atencion) {
                const validacionTurno = await pool.query(
                    `SELECT id FROM clientes_agenda 
                     WHERE facilitador = $1 
                     AND DATE(fecha_atencion) = DATE($2)`,
                    [facilitador, fecha]
                );

                if (validacionTurno.rows.length > 0) {
                    let fechaCorta = fecha.split('T')[0]; // Extrae solo el año-mes-día para el mensaje
                    return res.status(400).json({ 
                        error: `No se puede registrar. El facilitador ${facilitador} ya tiene una actividad asignada para el día ${fechaCorta}.` 
                    });
                }
            }
            
            // Inserción en la base de datos (Un registro independiente por cada día)
            let registrosCreados = [];
            for (let fecha of fechas_atencion) {
                const result = await pool.query(
                    `INSERT INTO clientes_agenda (fecha_atencion, logo_url, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, estatus) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                    [fecha, logo_url, nombre_cliente, lugar_atencion, ciudad, accion_formacion, facilitador, estatus]
                );
                registrosCreados.push(result.rows[0]);
            }
            
            // Devolvemos todos los registros creados
            return res.status(201).json(registrosCreados);
        }
        
        // MÉTODO DELETE: Borrar cliente
        if (req.method === 'DELETE') {
            const { id } = req.body;
            
            if (!id) {
                return res.status(400).json({ error: 'Se requiere un ID para eliminar.' });
            }

            await pool.query('DELETE FROM clientes_agenda WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Cliente borrado correctamente' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
        
    } catch (error) {
        console.error("🚨 ERROR EN API CLIENTES:", error);
        return res.status(500).json({ 
            error: 'Error interno en el servidor', 
            detalle: error.message
        });
    }
}
