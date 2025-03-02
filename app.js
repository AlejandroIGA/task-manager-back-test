const express = require('express');
const bodyParser = require("body-parser");
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Filter } = require('firebase-admin/firestore');
const serviceAccount = require('./firebaseKey1.json');

const app = express();
const port = 3000;

const SECRET_KEY = '3$taE$UnaClav3D3$3gur1dad';

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());



initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});

app.get('/login', async (req, res) => {
    let user = req.headers["user"];
    let psw = req.headers["psw"];

    if (!user || !psw) {
        return res.status(400).json({ msg: "Faltan datos" });
    }

    const userRef = db.collection('users');
    const registers = await userRef.where('user', '==', user).get();

    if (registers.empty) {
        return res.status(400).json({ msg: "Credenciales incorrectas" });
    }

    const doc = registers.docs[0];
    const userData = doc.data();
    const userId = doc.id;

    const isMatch = await bcrypt.compare(psw, userData.psw);

    if (!isMatch) {
        return res.status(400).json({ msg: "Credenciales incorrectas" });
    }

    // Actualizar el campo lastLogin
    await userRef.doc(userId).update({
        lastLogin: new Date()
    });

    // Crear token JWT
    const token = jwt.sign(
        { id: userId, user: userData.user, email: userData.email },
        SECRET_KEY,
        { expiresIn: '10m' }
    );

    return res.status(200).json({
        msg: "Credenciales correctas",
        token,
        user: user,
        rol: doc.data().rol
    });
});


app.post('/register', async (req, res) => {
    let { user, psw, email, rol } = req.body;

    console.log(user, psw, email, rol)

    if (!user || !psw || !email || !rol) {
        return res.status(400).json({ msg: "Debe completar todos los campos" });
    }

    //Verificar si el usuario o correo ya existen
    const userRef = db.collection('users');
    const registers = await userRef
        .where(Filter.or(
            Filter.where('user', '==', user),
            Filter.where('email', '==', email),
        )
        ).get();

    if (registers.empty) {
        console.log('Se registrará el nuevo usuario')
        const hash = await bcrypt.hash(psw, 10);
        let data = {
            user: user,
            psw: hash,
            email: email,
            rol: rol,
        }
        try {
            const response = await db.collection('users').add(data);
            if (response.id) {
                return res.status(201).json({ msg: "Registro realizado con éxito" });
            } else {
                return res.status(500).json({ msg: "Error al registrar usuario" });
            }
        } catch (error) {
            return res.status(500).json({ msg: "Error al registrar usuario" });
        }
    } else {
        console.log('este usuario ya existe')
        return res.status(400).json({ msg: "El correo o usuario ya están registrados" });
    }
});

app.post('/tasks', async (req, res) => {
    let { name, description, category, status, date, user, group, assignedUser } = req.body;

    if (!name || !description || !category || !status || !date) {
        return res.status(400).json({ msg: "Debe completar todos los campos" });
    }

    let data = {
        name: name,
        description: description,
        category: category,
        status: status,
        date: new Date(date),
        user: user,
        group: group,
        assignedUser: assignedUser == "Sin asignar" ? user : assignedUser,
    }

    const response = await db.collection('tasks').add(data);

    if (response.id) {
        return res.status(201).json({ msg: "Registro realizado con éxito" });
    } else {
        return res.status(500).json({ msg: "Error al registrar tarea" });
    }
});

app.get('/tasks/:user', async (req, res) => {
    const tasks = [];
    try {
        const { user } = req.params;
        const tasksRef = db.collection('tasks').where('user', '==', user).where('group', '==', 'Sin grupo');
        const snapshot = await tasksRef.get();

        // Verificar si hay tareas
        if (snapshot.empty) {
            return res.status(200).json({ msg: "No hay tareas registradas para este usuario", tasks });
        }


        snapshot.forEach(doc => {
            const taskData = doc.data();
            tasks.push({
                id: doc.id,
                ...taskData
            });
        });

        return res.status(200).json({ msg: "Tareas encontradas", tasks });
    } catch (error) {
        console.error("Error en el servidor:", error);
        return res.status(500).json({ msg: "Error al obtener las tareas", tasks });
    }
});

app.get('/tasks/all/:user', async (req, res) => {
    const tasks = [];
    try {
        const { user } = req.params;

        // Obtener el usuario y sus grupos
        const userRef = db.collection('users').where('user', '==', user);
        const userSnapshot = await userRef.get();

        if (userSnapshot.empty) {
            return res.status(404).json({ msg: "Usuario no encontrado", tasks });
        }

        const currentGroup = userSnapshot.docs[0].data().group || [];

        // Consultar tareas creadas por el usuario
        const createdTasksQuery = db.collection('tasks')
            .where('user', '==', user);
        const createdTasksSnapshot = await createdTasksQuery.get();

        // Consultar tareas asignadas al usuario
        const assignedTasksQuery = db.collection('tasks')
            .where('assignedUser', '==', user);
        const assignedTasksSnapshot = await assignedTasksQuery.get();

        // Consultar tareas que pertenecen a los grupos del usuario (solo si hay grupos)
        let groupTasksSnapshot;
        if (currentGroup.length > 0) {
            const groupTasksQuery = db.collection('tasks')
                .where('group', 'in', currentGroup);
            groupTasksSnapshot = await groupTasksQuery.get();
        } else {
            groupTasksSnapshot = { empty: true, forEach: () => { } }; // Simular un snapshot vacío
        }

        // Combinar resultados y eliminar duplicados
        const tasksMap = new Map();

        [createdTasksSnapshot, assignedTasksSnapshot, groupTasksSnapshot].forEach(snapshot => {
            snapshot.forEach(doc => {
                const taskData = doc.data();
                tasksMap.set(doc.id, { id: doc.id, ...taskData }); // Usar el ID de la tarea como clave para evitar duplicados
            });
        });

        // Convertir el mapa a un array de tareas
        const uniqueTasks = Array.from(tasksMap.values());

        // Verificar si hay tareas
        if (uniqueTasks.length === 0) {
            return res.status(200).json({ msg: "No hay tareas registradas para este usuario", tasks: uniqueTasks });
        }

        return res.status(200).json({ msg: "Tareas encontradas", tasks: uniqueTasks });
    } catch (error) {
        console.error("Error en el servidor:", error);
        return res.status(500).json({ msg: "Error al obtener las tareas", tasks });
    }
});

app.get('/tasks/group/:group', async (req, res) => {
    const tasks = [];
    try {
        const { group } = req.params;
        const tasksRef = db.collection('tasks').where('group', '==', group);
        const snapshot = await tasksRef.get();

        // Verificar si hay tareas
        if (snapshot.empty) {
            return res.status(200).json({ msg: "No hay tareas registradas para este grupo", tasks });
        }


        snapshot.forEach(doc => {
            const taskData = doc.data();
            tasks.push({
                id: doc.id,
                ...taskData
            });
        });

        return res.status(200).json({ msg: "Tareas encontradas", tasks });
    } catch (error) {
        console.error("Error en el servidor:", error);
        return res.status(500).json({ msg: "Error al obtener las tareas", tasks });
    }
});

app.delete('/tasks/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteRef = await db.collection('tasks').doc(id).delete();

        return res.status(200).json({ success: true, msg: 'Documento eliminado correctamente' });
    } catch (error) {
        return res.status(500).json({ success: false, msg: 'No se pudo eliminar el documento' });
    }
})

app.put('/tasks/update/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, category, status, date, user, group, assignedUser } = req.body;

        const taskRef = db.collection('tasks').doc(id);
        let aux = assignedUser == "Sin asignar" ? user : assignedUser
        await taskRef.update({
            name,
            description,
            category,
            status,
            date: new Date(date),
            user,
            group,
            assignedUser: aux
        });

        return res.status(200).json({ success: true, msg: 'Tarea actualizada correctamente' });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, msg: 'Error al actualizar la tarea' });
    }
})

app.put('/tasks/add/user', async (req, res) => {
    try {
        const { task, assignedUser } = req.body;

        const taskRef = db.collection('tasks').doc(task);
        await taskRef.update({
            assignedUser
        });

        return res.status(200).json({ success: true, msg: 'Tarea actualizada correctamente' });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, msg: 'Error al actualizar la tarea' });
    }
})

app.post('/groups', async (req, res) => {
    let { name, createdBy } = req.body;

    if (!name) {
        return res.status(400).json({ msg: "Debe completar todos los campos" });
    }

    let data = {
        name: name,
        createdBy: createdBy
    }

    const response = await db.collection('groups').add(data);

    if (response.id) {
        return res.status(201).json({ msg: "Registro realizado con éxito" });
    } else {
        return res.status(500).json({ msg: "Error al registrar el grupo" });
    }
});

app.get('/groups/:user', async (req, res) => {
    const groups = [];
    try {
        const { user } = req.params;
        const groupsRef = db.collection('groups').where('createdBy', '==', user);
        const snapshot = await groupsRef.get();

        if (snapshot.empty) {
            return res.status(200).json({ msg: "No hay grupos registrados por este usuario", groups });
        }


        snapshot.forEach(doc => {
            const groupData = doc.data();
            groups.push({
                id: doc.id,
                ...groupData
            });
        });

        return res.status(200).json({ msg: "Grupos encontrados", groups });
    } catch (error) {
        console.error("Error en el servidor:", error);
        return res.status(500).json({ msg: "Error al obtener los grupos", groups });
    }
});

app.put('/groups/update/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, createdBy } = req.body;

        const groupRef = db.collection('groups').doc(id);
        await groupRef.update({
            name,
            createdBy
        });

        return res.status(200).json({ success: true, msg: 'Grupo actualizada correctamente' });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, msg: 'Error al actualizar el grupo' });
    }
})

app.delete('/groups/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteRef = await db.collection('groups').doc(id).delete();

        return res.status(200).json({ success: true, msg: 'Documento eliminado correctamente' });
    } catch (error) {
        return res.status(500).json({ success: false, msg: 'No se pudo eliminar el documento' });
    }
})

app.get('/users/:user', async (req, res) => {
    const users = [];
    try {
        const { user } = req.params;
        const usersRef = db.collection('users').where('user', '!=', user);
        const snapshot = await usersRef.get();

        if (snapshot.empty) {
            return res.status(200).json({ msg: "No hay usuarios registrados", users });
        }


        snapshot.forEach(doc => {
            const userData = doc.data();
            users.push({
                id: doc.id,
                ...userData
            });
        });

        return res.status(200).json({ msg: "Usuarios encontrados", users });
    } catch (error) {
        console.error("Error en el servidor:", error);
        return res.status(500).json({ msg: "Error al obtener los usuarios", users });
    }
});

app.put('/users/update/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let { user, email, rol } = req.body;

        const userRef = db.collection('users').doc(id);
        await userRef.update({
            user,
            email,
            rol
        });

        return res.status(200).json({ success: true, msg: 'Usuario actualizada correctamente' });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, msg: 'Error al actualizar al usuario' });
    }
})


app.delete('/users/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteRef = await db.collection('users').doc(id).delete();

        return res.status(200).json({ success: true, msg: 'Documento eliminado correctamente' });
    } catch (error) {
        return res.status(500).json({ success: false, msg: 'No se pudo eliminar el documento' });
    }
})

app.get('/members/:group', async (req, res) => {
    const users = [];
    try {
        const { group } = req.params;
        const usersRef = db.collection('users').where('group', 'array-contains', group);
        const snapshot = await usersRef.get();

        if (snapshot.empty) {
            return res.status(200).json({ msg: "No hay usuarios registrados", users });
        }
        snapshot.forEach(doc => {
            const userData = doc.data();
            users.push({
                id: doc.id,
                ...userData
            });
        });

        return res.status(200).json({ msg: "Usuarios encontrados", users });
    } catch (error) {
        console.error("Error en el servidor:", error);
        return res.status(500).json({ msg: "Error al obtener los usuarios", users });
    }
});

app.put('/members', async (req, res) => {
    try {
        let { user, group } = req.body;

        const userRef = db.collection('users').doc(user);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ success: false, msg: 'Usuario no encontrado' });
        }

        const currentGroup = userDoc.data().group || [];
        let updatedGroup = currentGroup;
        if (group && !currentGroup.includes(group)) {
            updatedGroup = [...currentGroup, group]; // Agregar el nuevo grupo al array
        }

        await userRef.update({
            group: updatedGroup
        });

        return res.status(200).json({ success: true, msg: 'Usuario actualizada correctamente' });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, msg: 'Error al actualizar al usuario' });
    }
})

app.delete('/members', async (req, res) => {
    try {
        let { user, group } = req.body;

        const userRef = db.collection('users').doc(user);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ success: false, msg: 'Usuario no encontrado' });
        }

        const currentGroup = userDoc.data().group || [];

        const updatedGroup = currentGroup.filter(g => g !== group);

        await userRef.update({
            group: updatedGroup
        });

        return res.status(200).json({ success: true, msg: 'Usuario actualizada correctamente' });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, msg: 'Error al actualizar al usuario' });
    }
})

app.get('/nomembers/:group', async (req, res) => {
    const users = [];
    try {
        const { group } = req.params;

        const usersRef = db.collection('users');
        const snapshot = await usersRef.get();

        if (snapshot.empty) {
            return res.status(200).json({ msg: "No hay usuarios registrados", users });
        }

        snapshot.forEach(doc => {
            const userData = doc.data();
            if (!userData.group || !userData.group.includes(group)) {
                users.push({
                    id: doc.id,
                    ...userData
                });
            }
        });

        return res.status(200).json({ msg: "Usuarios encontrados que no pertenecen al grupo", users });
    } catch (error) {
        console.error("Error en el servidor:", error);
        return res.status(500).json({ msg: "Error al obtener los usuarios", users });
    }
});
