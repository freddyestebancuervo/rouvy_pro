import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/generated/app_localizations.dart';
import '../error/failures.dart';
import 'empty_state_view.dart';
import 'error_state_view.dart';

/// Envuelve el patrón `AsyncValue.when(loading:, error:, data:)` que ya se
/// repetía (con ligeras variaciones) en `DeviceManagementPage`,
/// `WearablesPage`, `RideHistoryPage`, `StatisticsPage`,
/// `AchievementsPage`... — centralizarlo aquí es lo que el punto 2 de la
/// lista de tareas independientes (sistema de diseño/componentes
/// reutilizables) pedía formalizar. Las pantallas YA construidas antes de
/// este widget no se tocan (no vale la pena el riesgo de refactorizar 6
/// pantallas que ya funcionan solo por consistencia); toda pantalla
/// NUEVA (como `RoutesCatalogPage`) sí debería usar este helper desde el
/// principio.
class AsyncValueView<T> extends StatelessWidget {
  const AsyncValueView({
    required this.value,
    required this.data,
    this.isEmpty,
    this.emptyMessage,
    this.emptyIcon = Icons.inbox_outlined,
    this.onRetry,
    super.key,
  });

  final AsyncValue<T> value;
  final Widget Function(BuildContext context, T data) data;

  /// Si se provee y devuelve `true` para el valor cargado, se muestra
  /// [EmptyStateView] con [emptyMessage] en vez de [data] — para listas
  /// vacías que técnicamente "cargaron bien" pero no tienen contenido.
  final bool Function(T value)? isEmpty;
  final String? emptyMessage;
  final IconData emptyIcon;

  /// Se pasa a `ErrorStateView` — normalmente
  /// `() => ref.invalidate(elProviderCorrespondiente)`.
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (Object error, StackTrace stackTrace) {
        // Los providers de lectura (p. ej. `workoutsListProvider`) lanzan
        // el `Failure` de dominio directamente — nunca se le llama
        // `.toString()` para mostrarlo: `Failure` extiende `Equatable`,
        // cuyo `toString()` por defecto devuelve `'$runtimeType'`, que en
        // un build Web release minificado aparece como
        // `Instance of 'minified:XX'` en vez de un mensaje legible.
        // `ErrorStateView.failure` ya extrae `.message` correctamente.
        if (error is Failure) {
          return ErrorStateView(failure: error, onRetry: onRetry);
        }

        // Error no modelado como `Failure` (bug/excepción no anticipada):
        // se registra para diagnóstico técnico — nunca se muestra al
        // usuario ni su `runtimeType` ni su stack trace. El registro se
        // envuelve en `try/catch` porque nunca debe impedir mostrar el
        // estado de error (p. ej. en pruebas de widget sin Firebase
        // inicializado).
        try {
          FirebaseCrashlytics.instance.recordError(error, stackTrace, fatal: false);
        } catch (_) {
          // Sin acción: el registro es best-effort, no debe romper la UI.
        }
        return ErrorStateView(
          message: AppLocalizations.of(context).genericErrorMessage,
          onRetry: onRetry,
        );
      },
      data: (T loadedValue) {
        if (isEmpty != null && isEmpty!(loadedValue) && emptyMessage != null) {
          return EmptyStateView(message: emptyMessage!, icon: emptyIcon);
        }
        return data(context, loadedValue);
      },
    );
  }
}
