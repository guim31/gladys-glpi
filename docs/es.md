# GLPI

Los tickets de su [GLPI](https://glpi-project.org) en Gladys: cuántos están
abiertos, en espera, fuera de su SLA, cuántos se han resuelto hoy. Una escena
reacciona a un ticket nuevo, a un ticket que se atrasa o a un ticket resuelto, y
Gladys puede **abrir un ticket por sí misma** cuando detecta una avería: una
fuga de agua, un congelador demasiado caliente, una impresora o un router de
Internet que ya no responde.

> **Sus comentarios son bienvenidos.** Esta integración se ha probado con
> servidores GLPI reales (las imágenes Docker oficiales `glpi/glpi` 10.0.28,
> 11.0.11 y 12.0.0, octubre de 2026), todavía no en el día a día de un servicio
> de soporte real. Si algo no funciona como se describe, dígalo en el
> [foro de Gladys](https://community.gladysassistant.com) o en las
> [issues](https://github.com/guim31/gladys-glpi/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- **GLPI 10, 11 o 12**, autoalojado o alojado (GLPI Network Cloud), accesible
  desde Gladys. La integración usa la API REST heredada de GLPI (`apirest.php`),
  presente en estas tres versiones.
- Un **usuario de GLPI** en cuyo nombre Gladys lee y crea los tickets. Lo mejor
  es crear uno para ella (`gladys`):
  - con el perfil **Técnico** (o un perfil que vea todos los tickets) en las
    entidades que se quieren seguir: los contadores cuentan entonces todos los
    tickets de esas entidades;
  - o con el perfil **Self-Service**: Gladys solo ve entonces los tickets que
    ella ha solicitado, lo que basta para abrir tickets de avería.

  La integración ve exactamente lo que ve este usuario en GLPI (su perfil
  predeterminado, sus entidades y sus subentidades).

## Instalación

### En GLPI

1. **Configuración** → **General** → pestaña **API**:
   - active **Habilitar la API REST heredada (Legacy)** (GLPI 11 y 12) o la API
     REST (GLPI 10);
   - active **Activar acceso con token externo**.
2. En la lista **Clientes de la API** de la misma pestaña, autorice la dirección
   de Gladys: el cliente predeterminado («full access from localhost») solo
   acepta `127.0.0.1`. Añada un cliente (o modifique este) con la dirección de
   la máquina de Gladys, tal como la ve GLPI, como inicio y fin del rango de
   direcciones IPv4, o deje el rango vacío para aceptar todas las direcciones.
   Si rellena un **Token de aplicación** (`app_token`), cópielo en Gladys.
3. Abra la ficha del usuario `gladys` (o sus preferencias, conectado como él).
   En el campo **API token**, marque **Regenerar**, guarde y copie el token
   mostrado.

### En Gladys

1. **Integraciones** → instale **GLPI**.
2. En la pantalla **Configuración**, rellene:
   - **Dirección**: la dirección de GLPI como en el navegador, p. ej.
     `https://helpdesk.example.org` o `http://192.168.1.30/glpi` (la carpeta
     `/glpi` se conserva, `/front/…` o `/apirest.php` se eliminan);
   - **Token de usuario**: el token de API copiado en el paso 3;
   - **Token de aplicación**: solo si el cliente de la API tiene uno;
   - **Aceptar certificados autofirmados**: para un GLPI en `https://` con un
     certificado autofirmado;
   - **Intervalo de actualización**: 1, 2, 5 (predeterminado) o 10 minutos;
   - **Idioma de los nombres de funciones**: el idioma de los nombres del
     dispositivo y de los textos enviados a las escenas (urgencia, tipo,
     estado).
3. **Probar la conexión** indica la versión de GLPI, el usuario y su perfil, y
   el número de tickets abiertos.
4. Pestaña **Descubrimiento**: añada el dispositivo **GLPI**.

## Dispositivo

Un dispositivo **GLPI**, con seis contadores actualizados en cada lectura:

| Función               | Lo que cuenta                                                                      |
| --------------------- | ---------------------------------------------------------------------------------- |
| Tickets abiertos      | los tickets no resueltos: nuevos, en curso y en espera                             |
| Tickets nuevos        | los tickets con el estado Nuevo                                                    |
| Tickets en curso      | los tickets en curso (asignados o planificados)                                    |
| Tickets en espera     | los tickets en espera                                                              |
| Tickets atrasados     | los tickets abiertos cuyo tiempo de resolución (SLA) se ha superado                |
| Tickets resueltos hoy | los tickets resueltos (o resueltos y cerrados) desde medianoche, hora del servidor |

«Atrasado» es el **Tiempo de resolución excedido** que calcula el propio GLPI:
un ticket sin tiempo de resolución nunca está atrasado. Los contadores guardan
su historial y sirven de condiciones en las escenas («si Tickets atrasados es
mayor que 0»).

## Panel

El widget **Últimos tickets de GLPI** muestra tres mosaicos (abiertos,
atrasados, nuevos) y los ocho últimos tickets abiertos, con su estado, su
urgencia y su entidad. Un ticket atrasado lleva la insignia «Atrasado», un
ticket de urgencia alta o muy alta la insignia de su urgencia. Si GLPI está en
`https://`, cada ticket ofrece un enlace **Abrir en GLPI**.

## Escenas

### Disparadores

Los tres disparadores se filtran por **Urgencia** (una o varias, vacío:
cualquiera) y por **Tipo** (incidencia o solicitud, vacío: cualquiera).

- **Nuevo ticket de GLPI**: se ha abierto un ticket en GLPI, por un usuario, un
  recolector de correo o un formulario. Los tickets creados por la propia Gladys
  no disparan nada (sin bucle).
- **Ticket de GLPI atrasado**: un ticket abierto acaba de superar su tiempo de
  resolución.
- **Ticket de GLPI resuelto**: un ticket abierto en la lectura anterior está
  ahora resuelto o cerrado.

Variables transmitidas a las acciones: número del ticket, título, urgencia (de 1
a 5 y en palabras), tipo, estado, categoría, entidad, solicitante, tiempo de
resolución, enlace al ticket y, para un ticket resuelto, la fecha de resolución.
Las fechas son las que muestra GLPI (hora del servidor GLPI).

Los eventos se detectan en cada lectura: llegan como mucho un intervalo de
actualización después de los hechos. En la primera lectura (o tras un cambio de
servidor o de usuario), la integración toma nota de lo existente sin disparar
nada. Una lectura dispara como mucho 30 eventos (una importación masiva no
inunda Gladys).

### Acciones

- **Crear un ticket de GLPI**: abre un ticket en nombre del usuario del token,
  que es su solicitante. Campos: **Título** (obligatorio), **Descripción**
  (vacío: el título; las variables de escena son bienvenidas), **Urgencia**
  (vacío: media), **Tipo** (vacío: incidencia), **Categoría** (nombre o número,
  opcional) y **Entidad** (nombre o número, vacío: la entidad predeterminada del
  usuario). Salidas: el número del ticket y su enlace.
- **Añadir un seguimiento a un ticket de GLPI**: añade un seguimiento al ticket
  indicado por su número (`125` o `#125`), en nombre del usuario del token. El
  número puede venir de un «Crear un ticket de GLPI» anterior en la escena, o
  del disparador. Salidas: el número y el título del ticket.

Una categoría o una entidad se indica por su número, su nombre completo
(`Root entity > Site Nord`) o la última parte de ese nombre (`Site Nord`), sin
distinguir mayúsculas ni acentos.

### Ideas de escenas

- **Fuga de agua**: el detector de fugas de la sala de calderas detecta una fuga
  → **Crear un ticket de GLPI** «Fuga de agua en la sala de calderas», urgencia
  muy alta, categoría «Edificio», descripción con la hora; después un mensaje de
  Gladys con el enlace del ticket.
- **Router de Internet caído**: el ping del router falla desde hace 10 minutos →
  ticket «Sin Internet en la oficina»; cuando vuelve el ping, **Añadir un
  seguimiento** «Conexión recuperada a las 14:32» al mismo ticket.
- **Guardia**: **Nuevo ticket de GLPI** filtrado en urgencias alta y muy alta →
  mensaje de Telegram al técnico de guardia con el título, el solicitante y el
  enlace; **Ticket de GLPI atrasado** → poner en rojo la lámpara de la oficina.

## Solución de problemas

- **«no hay ninguna API de GLPI en esta dirección»**: compruebe la dirección (con
  la carpeta `/glpi` si la hay) abriendo `…/apirest.php` en un navegador: GLPI
  responde con su página de documentación de la API.
- **«la API REST está desactivada»**: vea el paso 1 en GLPI.
- **«ningún cliente de API acepta la dirección de Gladys»**: el rango de
  direcciones del cliente de la API (paso 2) no contiene la dirección de Gladys
  tal como la ve GLPI (detrás de un proxy o un NAT, la de ese proxy o router).
- **«token de aplicación ausente o incorrecto»**: el cliente de la API tiene un
  token de aplicación, que hay que copiar en la configuración, o no es ese.
- **«token de usuario rechazado»**: el token se ha regenerado desde entonces, o
  el acceso con token externo no está activado (paso 1).
- **«al perfil del usuario de GLPI le falta un derecho»**: el perfil no permite
  crear un ticket o añadir un seguimiento (o no en esa entidad).
- **Los contadores se quedan en cero**: el usuario no ve los tickets (perfil
  Self-Service, o entidad sin sus subentidades).
- **El solicitante está vacío en las escenas**: el perfil no permite leer los
  usuarios; el resto funciona.

## Limitaciones

- Un solo GLPI por instalación, y un solo dispositivo para todos los tickets que
  ve el usuario (sin dispositivo por entidad: use un usuario limitado a una
  entidad para seguir solo esa).
- Se cuentan los 5000 tickets más recientes (abiertos y resueltos hoy).
- «Resueltos hoy» y «atrasados» siguen la hora del servidor GLPI.
- Todavía no por la nueva API de GLPI 11 (OAuth2): la API REST heredada basta y
  existe en GLPI 10, 11 y 12.
- Un ticket abierto y resuelto entre dos lecturas dispara «Nuevo ticket de
  GLPI» pero no «resuelto».

Esta integración no está afiliada a Teclib' ni al proyecto GLPI.
