# Cómo usar el CI desde el celular (sin terminal)

`.github/workflows/ci.yml` corre automáticamente los 3 tracks de
verificación pendientes (Flutter, Firestore, Backend) apenas el proyecto
esté en un repositorio de GitHub — sin que necesites Node, Java, Docker
ni una terminal en ningún dispositivo. GitHub lo ejecuta en sus propios
servidores.

## Paso 1 — Crear el repositorio (desde el navegador del celular)

1. Entrá a [github.com](https://github.com) desde el navegador del
   celular (o la app de GitHub) e iniciá sesión.
2. Tocá el `+` arriba a la derecha → **New repository**.
3. Nombre: `rouvy-pro` (o el que prefieras) → **Create repository**.
   Dejalo vacío, sin README inicial.

## Paso 2 — Subir el proyecto SIN terminal

GitHub permite subir archivos directamente desde el navegador — pero
**no acepta carpetas completas por arrastre en todos los navegadores
móviles**, así que la forma más confiable desde el celular es:

**Opción recomendada — GitHub Desktop en una computadora, aunque sea
prestada, una sola vez:** si en algún momento tenés acceso a CUALQUIER
computadora (aunque no sea tuya, un rato en una biblioteca, etc.),
instalar [GitHub Desktop](https://desktop.github.com/) y usar
"Add Local Repository" apuntando a la carpeta descomprimida es el camino
más simple y solo hace falta una vez — después de eso, cada actualización
futura la podés seguir haciendo conmigo (yo te doy el zip actualizado, vos
lo subís) o eventualmente desde el celular con las apps de la Opción B.

**Opción B — Enteramente desde el celular:** la app oficial
**GitHub Mobile** (iOS/Android) permite crear archivos y hacer commits
simples, pero para subir un proyecto completo con cientos de archivos de
una vez, la vía más práctica es la web de GitHub:
1. En el repositorio recién creado, tocá **uploading an existing file**.
2. Tu navegador móvil debería permitirte seleccionar el `.zip` que te
   compartí — pero GitHub **no descomprime zips subidos**, así que esto
   solo funciona bien si tu teléfono puede descomprimir el zip primero
   (apps como "Files" en iOS o "Archivos" en Android suelen poder) y
   subís los archivos ya descomprimidos, carpeta por carpeta.

**Realistamente, para un proyecto de este tamaño (180+ archivos), lo más
práctico sigue siendo la Opción A (una computadora, aunque sea
prestada/pública, una única vez) para el primer `git push`.** Después de
ese primer push, el CI queda corriendo solo en cada actualización futura,
y VOS solo necesitás el navegador del celular para verlo — no volvés a
necesitar la computadora para eso.

## Paso 3 — Ver los resultados (esto sí, 100% desde el celular)

1. En el repositorio de GitHub, abrí la pestaña **Actions** (ícono de
   play ▶ en la barra inferior/superior según el navegador).
2. Vas a ver 3 checks corriendo: `flutter-checks`, `firestore-rules-tests`,
   `backend-tests` — tardan entre 2 y 8 minutos en total.
3. Cada uno termina en ✅ (verde) o ❌ (rojo). Tocá cualquiera para ver el
   log completo, igual que si fuera la salida de una terminal.
4. **Esto reemplaza los 4 resultados que pedía `VERIFICATION_GUIDE.md`** —
   en vez de copiarme texto de tu terminal, simplemente decime "el job
   X falló, esto dice el log" (o pegame el texto del log si preferís,
   funciona igual).

## Paso 4 — Disparar el CI manualmente sin hacer un commit nuevo

Si el proyecto ya está subido y solo querés volver a correr las
verificaciones (por ejemplo, después de que yo te mande una corrección):
1. Pestaña **Actions** → en el panel izquierdo, tocá **CI**.
2. Botón **Run workflow** (arriba a la derecha) → **Run workflow** de
   nuevo para confirmar.

Esto también funciona perfecto desde el navegador del celular.

## Qué pasa con las credenciales

Los 3 jobs de este workflow usan **valores de prueba hardcodeados a
propósito** (`ridepro`/`devpassword`, proyecto Firebase
`demo-ridepro-security-tests`) — nunca tocan Firebase ni Postgres reales
de producción. No hace falta configurar ningún secreto en GitHub para que
esto funcione tal cual está.

## Limitación honesta de este enfoque

Este workflow todavía no se ha ejecutado ni una vez (no hay forma de
probarlo sin un repositorio real de GitHub, que es precisamente lo que
falta crear en el Paso 1-2). Es sintácticamente válido (YAML verificado) y
sigue la estructura estándar documentada de GitHub Actions, pero **la
primera vez que corra es también la primera vez que se prueba** — si algo
falla en el Job 3 (backend) por algún detalle del entorno de GitHub
Actions que no se pueda anticipar sin verlo correr, lo ajustamos con el
log real en mano, no antes.
