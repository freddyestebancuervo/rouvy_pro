# Auditoría de accesibilidad

Primera pasada de accesibilidad sobre el proyecto — no era una categoría
tocada en ninguna iteración anterior. Metodología: auditoría de código
real (scripts sobre el repositorio, no una checklist genérica), corrigiendo
solo lo que efectivamente se encontró.

---

## 1. Metodología

Cuatro chequeos automatizados sobre el código fuente real:

1. **`IconButton` sin `tooltip`** — un script en Python que parsea
   paréntesis balanceados (no un regex ingenuo, que da falsos positivos
   con paréntesis anidados) buscando cada `IconButton(...)` del proyecto
   y verificando si el bloque interno contiene `tooltip:`.
2. **Contraste de color WCAG 2.1** — implementación de la fórmula oficial
   (luminancia relativa + ratio) aplicada a las combinaciones de color
   REALES usadas en la app (no todas las combinaciones matemáticamente
   posibles de la paleta, solo las que el código efectivamente pinta
   juntas — texto blanco sobre botón primario, etc.).
3. **Áreas táctiles pequeñas** — búsqueda de `GestureDetector`/`InkWell`
   personalizados (que podrían no respetar el mínimo de 48×48dp que sí
   garantizan los widgets Material estándar).
4. **Restricciones de escalado de texto** — búsqueda de
   `textScaleFactor`/`textScaler`/`MediaQuery(...)` que pudieran forzar un
   tamaño de texto fijo, impidiendo que el usuario use el ajuste de
   tamaño de fuente del sistema operativo.

## 2. Hallazgos y correcciones

### 2.1 Contraste de color — el hallazgo más importante

**`AppColors.primary` (el color de fondo de TODOS los botones primarios de
la app — login, registro, CTAs) tenía un contraste de 3.31:1 con el texto
blanco que se pinta encima.** El mínimo WCAG AA para texto normal es
4.5:1 — el botón principal de la app entera no lo cumplía.

También fallaban, aunque todavía no se usaban en ningún lado del código:
`success` (2.10:1), `warning` (2.19:1), `error` (3.82:1, pasaba para
texto grande pero no normal).

**Corrección:** se oscureció cada color manteniendo el mismo matiz (hue) y
saturación — es decir, siguen siendo "el mismo color" percibido, solo
menos claros — hasta alcanzar 4.5:1 exacto o superior:

| Color | Antes | Después | Contraste antes | Contraste después |
|---|---|---|---|---|
| `primary` | `#FF4D2E` | `#E82200` | 3.31:1 | 4.50:1 |
| `success` | `#2ECC71` | `#1F884B` | 2.10:1 | 4.50:1 |
| `warning` | `#F39C12` | `#A66908` | 2.19:1 | 4.52:1 |
| `error` | `#E74C3C` | `#E22E1C` | 3.82:1 | 4.51:1 |

Se verificó también que ningún otro archivo del proyecto usaba
`AppColors.success`/`AppColors.warning` todavía (estaban definidos pero
sin consumir) — cero riesgo de romper una pantalla existente al
corregirlos.

**Se agregó `core/utils/color_contrast.dart`** (implementación pura de la
fórmula WCAG) y un test de regresión
(`test/core/color_contrast_test.dart`) que falla si alguien vuelve a
aclarar estos colores sin darse cuenta de que rompe el contraste — sin
esto, la próxima persona que "solo quiera un naranja más vibrante" podría
reintroducir el mismo problema sin ninguna señal de alerta.

### 2.2 Toggle de mostrar/ocultar contraseña — sin anunciar su función ni estado

En `login_page.dart` y `register_page.dart`, el ícono de ojo que
muestra/oculta la contraseña no tenía `tooltip` ni `Semantics` — un
lector de pantalla (TalkBack/VoiceOver) solo anunciaba "botón, doble toque
para activar", sin decir qué hacía ni si la contraseña estaba visible u
oculta en ese momento.

**Corrección:** `Semantics(label: ..., toggled: ...)` envolviendo el
`IconButton`, más `tooltip` visible para usuarios de mouse/trackpad
(Web/desktop). El `label` y el `tooltip` cambian según el estado
(`showPasswordAction` / `hidePasswordAction`), y `toggled` comunica el
estado actual al lector de pantalla de forma nativa (el mismo mecanismo
que usa un `Switch`).

### 2.3 `SignalStrengthIndicator` — barras de señal sin ningún equivalente textual

4 `Container`s coloreados de altura variable, sin ninguna etiqueta — un
usuario no vidente no tenía forma de saber la calidad de señal de un
dispositivo BLE conectado. Las claves de idioma (`signalExcellent`,
`signalGood`, `signalWeak`, `signalVeryWeak`) **ya existían** desde el
módulo BLE original, pero nunca se habían usado en ningún lado — quedaron
como código muerto hasta esta auditoría.

**Corrección:** `Semantics(label: <la etiqueta correspondiente>)`
envolviendo el widget completo, con `ExcludeSemantics` en las barras
internas para que no se anuncien también como 4 elementos gráficos sin
nombre por separado.

### 2.4 `WeeklyBarChart` — información fragmentada, no incoherente pero sí confusa

Cada columna del gráfico semanal tenía un `Text` con el valor en km y otro
con la letra del día, como dos nodos semánticos separados — un lector de
pantalla anunciaba "12" y luego, sin conexión aparente, "L", en vez de
una frase coherente.

**Corrección:** un único `Semantics` por columna con la frase completa
("lunes, 12 km" / "lunes, sin actividad"), usando el nombre completo del
día (no la letra) para que sea inequívoco fuera de contexto visual.
Añadido el parámetro opcional `fullDayNames` al widget; `StatisticsPage`
ahora calcula y pasa los 7 nombres completos.

## 3. Qué se revisó y NO se encontraron problemas

- **Áreas táctiles pequeñas:** cero `GestureDetector`/`InkWell`
  personalizados en todo el proyecto — todos los elementos interactivos
  usan widgets Material estándar (`IconButton`, `TextButton`,
  `ElevatedButton`, `ListTile`), que ya garantizan 48×48dp mínimo por
  especificación de Material Design.
- **`CircleAvatar` pequeños:** existen (avatares de perfil, íconos de
  dispositivo), pero ninguno es interactivo por sí mismo — son elementos
  decorativos dentro de un `ListTile`/`Row`, no requieren área táctil
  propia.
- **Restricciones de escalado de texto:** ningún `textScaleFactor`,
  `textScaler` ni `MediaQuery` que fuerce un tamaño de texto fijo — el
  usuario puede agrandar el texto desde los ajustes de accesibilidad del
  sistema operativo y la app lo respeta en todas sus pantallas.
- **Texto sobre superficies neutras** (fondo claro/oscuro estándar):
  contraste entre 15:1 y 17:1 — muy por encima del mínimo, sin cambios
  necesarios.

## 4. Qué queda fuera de esta pasada (pendiente, no oculto)

- **Navegación por teclado/foco explícito** (orden de tabulación en Web,
  atajos de teclado) — no auditado todavía; relevante sobre todo para la
  versión Web, que es la plataforma secundaria según
  `ARCHITECTURE_DECISIONS.md`.
- **Etiquetas semánticas en `MetricDisplay`** (el HUD de entrenamiento) —
  los números grandes de velocidad/potencia/cadencia/FC tienen `Text`
  normal (sí se anuncian), pero no se agrupó explícitamente "valor +
  unidad + etiqueta" en un solo nodo semántico como se hizo con
  `WeeklyBarChart` — se deja para una siguiente pasada, priorizado más
  bajo porque el HUD ya es, por naturaleza, una pantalla intensamente
  visual pensada para mirar mientras se pedalea, no para uso primario sin
  vista.
- **Pruebas con un lector de pantalla real** (TalkBack/VoiceOver en un
  dispositivo físico) — todo lo de este documento se verificó por
  inspección de código y cálculo programático de contraste, NUNCA
  ejecutando la app de verdad (no hay entorno Flutter disponible aquí).
  Antes de dar por cerrada la accesibilidad del proyecto, alguien con un
  dispositivo real debería navegar las pantallas principales con el
  lector de pantalla activado.

## 5. Cobertura de tests

`test/core/color_contrast_test.dart` — 8 tests: casos de referencia
conocidos (negro/blanco = 21:1), y regresión específica de que
`primary`/`success`/`warning`/`error` cumplen AA con texto blanco.
Ninguno depende de Firebase, Postgres, ni ningún servicio externo — son
cálculos matemáticos puros sobre los valores de `AppColors`.
