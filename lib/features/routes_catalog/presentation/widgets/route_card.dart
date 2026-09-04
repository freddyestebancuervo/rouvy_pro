import 'package:flutter/material.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/training_route.dart';

extension RouteDifficultyUi on RouteDifficulty {
  String label(AppLocalizations l10n) => switch (this) {
        RouteDifficulty.easy => l10n.routeDifficultyEasy,
        RouteDifficulty.moderate => l10n.routeDifficultyModerate,
        RouteDifficulty.hard => l10n.routeDifficultyHard,
        RouteDifficulty.extreme => l10n.routeDifficultyExtreme,
      };

  Color color(BuildContext context) => switch (this) {
        RouteDifficulty.easy => Colors.green,
        RouteDifficulty.moderate => Colors.orange,
        RouteDifficulty.hard => Colors.deepOrange,
        RouteDifficulty.extreme => Theme.of(context).colorScheme.error,
      };
}

extension RouteContentTypeUi on RouteContentType {
  IconData get icon => switch (this) {
        RouteContentType.video => Icons.videocam_outlined,
        RouteContentType.terrain3d => Icons.terrain,
        RouteContentType.staticRoute => Icons.straighten,
      };

  String label(AppLocalizations l10n) => switch (this) {
        RouteContentType.video => l10n.routeContentVideo,
        RouteContentType.terrain3d => l10n.routeContentTerrain3d,
        RouteContentType.staticRoute => l10n.routeContentStatic,
      };
}

class RouteCard extends StatelessWidget {
  const RouteCard({required this.route, required this.onTap, super.key});

  final TrainingRoute route;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Container(
              height: 90,
              width: double.infinity,
              color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.4),
              child: Icon(
                route.contentType.icon,
                size: 36,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    route.name,
                    style: Theme.of(context).textTheme.titleSmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${(route.distanceMeters / 1000).toStringAsFixed(0)} km · '
                    '${route.elevationGainMeters.toStringAsFixed(0)} m',
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: Theme.of(context).colorScheme.outline),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: route.difficulty.color(context).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      route.difficulty.label(l10n),
                      style: Theme.of(context)
                          .textTheme
                          .labelSmall
                          ?.copyWith(color: route.difficulty.color(context), fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
