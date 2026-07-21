import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/widgets/async_value_view.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/training_route.dart';
import '../providers/routes_providers.dart';
import '../widgets/route_card.dart';

class RoutesCatalogPage extends ConsumerWidget {
  const RoutesCatalogPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<TrainingRoute>> catalogState = ref.watch(routesCatalogProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.routesCatalogTitle)),
      body: SafeArea(
        child: AsyncValueView<List<TrainingRoute>>(
          value: catalogState,
          onRetry: () => ref.invalidate(routesCatalogProvider),
          isEmpty: (List<TrainingRoute> routes) => routes.isEmpty,
          emptyMessage: l10n.noRoutesAvailableMessage,
          emptyIcon: Icons.map_outlined,
          data: (BuildContext context, List<TrainingRoute> routes) {
            return GridView.builder(
              padding: const EdgeInsets.all(20),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 0.78,
              ),
              itemCount: routes.length,
              itemBuilder: (BuildContext context, int index) {
                final TrainingRoute route = routes[index];
                return RouteCard(
                  route: route,
                  onTap: () => context.push('${AppRoute.routesCatalog}/${route.id}'),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
