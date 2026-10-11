import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // GET: Leer todas las tareas
        if (req.method === 'GET') {
            const result = await pool.query('SELECT * FROM tareas_delegadas ORDER BY completada ASC, fecha_limite ASC');
            return res.status(200).json(result.rows);
        }

        // POST: Crear nueva tarea
        if (req.method === 'POST') {
            const { tipo_tarea, programa_id, responsable, descripcion, fecha_limite, urgencia } = req.body;
            // Si el programa_id viene vacío o no es vinculado, lo pasamos como null
            const prog_id = (tipo_tarea === 'vinculada' && programa_id) ? programa_id : null;

            const result = await pool.query(
                `INSERT INTO tareas_delegadas 
                (tipo_tarea, programa_id, responsable, descripcion, fecha_limite, urgencia) 
                VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [tipo_tarea, prog_id, responsable, descripcion, fecha_limite, urgencia]
            );
            return res.status(201).json(result.rows[0]);
        }

        // PATCH: Marcar tarea como completada
        if (req.method === 'PATCH') {
            const { id } = req.body;
            const result = await pool.query(
                'UPDATE tareas_delegadas SET completada = TRUE WHERE id = $1 RETURNING *',
                [id]
            );
            return res.status(200).json(result.rows[0]);
        }

        return res.status(405).json({ error: 'Método no permitido' });
        
    } catch (error) {
        console.error("Error en la base de datos:", error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}