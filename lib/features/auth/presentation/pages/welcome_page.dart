import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_gradients.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../widgets/dark_tech_auth_shell.dart';
import '../../../../core/design_system/dark_tech_buttons.dart';

/// Pantalla de bienvenida (marketing/onboarding previo al login). No tiene
/// lógica de negocio: solo dirige a Login o Registro.
///
/// KORIXA-UI-SCREEN-BATCH-01 — SCREEN_01=WELCOME: migración visual a
/// Korixa Dark Tech. El comportamiento (las 2 navegaciones) es idéntico
/// al de antes; solo cambió la presentación.
class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return DarkTechAuthShell(
      maxWidth: 480,
      showAmbientGlow: true,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          const Spacer(),
          const _BrandMedallion(),
          const SizedBox(height: AppSpacing.xxl),
          Text(
            l10n.welcomeTitle,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            l10n.welcomeSubtitle,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: DarkTech.textSecondary),
          ),
          const Spacer(flex: 2),
          PrimaryGradientButton(
            label: l10n.welcomeCreateAccount,
            onPressed: () => context.go(AppRoute.register),
          ),
          const SizedBox(height: AppSpacing.md),
          SecondaryOutlinedButton(
            label: l10n.welcomeLogin,
            onPressed: () => context.go(AppRoute.login),
          ),
          const SizedBox(height: AppSpacing.xl),
        ],
      ),
    );
  }
}

/// Medallón de marca — reemplaza el círculo rojo genérico anterior.
///
/// Usa [AppGradients.primaryCta] (morado→azul, 2 paradas) y NO
/// [AppGradients.primary] (morado→azul→cian, 3 paradas) a propósito: el
/// ícono blanco necesita apoyarse en algún punto del gradiente, y solo
/// `primaryCta` garantiza AA en CUALQUIER punto de su recorrido —
/// `primary` termina en cian, que reprueba contraste incluso para
/// elementos no-textuales bajo blanco (ver `app_gradients.dart` y
/// Sección 17 del encargo: "cyan-ending decorative gradient never
/// carries white text/icon across unsafe area").
class _BrandMedallion extends StatelessWidget {
  const _BrandMedallion();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 96,
      width: 96,
      decoration: const BoxDecoration(
        gradient: AppGradients.primaryCta,
        shape: BoxShape.circle,
      ),
      child: const Icon(Icons.directions_bike, color: Colors.white, size: 48),
    );
  }
}
