const { Pool } = require('pg');

// Asegúrate de usar la misma configuración de conexión que ya tienes en api/clientes.js
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
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

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Metodo ${req.method} no permitido`);
}