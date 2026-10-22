# Backend propio para Spotify Sirilo

Servidor Node.js con yt-dlp para el recurso MTA `spotifySirilo`. Busca en YouTube y entrega audio WebM por HTTPS desde el propio backend. No requiere cuenta ni token de Spotify, ni una lista manual de canciones, ni MySQL.

## Qué hace

- `GET /health`: verifica que la aplicación responde; no comprueba disponibilidad de YouTube.
- `GET /search?q=artista+cancion&limit=8`: resultados compatibles con el panel y portadas incrustadas como base64.
- `GET /stream?format=webm&url=https%3A...`: duración y enlace firmado del audio.
- `GET /audio?ticket=...`: transmite el audio a los jugadores; admite HEAD y rangos de bytes para reproducción y posicionamiento.

El backend resuelve y transmite el audio desde la misma máquina. Los clientes no reciben directamente las URLs de Google que pueden depender de la IP del servidor. Las consultas requieren `X-API-Key`; los clientes reproducen con enlaces temporales firmados sin conocer esa clave. Los enlaces duran dos horas y dejan de servir al cambiar la clave.

Límites iniciales: canciones grabadas de hasta 20 minutos, 8 resultados, 2 extracciones simultáneas, 120 consultas/minuto por instancia y 32 conexiones de audio concurrentes (incluidas conexiones de rango). Las búsquedas se recuerdan un minuto; los metadatos, 15 minutos. Las cachés son pequeñas y se mantienen en memoria. No se guardan canciones en disco.

## Desplegar en Render

El hosting del juego sigue siendo Bisect. Este proyecto se despliega por separado como servicio web.

1. Crear un repositorio de GitHub con **el contenido de esta carpeta `music-backend` en la raíz**: `Dockerfile`, `server.js`, `package.json`, `render.yaml`, etc. No subir la GM ni sus configuraciones SQL.
2. En Render, crear un **Web Service**, conectar ese repositorio y elegir **Docker**. Dejar que use el `Dockerfile` incluido. No es necesario introducir un build/start command manual.
3. En **Environment**, crear `API_KEY` con una clave de al menos 20 caracteres. Puede generarse localmente:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Si se despliega con el Blueprint `render.yaml`, Render genera ese valor automáticamente. Copiar el valor de la variable al configurar MTA.
4. Render proporciona `RENDER_EXTERNAL_URL`, que utiliza la aplicación para construir los enlaces de audio. Si se usa otro proveedor o dominio, establecer `PUBLIC_BASE_URL=https://tu-dominio`, sin rutas. Esta variable tiene prioridad sobre la URL de Render.
5. Desplegar y abrir `https://TU-SERVICIO.onrender.com/health`. Debe responder:

   ```json
   {"status":"ok","service":"sirilo-music"}
   ```

6. Probar una búsqueda desde PowerShell, reemplazando los valores localmente:

   ```powershell
   $musicHeaders = @{ 'X-API-Key' = 'TU_CLAVE' }
   Invoke-RestMethod -Uri 'https://TU-SERVICIO.onrender.com/search?q=musica&limit=2' -Headers $musicHeaders
   ```

   Abrir `/search` directamente en el navegador sin la cabecera da **401**, lo cual es correcto.

El Dockerfile incluye Python, Node y `yt-dlp[default]`, con runtime JavaScript para la extracción de YouTube. No necesita FFmpeg porque selecciona un archivo WebM de audio existente y no lo convierte. Al reconstruir sin caché se instala la versión disponible de yt-dlp, para incorporar correcciones del extractor. Registrar la versión del despliegue validado antes de futuras actualizaciones.

## Conectarlo a MTA/Bisect

En `resources/spotifySirilo/config.lua`:

```lua
JBLMusicConfig = {
    backend = "https://TU-SERVICIO.onrender.com",
    apiKey = "MISMO_VALOR_DE_API_KEY",
}
```

Esta clave es propia del backend; no hay que solicitarla a Spotify o YouTube. Mantener `config.lua` solo como script de servidor, tal como está declarado en `meta.xml`.

Subir el recurso spotifySirilo actualizado completo. Incluye correcciones en client.lua para sincronizar al volver a acercarse, reiniciar el mismo tema, separar dimensiones e interiores y evitar reintentos continuos cuando el audio falla. En consola:

```text
refresh
start nuevosModelos_GTARG
start bone_attach
restart spotifySirilo
```

Si todavía no estaba iniciado, usar `start spotifySirilo` en vez de `restart`. El manifiesto solicita `function.fetchRemote`. Si MTA informa acceso denegado, un administrador de consola puede revisar y aceptar esa solicitud:

```text
aclrequest list spotifySirilo
aclrequest allow spotifySirilo all
```

Ese manifiesto solicita únicamente `function.fetchRemote`; comprobarlo antes de aceptar si se añaden otros permisos en el futuro. No requiere dar acceso Admin completo al recurso.

En el juego: `/jbl`, buscar artista/canción y seleccionar un resultado. F6 o `/jblpanel` alterna el panel. `/jbl` guarda la JBL. `/jblmute` silencia/reactiva el audio local. Probar la reproducción desde dos clientes, pausa/reanudación, distancia y reconexión.

También se corrigió el temporizador que eliminaba una canción mientras estaba pausada. Se eliminó el respaldo M4A para este backend, que entrega WebM, y se muestran los mensajes de error devueltos por el servicio.

## Desarrollo y pruebas

Requiere Node 22+ y Python 3.10+ para uso sin Docker:

```text
python -m pip install "yt-dlp[default]"
```

En PowerShell:

```powershell
$env:API_KEY = 'una-clave-local-de-al-menos-20-caracteres'
$env:PUBLIC_BASE_URL = 'http://127.0.0.1:10000'
node server.js
```

La URL local sirve para pruebas en la misma máquina. Un MTA en Bisect y otros jugadores necesitan la URL pública desplegada.

Pruebas del backend desde esta carpeta:

```text
node --test test/server.test.js
```

Verifican HTTP, autenticación, esquema de resultados, validación de URLs, firmas, caducidad, errores, caché, deduplicación y transmisión por rangos. Usan un extractor y un proveedor de audio simulados: no demuestran que YouTube acepte la IP del hosting.

La prueba `test/mta-contract.lua` se ejecuta desde la carpeta `resources` y verifica cabeceras, búsqueda/reproducción, errores y pausa. Si se conserva el runtime de pruebas de la migración SQL:

```text
node docs/sql-tests/runtime/node_modules/fengari-node-cli/src/lua-cli.js music-backend/test/mta-contract.lua
node docs/sql-tests/runtime/node_modules/fengari-node-cli/src/lua-cli.js music-backend/test/mta-client.lua
```

## Límites reales y diagnóstico

Este proyecto está preparado y probado localmente con proveedores simulados. **Todavía requiere desplegar y validar una búsqueda y reproducción reales.** Aquí no hay Python/Docker instalado para ejecutar yt-dlp y construir el contenedor. No se ha creado una cuenta ni un servicio externo.

YouTube puede rechazar extracciones desde IPs de centros de datos, cambiar sus formatos o pedir autenticación. Este backend no garantiza acceso a todas las canciones ni evita esas restricciones. No incorpora cookies ni mecanismos para eludir controles. Si YouTube bloquea el hosting, actualizar el extractor puede resolver cambios técnicos, pero no garantiza resolver bloqueos de acceso. Para disponibilidad controlada, una alternativa es servir un catálogo propio de audio.

El tráfico de audio pasa por el backend: cada oyente consume transferencia. Elegir el plan de hosting después de probar el consumo real. Si una instancia se suspende por inactividad, su arranque puede superar el tiempo de espera de MTA; primero esperar a que `/health` responda y reintentar.

| Síntoma | Comprobación |
| --- | --- |
| `/health` falla | URL, logs, estado y despliegue del servicio |
| 401 | `API_KEY` y `apiKey` deben coincidir |
| 429 | Concurrencia o frecuencia de consultas; esperar y revisar carga |
| 502 al buscar/reproducir | Extracción o audio rechazados por el proveedor; probar otra canción y revisar versión de yt-dlp |
| 504 | El extractor superó 28 segundos |
| Panel abre pero no consulta | URL y permisos `fetchRemote`; usar `debugscript 3` |
| Encuentra canciones pero no suenan | Probar `/stream`, conexión de audio desde clientes y compatibilidad WebM real |
| JBL no aparece | Iniciar `nuevosModelos_GTARG` y `bone_attach` |

Fuentes: [Docker en Render](https://render.com/docs/docker), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [playSound3D de MTA](https://wiki.multitheftauto.com/wiki/PlaySound3D).
