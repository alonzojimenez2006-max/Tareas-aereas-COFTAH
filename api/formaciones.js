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

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // LEER EL DIRECTORIO
        if (req.method === 'GET') {
            const result = await pool.query('SELECT * FROM directorio_formaciones ORDER BY nombre ASC');
            return res.status(200).json(result.rows);
        }
        
        // GUARDAR NUEVA FORMACIÓN
        if (req.method === 'POST') {
            const { nombre } = req.body;
            if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
            
            const result = await pool.query(
                'INSERT INTO directorio_formaciones (nombre) VALUES ($1) RETURNING *',
                [nombre.trim()]
            );
            return res.status(201).json(result.rows[0]);
        }
        
        // BORRAR FORMACIÓN
        if (req.method === 'DELETE') {
            const { id } = req.body;
            await pool.query('DELETE FROM directorio_formaciones WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Formación borrada' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
        
    } catch (error) {
        console.error("🚨 ERROR API FORMACIONES:", error);
        if (error.code === '23505') { // Código de error de Postgres para "Elemento Duplicado"
            return res.status(400).json({ error: 'Esta formación ya existe en el directorio.' });
        }
        return res.status(500).json({ error: 'Error interno en el servidor', detalle: error.message });
    }
}