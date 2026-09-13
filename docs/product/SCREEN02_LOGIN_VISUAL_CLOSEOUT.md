# SCREEN_02 Login — Visual Closeout

**Fecha:** 2026-09-13  
**Estado:** `APPROVED / LOCKED`  
**PR de implementación:** #147  
**Merge:** `27f0989012e0fb0f9e9c406762eb6109d512d7ec`

Este documento fija el contrato visual aprobado por el propietario para SCREEN_02 Login. No cambia comportamiento de autenticación ni sustituye especificaciones funcionales.

## Mobile portrait

- Hero dedicado: `assets/images/korixa_login_hero_guatape_mobile.png`.
- Full-bleed, sin logo superior flotante.
- Título: `Bienvenido de nuevo`.
- Subtítulo: `Inicia sesión para continuar tu ruta`.
- Email + contraseña + recuperación de contraseña.
- Indicador de 3 barras; barra central activa.
- CTA `Iniciar sesión` sin flecha.
- Google + `Crear cuenta` conservados.
- Grupo de contenido bottom-anchored.
- Sin zoom runtime artificial.
- Scroll solo cuando existe overflow real.

## Web / desktop

- Hero dedicado: `assets/images/korixa_login_hero_guatape_web.png`.
- Asset final aprobado: 4096×1751 px.
- Panel de Login a la derecha; ciclista/Piedra del Peñol preservados en la composición.
- `Image.asset` + `BoxFit.cover` con el alignment existente; sin mecanismo adicional de zoom artificial.
- Sin modificación de color, blur, contraste o contenido del asset en la ronda final.
- Phone landscape comparte el hero Web; mobile portrait no.

## Bloqueo de diseño

```text
SCREEN_02_MOBILE = LOCKED
SCREEN_02_WEB = LOCKED
HERO_MOBILE = LOCKED
HERO_WEB = LOCKED
AUTH_BEHAVIOR = UNCHANGED
NAVIGATION = UNCHANGED
NO_FURTHER_VISUAL_CHANGES = UNLESS_OWNER_REOPENS
```

Cualquier cambio futuro requiere una reapertura explícita del propietario y una nueva validación visual/responsive. No reabrir SCREEN_02 por inferencia, limpieza oportunista o refactor no solicitado.
