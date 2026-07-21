import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
      error: (Object error, StackTrace stackTrace) => ErrorStateView(
        message: error.toString(),
        onRetry: onRetry,
      ),
      data: (T loadedValue) {
        if (isEmpty != null && isEmpty!(loadedValue) && emptyMessage != null) {
          return EmptyStateView(message: emptyMessage!, icon: emptyIcon);
        }
        return data(context, loadedValue);
      },
    );
  }
}
