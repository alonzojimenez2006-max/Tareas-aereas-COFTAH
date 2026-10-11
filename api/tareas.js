import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            // NUEVO: El LEFT JOIN cruza las tablas para traernos el 'nombre_cliente' si la tarea está vinculada
            const result = await pool.query(`
                SELECT t.*, c.nombre_cliente 
                FROM tareas_delegadas t 
                LEFT JOIN clientes_agenda c ON t.programa_id = c.id 
                ORDER BY t.completada ASC, t.fecha_limite ASC
            `);
            return res.status(200).json(result.rows);
        }
        
        if (req.method === 'POST') {
            const { tipo_tarea, programa_id, responsable, descripcion, fecha_limite, urgencia } = req.body;
            const prog_id = (tipo_tarea === 'vinculada' && programa_id) ? programa_id : null;
            const result = await pool.query(
                `INSERT INTO tareas_delegadas (tipo_tarea, programa_id, responsable, descripcion, fecha_limite, urgencia) 
                VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [tipo_tarea, prog_id, responsable, descripcion, fecha_limite, urgencia]
            );
            return res.status(201).json(result.rows[0]);
        }
        
        if (req.method === 'PATCH') {
            const { id } = req.body;
            const result = await pool.query('UPDATE tareas_delegadas SET completada = TRUE WHERE id = $1 RETURNING *', [id]);
            return res.status(200).json(result.rows[0]);
        }
        
        if (req.method === 'DELETE') {
            const { id } = req.body;
            await pool.query('DELETE FROM tareas_delegadas WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Tarea borrada' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error("Error en API de Tareas:", error);
        return res.status(500).json({ error: 'Error interno', detalle: error.message });
    }
}
