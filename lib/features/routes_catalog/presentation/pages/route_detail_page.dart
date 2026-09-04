import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/widgets/async_value_view.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/training_route.dart';
import '../providers/routes_providers.dart';
import '../widgets/route_card.dart';

class RouteDetailPage extends ConsumerWidget {
  const RouteDetailPage({required this.routeId, super.key});

  final String routeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<TrainingRoute> routeState = ref.watch(routeDetailProvider(routeId));
    final bool isSpanish = l10n.localeName.startsWith('es');

    return Scaffold(
      appBar: AppBar(title: Text(l10n.routeDetailTitle)),
      body: SafeArea(
        child: AsyncValueView<TrainingRoute>(
          value: routeState,
          onRetry: () => ref.invalidate(routeDetailProvider(routeId)),
          data: (BuildContext context, TrainingRoute route) {
            return Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Container(
                        height: 160,
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.4),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Icon(
                          route.contentType.icon,
                          size: 56,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(route.name, style: Theme.of(context).textTheme.headlineSmall),
                      if (route.locationName != null) ...<Widget>[
                        const SizedBox(height: 4),
                        Text(
                          route.locationName!,
                          style: Theme.of(context)
                              .textTheme
                              .bodyMedium
                              ?.copyWith(color: Theme.of(context).colorScheme.outline),
                        ),
                      ],
                      const SizedBox(height: 16),
                      Row(
                        children: <Widget>[
                          _StatChip(
                            icon: Icons.straighten,
                            label: '${(route.distanceMeters / 1000).toStringAsFixed(1)} km',
                          ),
                          const SizedBox(width: 10),
                          _StatChip(
                            icon: Icons.trending_up,
                            label: '${route.elevationGainMeters.toStringAsFixed(0)} m',
                          ),
                          const SizedBox(width: 10),
                          _StatChip(icon: route.contentType.icon, label: route.contentType.label(l10n)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: route.difficulty.color(context).withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            route.difficulty.label(l10n),
                            style: TextStyle(color: route.difficulty.color(context), fontWeight: FontWeight.w600),
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text(
                        isSpanish ? route.descriptionEs : route.descriptionEn,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 28),
                      FilledButton.icon(
                        // KORIXA-MVP-VERTICAL-SLICE-01 — antes navegaba a
                        // `/training` sin ningún argumento (defecto
                        // conocido: la ruta seleccionada nunca llegaba a
                        // la sesión, que arrancaba como libre). Ahora
                        // lleva el id como query param — sobrevive un
                        // refresh en Web y GoRoute lo resuelve del lado de
                        // `TrainingHudPage`.
                        onPressed: () => context.push(
                          Uri(path: AppRoute.training, queryParameters: <String, String>{'routeId': route.id})
                              .toString(),
                        ),
                        icon: const Icon(Icons.play_arrow),
                        label: Text(l10n.startTrainingOnRouteAction),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        l10n.routeTrainingNote,
                        textAlign: TextAlign.center,
                        style: Theme.of(context)
                            .textTheme
                            .labelSmall
                            ?.copyWith(color: Theme.of(context).colorScheme.outline),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: <Widget>[
            Icon(icon, size: 18, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 4),
            Text(label, style: Theme.of(context).textTheme.labelSmall),
          ],
        ),
      ),
    );
  }
}
