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
        // MÉTODO GET: Obtener todo el personal
        if (req.method === 'GET') {
            const { rows } = await pool.query('SELECT * FROM personal ORDER BY nombre ASC');
            return res.status(200).json(rows);
        }

        // MÉTODO POST: Registrar nuevo personal
        if (req.method === 'POST') {
            const { nombre, rol } = req.body;
            
            if (!nombre || !rol) {
                return res.status(400).json({ error: 'El nombre y el rol son obligatorios.' });
            }

            const { rows } = await pool.query(
                'INSERT INTO personal (nombre, rol) VALUES ($1, $2) RETURNING *',
                [nombre.trim(), rol]
            );
            return res.status(201).json({ mensaje: 'Personal registrado con éxito', personal: rows[0] });
        }

        // MÉTODO DELETE: Borrar personal
        if (req.method === 'DELETE') {
            const { id } = req.body;
            
            if (!id) {
                return res.status(400).json({ error: 'Se requiere un ID para eliminar.' });
            }

            await pool.query('DELETE FROM personal WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Personal borrado correctamente' });
        }

        // Si intentan usar otro método (PUT, PATCH, etc.)
        return res.status(405).json({ error: 'Método no permitido' });

    } catch (error) {
        console.error("🚨 ERROR EN API PERSONAL:", error);
        
        // Código 23505: Nombre duplicado (Constraint UNIQUE)
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Error: Esta persona ya está registrada en el sistema.' });
        }
        // Código 23503: Violación de llave foránea (Persona con tareas/clientes asignados)
        if (error.code === '23503') {
            return res.status(400).json({ error: 'No se puede borrar. Esta persona ya tiene clientes o funciones asignadas en el historial. Borra sus registros primero.' });
        }
        
        return res.status(500).json({ error: 'Error interno: ' + error.message });
    }
}
