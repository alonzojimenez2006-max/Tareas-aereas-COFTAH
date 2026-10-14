import pkg from 'pg';
const { Pool } = pkg;

// Configuración de conexión compatible con tus otros archivos
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // 1. OBTENER EL PERSONAL (Para llenar las listas desplegables del Admin)
    if (req.method === 'GET') {
        try {
            const { rows } = await pool.query('SELECT * FROM personal ORDER BY nombre ASC');
            return res.status(200).json(rows);
        } catch (error) {
            return res.status(500).json({ error: 'Error al obtener el personal: ' + error.message });
        }
    }

    // 2. REGISTRAR NUEVO PERSONAL (Desde el panel Admin)
    if (req.method === 'POST') {
        const { nombre, rol } = req.body;

        if (!nombre || !rol) {
            return res.status(400).json({ error: 'El nombre y el rol son obligatorios.' });
        }

        try {
            const { rows } = await pool.query(
                'INSERT INTO personal (nombre, rol) VALUES ($1, $2) RETURNING *',
                [nombre.trim(), rol]
            );
            return res.status(201).json({ mensaje: 'Personal registrado con éxito', personal: rows[0] });
        } catch (error) {
            // Código 23505 es el error de PostgreSQL para valores únicos duplicados
            if (error.code === '23505') { 
                return res.status(400).json({ error: 'Error: Esta persona ya está registrada en el sistema.' });
            }
            return res.status(500).json({ error: 'Error interno: ' + error.message });
        }
    }

    // 3. BORRAR PERSONAL (Desde la pestaña de Gestión General)
    if (req.method === 'DELETE') {
        const { id } = req.body;
        try {
            await pool.query('DELETE FROM personal WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Personal borrado correctamente' });
        } catch (error) {
            // El código 23503 salta si la persona ya está vinculada a un cliente o tarea en el historial
            if (error.code === '23503') {
                return res.status(400).json({ error: 'No se puede borrar a esta persona porque ya tiene clientes o funciones asignadas. Borra primero sus tareas.' });
            }
            return res.status(500).json({ error: 'Error al intentar borrar: ' + error.message });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
