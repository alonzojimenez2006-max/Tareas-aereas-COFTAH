import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function registrarMovimiento(usuario, accion, modulo, resumen, cambiosDetalle = '') {
    try {
        await pool.query(
            `INSERT INTO historial_movimientos (usuario, accion, modulo, resumen, cambios_detalle, fecha_hora)
             VALUES ($1, $2, $3, $4, $5, NOW() AT TIME ZONE 'America/Caracas')`,
            [usuario || 'Sistema', accion, modulo, resumen, cambiosDetalle]
        );
    } catch (err) {
        console.error('Error registrando movimiento de usuario:', err);
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-rol, x-user-nombre');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // LISTAR USUARIOS (Solo accesible para Master)
        if (req.method === 'GET') {
            const rolSolicitante = req.headers['x-user-rol'] || req.query.rol;
            if (rolSolicitante !== 'master') {
                return res.status(403).json({ error: 'Acceso denegado. Solo el usuario Maestro puede gestionar cuentas.' });
            }

            const result = await pool.query(`
                SELECT id, nombre, usuario, password, rol, activo, fecha_creacion
                FROM usuarios_admin
                ORDER BY CASE WHEN rol = 'master' THEN 0 ELSE 1 END, id ASC
            `);
            return res.status(200).json(result.rows);
        }

        // INICIAR SESIÓN O CREAR NUEVO USUARIO ADMIN
        if (req.method === 'POST') {
            const { action } = req.body;

            // --- CASO A: LOGIN ---
            if (action === 'login') {
                const { usuario, password } = req.body;
                if (!usuario || !password) {
                    return res.status(400).json({ error: 'Ingresa tu usuario y contraseña.' });
                }

                const result = await pool.query(
                    `SELECT id, nombre, usuario, rol, activo
                     FROM usuarios_admin
                     WHERE LOWER(TRIM(usuario)) = LOWER(TRIM($1)) AND password = $2`,
                    [usuario, password]
                );

                if (result.rows.length === 0) {
                    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
                }

                const user = result.rows[0];
                if (!user.activo) {
                    return res.status(403).json({ error: 'Este usuario está desactivado. Contacta al administrador Maestro.' });
                }

                return res.status(200).json({
                    id: user.id,
                    nombre: user.nombre,
                    usuario: user.usuario,
                    rol: user.rol
                });
            }

            // --- CASO B: CREAR NUEVO USUARIO (Solo Master) ---
            const { nombre, usuario, password, rol_solicitante, usuario_solicitante } = req.body;

            if (rol_solicitante !== 'master') {
                return res.status(403).json({ error: 'Solo el usuario Maestro puede crear nuevos usuarios.' });
            }

            if (!nombre || !usuario || !password) {
                return res.status(400).json({ error: 'Todos los campos (Nombre, Usuario y Contraseña) son obligatorios.' });
            }

            const usuarioLimpio = usuario.trim().toLowerCase();

            const insert = await pool.query(
                `INSERT INTO usuarios_admin (nombre, usuario, password, rol, activo, fecha_creacion)
                 VALUES ($1, $2, $3, 'admin', TRUE, NOW() AT TIME ZONE 'America/Caracas')
                 RETURNING id, nombre, usuario, rol, activo`,
                [nombre.trim(), usuarioLimpio, password]
            );

            await registrarMovimiento(
                usuario_solicitante,
                'CREAR',
                'Usuarios',
                `Nuevo usuario Admin: ${nombre.trim()} (@${usuarioLimpio})`,
                `Rol asignado: Admin | Estado: Activo`
            );

            return res.status(201).json(insert.rows[0]);
        }

        // EDITAR USUARIO EXISTENTE (Solo Master)
        if (req.method === 'PUT') {
            const { id, nombre, usuario, password, activo, rol_solicitante, usuario_solicitante } = req.body;

            if (rol_solicitante !== 'master') {
                return res.status(403).json({ error: 'Solo el usuario Maestro puede editar usuarios.' });
            }

            if (!id || !nombre || !usuario || !password) {
                return res.status(400).json({ error: 'Faltan datos obligatorios para actualizar el usuario.' });
            }

            const previoRes = await pool.query('SELECT * FROM usuarios_admin WHERE id = $1', [id]);
            if (previoRes.rows.length === 0) {
                return res.status(404).json({ error: 'Usuario no encontrado.' });
            }

            const previo = previoRes.rows[0];
            const usuarioLimpio = usuario.trim().toLowerCase();
            // Si es la cuenta Maestro, siempre se mantiene activa y con rol master
            const estadoFinal = previo.rol === 'master' ? true : Boolean(activo);

            const update = await pool.query(
                `UPDATE usuarios_admin
                 SET nombre = $1, usuario = $2, password = $3, activo = $4
                 WHERE id = $5
                 RETURNING id, nombre, usuario, rol, activo`,
                [nombre.trim(), usuarioLimpio, password, estadoFinal, id]
            );

            let cambios = [];
            if (previo.nombre !== nombre.trim()) cambios.push(`Nombre: ${previo.nombre} → ${nombre.trim()}`);
            if (previo.usuario !== usuarioLimpio) cambios.push(`Usuario: @${previo.usuario} → @${usuarioLimpio}`);
            if (previo.password !== password) cambios.push(`Contraseña actualizada`);
            if (previo.activo !== estadoFinal) cambios.push(`Estado: ${previo.activo ? 'Activo' : 'Inactivo'} → ${estadoFinal ? 'Activo' : 'Inactivo'}`);

            await registrarMovimiento(
                usuario_solicitante,
                'EDITAR',
                'Usuarios',
                `Usuario actualizado: ${nombre.trim()} (@${usuarioLimpio})`,
                cambios.length > 0 ? cambios.join(' | ') : 'Sin cambios relevantes'
            );

            return res.status(200).json(update.rows[0]);
        }

        // ELIMINAR USUARIO ADMIN (Solo Master; protege la cuenta Master)
        if (req.method === 'DELETE') {
            const { id, rol_solicitante, usuario_solicitante } = req.body;

            if (rol_solicitante !== 'master') {
                return res.status(403).json({ error: 'Solo el usuario Maestro puede eliminar usuarios.' });
            }

            const targetRes = await pool.query('SELECT * FROM usuarios_admin WHERE id = $1', [id]);
            if (targetRes.rows.length === 0) {
                return res.status(404).json({ error: 'Usuario no encontrado.' });
            }

            const target = targetRes.rows[0];
            if (target.rol === 'master') {
                return res.status(400).json({ error: 'La cuenta Maestro no puede ser eliminada, solo editada.' });
            }

            await pool.query('DELETE FROM usuarios_admin WHERE id = $1', [id]);

            await registrarMovimiento(
                usuario_solicitante,
                'ELIMINAR',
                'Usuarios',
                `Usuario eliminado: ${target.nombre} (@${target.usuario})`,
                `Acceso revocado permanentemente`
            );

            return res.status(200).json({ message: 'Usuario eliminado correctamente.' });
        }

        return res.status(405).json({ error: 'Método no permitido' });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Ese nombre de usuario ya está registrado. Elige otro.' });
        }
        console.error('🚨 ERROR EN API USUARIOS:', error);
        return res.status(500).json({ error: 'Error interno en el servidor', detalle: error.message });
    }
}
