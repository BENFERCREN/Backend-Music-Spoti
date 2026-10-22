# Ejecutar el backend de Spotify Sirilo

El backend esta implementado en server.js. No se ejecuta como recurso de MTA: es un proceso separado que debe permanecer encendido.

## Prueba en Windows

1. Instala Node.js 22 o superior y Python 3.10 o superior.
2. Instala el extractor en una terminal:

   ```powershell
   python -m pip install "yt-dlp[default]"
   ```

3. Desde la carpeta resources ejecuta:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\music-backend\start-local.ps1
   ```

4. Deja esa terminal abierta. Comprueba http://127.0.0.1:10000/health.
5. Para MTA en la misma PC, establece backend = "http://127.0.0.1:10000" en spotifySirilo/config.lua y copia el contenido de music-backend/.local-api-key en apiKey. La clave se genera al arrancar y se conserva entre reinicios.

La URL 127.0.0.1 no sirve para un servidor en Bisect ni para jugadores en otras PCs.

## Servidor publico

La carpeta incluye Dockerfile y render.yaml para desplegar el proceso en un hosting separado. Sigue README.md. Configura API_KEY y una URL publica; el recurso MTA necesita esa misma clave y URL en config.lua. No subas .local-api-key ni la GM a un repositorio.

## Funciones implementadas

- Buscar por nombre y artista: GET /search, con X-API-Key.
- Resolver audio WebM y generar enlace temporal: GET /stream, con X-API-Key.
- Servir audio a los jugadores, incluyendo rangos para posicionamiento: GET /audio, con ticket firmado.
- Estado del proceso: GET /health, publico. No verifica acceso a YouTube.

El acceso real depende de que YouTube permita la extraccion desde el hosting. Se aceptan canciones grabadas de hasta 20 minutos. Las pruebas automatizadas usan un proveedor simulado; falta validar con el hosting y clientes MTA reales.
