# Sesion opcional de YouTube

El backend acepta YTDLP_COOKIES_FILE con la ruta de un archivo Netscape de cookies. No recibe usuarios, contrasenas ni cookies desde el panel MTA. El archivo se copia a un directorio temporal privado para cada extraccion y se elimina al terminar; no modifica el secreto original.

1. Inicia sesion manualmente en YouTube con tu cuenta secundaria en un perfil separado del navegador.
2. Exporta las cookies de YouTube en formato Netscape cookies.txt. Sigue https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp . Evita exportar sesiones de otros sitios y no pegues cookies en chats ni repositorios.
3. En Render abre tu servicio, Environment, Secret Files, Add Secret File. Nombre: youtube-cookies.txt. Pega su contenido solamente en el campo privado Contents de Render.
4. Agrega la variable YTDLP_COOKIES_FILE=/etc/secrets/youtube-cookies.txt y guarda con despliegue. Mantiene API_KEY y la URL existentes.
5. Cuando Render indique Live, busca una cancion y reproducela en MTA. /health solo comprueba el proceso, no verifica la sesion ni YouTube.

Si las cookies caducan o YouTube revoca la sesion, reemplaza el archivo secreto y redespliega. Para desactivar la sesion elimina YTDLP_COOKIES_FILE y el secreto, y redespliega. Las cookies no garantizan que YouTube permita solicitudes desde Render.

Los archivos de cookies se excluyen de Git y del contexto Docker. No pongas su contenido en variables publicas, logs ni config.lua. El archivo permite usar tu sesion: usa una cuenta sin informacion sensible. Este soporte esta probado con cookies ficticias; falta la prueba real con tu sesion.

Documentacion de secretos: https://render.com/docs/configure-environment-variables#secret-files
