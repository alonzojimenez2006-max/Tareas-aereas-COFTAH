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

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        try {
            const { rows } = await pool.query('SELECT * FROM personal ORDER BY nombre ASC');
            return res.status(200).json(rows);
        } catch (error) {
            return res.status(500).json({ error: 'Error al obtener el personal: ' + error.message });
        }
    }

    if (req.method === 'POST') {
        const { nombre, rol } = req.body;
        if (!nombre || !rol) return res.status(400).json({ error: 'El nombre y el rol son obligatorios.' });

        try {
            const { rows } = await pool.query('INSERT INTO personal (nombre, rol) VALUES ($1, $2) RETURNING *', [nombre.trim(), rol]);
            return res.status(201).json({ mensaje: 'Personal registrado con éxito', personal: rows[0] });
        } catch (error) {
            if (error.code === '23505') return res.status(400).json({ error: 'Error: Esta persona ya está registrada.' });
            return res.status(500).json({ error: 'Error interno: ' + error.message });
        }
    }

    if (req.method === 'DELETE') {
        const { id } = req.body;
        try {
            await pool.query('DELETE FROM personal WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Personal borrado correctamente' });
        } catch (error) {
            if (error.code === '23503') return res.status(400).json({ error: 'No se puede borrar. Ya tiene clientes o funciones asignadas.' });
            return res.status(500).json({ error: 'Error al intentar borrar: ' + error.message });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
