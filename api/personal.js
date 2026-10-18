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
            const result = await pool.query('SELECT * FROM personal ORDER BY rol, nombre');
            return res.status(200).json(result.rows);
        }
        
        if (req.method === 'POST') {
            const { nombre, rol, foto_url } = req.body;
            // Si no envían foto, guardamos un string vacío
            const foto = foto_url || '';
            const result = await pool.query(
                'INSERT INTO personal (nombre, rol, foto_url) VALUES ($1, $2, $3) RETURNING *',
                [nombre, rol, foto]
            );
            return res.status(201).json(result.rows[0]);
        }
        
        if (req.method === 'DELETE') {
            const { id } = req.body;
            await pool.query('DELETE FROM personal WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Personal borrado' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error("🚨 ERROR EN API PERSONAL:", error);
        return res.status(500).json({ error: 'Error interno', detalle: error.message });
    }
}
