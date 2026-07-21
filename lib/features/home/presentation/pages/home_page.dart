import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../auth/domain/entities/user_entity.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../auth/presentation/providers/logout_controller.dart';

/// Punto de entrada tras autenticarse. Placeholder funcional: los módulos
/// de Rutas, Multijugador, Retos (con su propia `BottomNavigationBar` /
/// `NavigationRail` en web) se añadirán como features independientes
/// siguiendo el mismo patrón que `auth`.
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  static const double _wideBreakpoint = 720;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<UserEntity?> authState = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appName),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.person_outline),
            tooltip: l10n.profileTitle,
            onPressed: () => context.push(AppRoute.profile),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: l10n.logoutAction,
            onPressed: () => ref.read(logoutControllerProvider.notifier).logout(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push(AppRoute.training),
        icon: const Icon(Icons.directions_bike),
        label: Text(l10n.startTrainingAction),
      ),
      body: authState.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object error, StackTrace stackTrace) =>
            Center(child: Text(l10n.genericErrorMessage)),
        data: (UserEntity? user) {
          final String name = (user?.displayName.isNotEmpty ?? false)
              ? user!.displayName
              : (user?.email ?? '');

          return LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final bool isWide = constraints.maxWidth >= _wideBreakpoint;
              return SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      l10n.homeGreeting(name),
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 24),
                    isWide
                        ? Row(
                            children: <Widget>[
                              Expanded(child: _TodaySessionCard(l10n: l10n)),
                              const SizedBox(width: 16),
                              Expanded(child: _RecommendedRoutesCard(l10n: l10n)),
                            ],
                          )
                        : Column(
                            children: <Widget>[
                              _TodaySessionCard(l10n: l10n),
                              const SizedBox(height: 16),
                              _RecommendedRoutesCard(l10n: l10n),
                            ],
                          ),
                    const SizedBox(height: 80), // espacio para el FAB
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _TodaySessionCard extends StatelessWidget {
  const _TodaySessionCard({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(l10n.homeTodaySession, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            const Text('Plan de entrenamiento IA — próximamente en M8/M9.'),
          ],
        ),
      ),
    );
  }
}

class _RecommendedRoutesCard extends StatelessWidget {
  const _RecommendedRoutesCard({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(AppRoute.routesCatalog),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(l10n.homeRecommendedRoutes, style: Theme.of(context).textTheme.titleMedium),
                  ),
                  const Icon(Icons.chevron_right),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                l10n.exploreCatalogHint,
                style: TextStyle(color: Theme.of(context).colorScheme.outline),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
